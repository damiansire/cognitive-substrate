import { GoogleGenAI, type Part, type PartListUnion } from '@google/genai';
import { toolDeclarations } from './schemas';
import { fsTools, resolveInsideWorkspace } from '@cognitive-substrate/sandbox-fs';
import { terminalTools } from '@cognitive-substrate/sandbox-terminal';
import { containerTools } from '@cognitive-substrate/sandbox-container';
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

export { generateJson, hasApiKey, DEFAULT_MODEL } from './client';
export { getLlmCalls, resetLlmCalls, recordLlmCall } from './metrics';

const MAX_TOOL_ITERATIONS = 15;
const MAX_BACKOFF_ATTEMPTS = 3;

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
    coreMemory: string
): Promise<{ success: boolean; log: string; awaitingApproval?: { approvalId: string; command: string } }> {
    if (!process.env['GEMINI_API_KEY'] || process.env['GEMINI_API_KEY'].includes('tu_clave_aqui')) {
        console.warn(`>>> [LLM] GEMINI_API_KEY no válida. Simulación activada para ${workspacePath}`);
        return { success: true, log: 'Simulated success (No API Key)' };
    }

    const policy = loadPolicy(workspacePath);
    const budget = new Budget(policy);
    const ai = new GoogleGenAI({ apiKey: process.env['GEMINI_API_KEY'] });
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

    let chat;
    try {
        chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: systemInstruction,
                tools: [{ functionDeclarations: toolDeclarations as any }],
                temperature: 0.2
            }
        });
    } catch (e: any) {
        return { success: false, log: `Error inicializando chat: ${e.message}` };
    }

    let nextMessage: PartListUnion = `Ejecuta la siguiente tarea:\n${task}`;
    let success = false;
    let log = '';
    const browser = new BrowserSession();

    try {
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
            let response;
            let attempts = 0;

            // Bounded autonomy: stop if the per-task model budget is exhausted.
            if (!budget.canCallLlm()) {
                log += `\n[Governance] Budget de LLM agotado (${budget.spentLlm}/${policy.maxLlmCallsPerTask}). Deteniendo.`;
                break;
            }

            // Exponential Backoff implementation (G-Staff Pattern)
            while (attempts < MAX_BACKOFF_ATTEMPTS) {
                try {
                    recordLlmCall();
                    budget.recordLlm();
                    response = await chat.sendMessage({ message: nextMessage });
                    break;
                } catch (apiError: any) {
                    attempts++;
                    const status = apiError.status || 500;
                    if (status === 429 || status === 503) {
                        if (attempts >= MAX_BACKOFF_ATTEMPTS) {
                            return {
                                success: false,
                                log: log + `\nError Crítico: Falla de Red/Rate Limit persistente (${status}).`
                            };
                        }
                        const waitTime = Math.pow(2, attempts) * 1000;
                        console.warn(`>>> [LLM] Rate Limit (${status}) detectado. Reintentando en ${waitTime}ms...`);
                        await new Promise((resolve) => setTimeout(resolve, waitTime));
                    } else {
                        throw apiError;
                    }
                }
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
