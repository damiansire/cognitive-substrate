import type { Part, PartListUnion } from '@google/genai';
import { toolDeclarations } from './schemas';
import { selectProvider, type ChatTurn, type LlmProvider } from '@cognitive-substrate/llm-provider';
import { fsTools, resolveInsideWorkspace } from '@cognitive-substrate/sandbox-fs';
import { terminalTools } from '@cognitive-substrate/sandbox-terminal';
import { containerTools } from '@cognitive-substrate/sandbox-container';
import { wasmTools } from '@cognitive-substrate/sandbox-wasm';
import { browserTools, BrowserSession } from '@cognitive-substrate/sandbox-browser';
import { discoverSkills, readSkillContent } from '@cognitive-substrate/skills-parser';
import {
    type Policy,
    loadPolicy,
    decideCommand,
    decideUrl,
    appendAudit,
    Budget,
    ApprovalStore
} from '@cognitive-substrate/governance';
import * as path from 'path';

import { recordLlmCall } from './metrics';
import { withBackoff, isRetryableError } from './client';

export { generateJson, hasApiKey, DEFAULT_MODEL } from './client';
export { getLlmCalls, resetLlmCalls, recordLlmCall } from './metrics';

const MAX_TOOL_ITERATIONS = 15;

/** One model function-call as the loop consumes it (a structural subset of the SDK's). */
export interface AgentFunctionCall {
    id?: string;
    name?: string;
    args?: unknown;
}

/** The model response shape the loop reads. */
export interface AgentResponse {
    text?: string;
    functionCalls?: AgentFunctionCall[];
}

/** The minimal chat surface `executeTaskWithLLM` drives — satisfied by the real Gemini
 * `Chat`, and by a scripted fake in tests. This is the dependency seam that lets the core
 * loop (functionResponse reinjection, budget cutoff, backoff, defer pause) be exercised
 * without a network or an API key. */
export interface ChatLike {
    sendMessage(input: { message: PartListUnion }): Promise<AgentResponse>;
}

/** Injectable dependencies for `executeTaskWithLLM`. When `createChat` is provided the
 * function runs the REAL loop against it (bypassing the simulation-mode early return), and
 * `sleep` lets tests drive backoff without real waits. */
export interface ExecuteDeps {
    createChat?: (systemInstruction: string) => ChatLike;
    sleep?: (ms: number) => Promise<void>;
}

/**
 * Translates this loop's Gemini-shaped `PartListUnion` message into the vendor-neutral
 * `ChatTurn` that `@cognitive-substrate/llm-provider` providers consume. Kept local
 * (not exported) so `ChatLike`/`ExecuteDeps` — and every test that already constructs a
 * fake `ChatLike` against the Gemini shape — stay untouched; only the DEFAULT provider
 * wiring below goes through this translation.
 */
function partListToChatTurn(message: PartListUnion): ChatTurn {
    if (typeof message === 'string') return { kind: 'text', text: message };
    const parts = Array.isArray(message) ? message : [message];
    const functionResponses = parts.filter((p): p is Part & { functionResponse: NonNullable<Part['functionResponse']> } =>
        typeof p === 'object' && p !== null && 'functionResponse' in p && p.functionResponse !== undefined
    );
    if (functionResponses.length > 0) {
        return {
            kind: 'toolResults',
            results: functionResponses.map((p) => ({
                callId: p.functionResponse.id,
                name: p.functionResponse.name,
                output: String((p.functionResponse.response as { output?: unknown } | undefined)?.output ?? '')
            }))
        };
    }
    // Fallback: a plain-text Part array (not expected on the hot path today, but keeps
    // this total rather than silently dropping content).
    const text = parts
        .map((p) => (typeof p === 'object' && p !== null && 'text' in p ? String((p as { text?: unknown }).text ?? '') : ''))
        .join('');
    return { kind: 'text', text };
}

/** Adapts a vendor-neutral `LlmProvider` chat session to this loop's local `ChatLike`
 * contract, so the DEFAULT (non-test-injected) path can run against ANY provider
 * (`LLM_PROVIDER=openai` or the default Gemini) while every existing test — which
 * injects its own `ChatLike` fake directly — is completely unaffected. */
function providerChatAdapter(provider: LlmProvider, systemInstruction: string): ChatLike {
    const chat = provider.createChat(systemInstruction, toolDeclarations as any);
    return {
        async sendMessage({ message }: { message: PartListUnion }): Promise<AgentResponse> {
            return chat.sendMessage(partListToChatTurn(message));
        }
    };
}

/** Result of a dispatched tool call: the text to feed back to the model, plus an
 * optional signal that the whole task must pause for human approval right now. */
export interface DispatchResult {
    text: string;
    awaitingApproval?: { approvalId: string; command: string };
}

/**
 * Dispatches a single tool call to its sandboxed implementation, applying governance:
 * the terminal goes through the approval gate, and every invocation is audited.
 * All tools are confined to `workspacePath`. `task` identifies the current task line
 * so a deferred command's `PendingApproval` can be matched back to it on retry.
 *
 * Exported (not just used internally) so the defer/approval wiring is testable without
 * a real LLM call — `runCommand` is the only case that can pause the task.
 */
export async function dispatchTool(
    workspacePath: string,
    name: string | undefined,
    args: any,
    policy: Policy,
    browser: BrowserSession,
    task: string
): Promise<DispatchResult> {
    switch (name) {
        case 'readFile':
            appendAudit(workspacePath, { tool: 'readFile', allowed: true, detail: args?.filepath });
            return { text: await fsTools.readFile(workspacePath, args) };
        case 'writeFile':
            appendAudit(workspacePath, { tool: 'writeFile', allowed: true, detail: args?.filepath });
            return { text: await fsTools.writeFile(workspacePath, args) };
        case 'listFiles':
            appendAudit(workspacePath, { tool: 'listFiles', allowed: true, detail: args?.dirpath });
            return { text: await fsTools.listFiles(workspacePath, args) };
        case 'runCommand': {
            const command = args?.command ?? '';
            // Approval gate: dangerous commands are denied (or deferred to a human) in
            // autonomous mode.
            const decision =
                policy.mode === 'defer'
                    ? decideCommand(command, policy, {
                          approvals: new ApprovalStore(workspacePath),
                          workspace: path.basename(workspacePath),
                          task
                      })
                    : decideCommand(command, policy);
            appendAudit(workspacePath, {
                tool: 'runCommand',
                allowed: decision.allowed,
                reason: decision.reason,
                command
            });
            if (decision.status === 'deferred' && decision.approvalId) {
                return {
                    text: `En espera de aprobación humana (id: ${decision.approvalId}). La tarea queda pausada hasta que se resuelva.`,
                    awaitingApproval: { approvalId: decision.approvalId, command }
                };
            }
            if (!decision.allowed) {
                return {
                    text: `Bloqueado por governance: ${decision.reason}. Si era necesario, ajustá governance.json o pedí aprobación humana.`
                };
            }
            // Execution surface chosen by policy: isolated container or native host shell.
            return {
                text:
                    policy.terminal === 'container'
                        ? await containerTools.runCommand(workspacePath, args)
                        : await terminalTools.runCommand(workspacePath, args)
            };
        }
        case 'fetchUrl': {
            // Egress gate: only domains in browserAllowDomains may be fetched (deny-all default).
            const url = args?.url ?? '';
            const urlDecision = decideUrl(url, policy);
            appendAudit(workspacePath, {
                tool: 'fetchUrl',
                allowed: urlDecision.allowed,
                reason: urlDecision.reason,
                detail: url
            });
            if (!urlDecision.allowed) {
                return {
                    text: `Bloqueado por governance: ${urlDecision.reason}. Agregá el dominio a browserAllowDomains en governance.json si corresponde.`
                };
            }
            return { text: await browserTools.fetchText(url) };
        }
        case 'browserNavigate': {
            const url = args?.url ?? '';
            const urlDecision = decideUrl(url, policy);
            appendAudit(workspacePath, {
                tool: 'browserNavigate',
                allowed: urlDecision.allowed,
                reason: urlDecision.reason,
                detail: url
            });
            if (!urlDecision.allowed) {
                return { text: `Bloqueado por governance: ${urlDecision.reason}.` };
            }
            return { text: await browser.navigate(url) };
        }
        case 'browserReadText':
            appendAudit(workspacePath, { tool: 'browserReadText', allowed: true });
            return { text: await browser.readText() };
        case 'browserClick':
            appendAudit(workspacePath, { tool: 'browserClick', allowed: true, detail: args?.selector });
            return { text: await browser.click(args?.selector ?? '') };
        case 'browserType':
            appendAudit(workspacePath, { tool: 'browserType', allowed: true, detail: args?.selector });
            return { text: await browser.type(args?.selector ?? '', args?.text ?? '') };
        case 'browserScreenshot': {
            // Screenshot path must stay inside the workspace (same containment as fs tools).
            try {
                const abs = resolveInsideWorkspace(workspacePath, args?.filepath ?? 'screenshot.png');
                appendAudit(workspacePath, { tool: 'browserScreenshot', allowed: true, detail: args?.filepath });
                return { text: await browser.screenshot(abs) };
            } catch (e: any) {
                return { text: `Error de Seguridad: ${e?.message ?? 'ruta inválida'}` };
            }
        }
        case 'runJs':
            // Real WASM isolation (QuickJS-in-WebAssembly): no ambient fs/network/process
            // access exists in the guest, so no governance gate is needed here the way
            // runCommand needs one — the capability the gate would deny simply isn't present.
            appendAudit(workspacePath, { tool: 'runJs', allowed: true });
            return { text: await wasmTools.runJs(args) };
        case 'readSkill':
            appendAudit(workspacePath, { tool: 'readSkill', allowed: true, detail: args?.path });
            return { text: await readSkillContent(workspacePath, args?.path) };
        default:
            return { text: `Error: Herramienta desconocida ${name}` };
    }
}

/**
 * Executes a task using the LLM with exponential backoff for rate limits.
 * Handles the MemGPT memory pattern, tool calling, and strict workspace context.
 *
 * @param workspacePath - The absolute path to the current project workspace.
 * @param task - The string representation of the task to complete.
 * @param coreMemory - The immediate context/memory to inject into the system prompt.
 * @returns A promise resolving to an object containing success status and a detailed log.
 */
export async function executeTaskWithLLM(
    workspacePath: string,
    task: string,
    coreMemory: string,
    deps: ExecuteDeps = {}
): Promise<{ success: boolean; log: string; awaitingApproval?: { approvalId: string; command: string } }> {
    // Provider selection: LLM_PROVIDER=openai opts into the OpenAI adapter, anything
    // else (including unset) keeps the original Gemini behavior — see
    // @cognitive-substrate/llm-provider#selectProvider.
    const provider = selectProvider();

    // Simulation mode: only when NO chat factory is injected AND the selected provider
    // has no usable key. An injected `createChat` (tests) always runs the real loop.
    if (!deps.createChat && !provider.hasApiKey()) {
        console.warn(`>>> [LLM] ${provider.name}: sin API key válida. Simulación activada para ${workspacePath}`);
        return { success: true, log: 'Simulated success (No API Key)' };
    }

    const policy = loadPolicy(workspacePath);
    const budget = new Budget(policy);
    const sleep = deps.sleep;
    const availableSkills = discoverSkills(workspacePath);
    const skillsListText = availableSkills.map((s) => `- ${s.name}: ${s.description} (path: ${s.path})`).join('\n');

    // PATRÓN MEMGPT: Core Memory (System Prompt) vs Archival Memory (knowledge.md consultable vía tools)
    const systemInstruction = `
Eres el motor central del Cognitive Substrate OS operando como Global Daemon.
Estás aislado en el siguiente workspace (proyecto):
WORKSPACE_PATH: ${workspacePath}

Tu objetivo es resolver la tarea asignada por la cola [now].
Tienes acceso a herramientas de sistema de archivos y terminal. Todas tus herramientas operan ESTRICTAMENTE dentro de WORKSPACE_PATH. Las rutas que proporciones a las herramientas deben ser relativas a este workspace.

SKILLS (HABILIDADES) DISPONIBLES:
Tienes las siguientes habilidades globales y locales descubiertas dinámicamente. Si alguna te sirve para resolver la tarea, usa la herramienta 'readSkill(path)' pasando el path exacto para leer las instrucciones completas antes de actuar.
${skillsListText || 'No se encontraron skills.'}

CORE MEMORY (Contexto Inmediato):
${coreMemory}

Si necesitas contexto histórico de este proyecto, usa la herramienta readFile para leer 'knowledge.md'.
Sigue estos pasos estrictamente:
1. Analiza la tarea.
2. Utiliza las herramientas necesarias para completarla.
3. Si la tarea involucra código ejecutable (un server, un script, una integración),
   dejá una comprobación automatizable y acotada que pruebe que el comportamiento
   funciona de verdad (ej: un script de test que arranque lo necesario, lo ejerza, y
   termine con código de salida 0 o distinto de 0) — no alcanza con que el archivo
   exista, el sistema va a volver a correr esa comprobación de forma independiente.
4. Si la tarea involucra una interfaz que se renderiza en un navegador (HTML/CSS/JS de
   cliente), un test de servidor (sockets, API, etc.) NO ES SUFICIENTE — ese test puede
   pasar mientras la pantalla está rota (ej: un contenedor del DOM que no existe, o un
   script de cliente que nunca se conecta). Para este caso tenés que escribir una
   comprobación que abra un navegador real y la ejerza como lo haría una persona
   (cargar la página, completar formularios, hacer click, y fallar con código de salida
   distinto de 0 si lo que se ve en pantalla no es lo esperado). Usá Playwright para
   esto: si no está instalado en el workspace, instalalo vos mismo
   (npm install --save-dev playwright, y npx playwright install chromium) antes de
   escribir el test.
5. Si logras el objetivo, devuelve tu último mensaje explicando qué hiciste.
`;

    console.log(`>>> [LLM] Delegando tarea en workspace ${workspacePath}: ${task}`);

    const createChat = deps.createChat ?? ((sys: string): ChatLike => providerChatAdapter(provider, sys));

    let chat: ChatLike;
    try {
        chat = createChat(systemInstruction);
    } catch (e: any) {
        return { success: false, log: `Error inicializando chat: ${e.message}` };
    }

    let nextMessage: PartListUnion = `Ejecuta la siguiente tarea:\n${task}`;
    let success = false;
    let log = '';
    const browser = new BrowserSession();

    try {
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
            let response: AgentResponse | undefined;

            // Bounded autonomy: stop if the per-task model budget is exhausted.
            if (!budget.canCallLlm()) {
                log += `\n[Governance] Budget de LLM agotado (${budget.spentLlm}/${policy.maxLlmCallsPerTask}). Deteniendo.`;
                break;
            }

            // Retry transient errors with jitter/Retry-After (shared withBackoff, same
            // policy as client.ts). A persistent rate-limit ends the task gracefully; any
            // non-retryable error propagates to the outer catch.
            try {
                response = await withBackoff(
                    () => {
                        recordLlmCall();
                        budget.recordLlm();
                        return chat.sendMessage({ message: nextMessage });
                    },
                    sleep ? { sleep } : {}
                );
            } catch (apiError: unknown) {
                if (isRetryableError(apiError)) {
                    const status = (apiError as { status?: number })?.status;
                    return {
                        success: false,
                        log: log + `\nError Crítico: Falla de Red/Rate Limit persistente (${status}).`
                    };
                }
                throw apiError;
            }

            if (!response) break;

            log += `\n[Agent]: ${response.text || 'Tool Call'}`;

            const calls = response.functionCalls;
            if (calls && calls.length > 0) {
                // Reinject tool results as proper functionResponse parts (NOT a stringified
                // text message). This is what the Gemini function-calling contract expects so
                // the model can match each result to the call it made.
                const toolResponseParts: Part[] = [];

                let pausedForApproval: { approvalId: string; command: string } | undefined;

                for (const call of calls) {
                    const args = call.args as any;
                    console.log(`>>> [LLM Tool] Invocando ${call.name}(${JSON.stringify(args)}) en ${workspacePath}`);

                    let result: string;
                    if (!budget.canCallTool()) {
                        result = `Bloqueado por governance: budget de herramientas agotado (${budget.spentTools}/${policy.maxToolCallsPerTask}).`;
                    } else {
                        budget.recordTool();
                        const dispatch = await dispatchTool(workspacePath, call.name, args, policy, browser, task);
                        result = dispatch.text;
                        if (dispatch.awaitingApproval) pausedForApproval = dispatch.awaitingApproval;
                    }

                    toolResponseParts.push({
                        functionResponse: {
                            id: call.id,
                            name: call.name,
                            response: { output: result }
                        }
                    });

                    // A dangerous command was deferred to a human: stop dispatching further
                    // calls this round and end the task here — it can't make progress until
                    // the pending approval is resolved.
                    if (pausedForApproval) break;
                }

                if (pausedForApproval) {
                    log += `\n[Governance] Tarea pausada, esperando aprobación humana (id: ${pausedForApproval.approvalId}).`;
                    return { success: false, log, awaitingApproval: pausedForApproval };
                }
                nextMessage = toolResponseParts;
            } else {
                success = true;
                break;
            }
        }
        return { success, log };
    } catch (e: any) {
        console.error('>>> [LLM Error]:', e);
        return { success: false, log: `Excepción durante ejecución: ${e.message}` };
    } finally {
        await browser.close();
    }
}
