import OpenAI from 'openai';
import type {
    AgentFunctionCall,
    AgentResponse,
    ChatLike,
    ChatTurn,
    FunctionDeclaration,
    FunctionParameterSchema,
    LlmProvider
} from './types';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function hasOpenAiApiKey(): boolean {
    const key = process.env['OPENAI_API_KEY'];
    return !!key && !key.includes('tu_clave_aqui');
}

/** Translates Gemini-style uppercase JSON-Schema-ish types (`OBJECT`, `STRING`, ...) —
 * the convention `gemini-agent-loop/src/schemas.ts` already uses for `toolDeclarations`
 * — into standard lowercase JSON Schema, which is what OpenAI's function-calling
 * `parameters` field expects. Recurses into nested object/array schemas. */
export function toJsonSchema(schema: FunctionParameterSchema | undefined): Record<string, unknown> {
    if (!schema) return { type: 'object', properties: {} };
    const type = schema.type.toLowerCase();
    const out: Record<string, unknown> = { type };
    if (schema.description) out['description'] = schema.description;
    if (schema.properties) {
        out['properties'] = Object.fromEntries(
            Object.entries(schema.properties).map(([key, value]) => [key, toJsonSchema(value)])
        );
    }
    if (schema.required) out['required'] = schema.required;
    if (schema.items) out['items'] = toJsonSchema(schema.items);
    return out;
}

/** Translates our vendor-neutral `FunctionDeclaration[]` into OpenAI's `tools` array. */
export function toOpenAiTools(tools: FunctionDeclaration[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map((t) => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: toJsonSchema(t.parameters)
        }
    }));
}

/** Minimal surface of the OpenAI SDK client this adapter needs — lets tests inject a
 * fake instead of hitting the real network, the same seam pattern `ChatLike`/`createChat`
 * already uses elsewhere in this monorepo (e.g. `ExecuteDeps.createChat` in
 * `gemini-agent-loop`). */
export interface OpenAiChatClient {
    chat: {
        completions: {
            create(
                params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
            ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
        };
    };
}

class OpenAiChat implements ChatLike {
    private readonly messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    constructor(
        private readonly client: OpenAiChatClient,
        private readonly model: string,
        private readonly tools: OpenAI.Chat.Completions.ChatCompletionTool[],
        systemInstruction: string
    ) {
        this.messages = [{ role: 'system', content: systemInstruction }];
    }

    async sendMessage(turn: ChatTurn): Promise<AgentResponse> {
        if (turn.kind === 'text') {
            this.messages.push({ role: 'user', content: turn.text });
        } else {
            // OpenAI requires one `tool` message per tool_call_id answering the immediately
            // preceding assistant turn's tool_calls — no separate "user" wrapper needed.
            for (const r of turn.results) {
                this.messages.push({
                    role: 'tool',
                    tool_call_id: r.callId ?? '',
                    content: r.output
                });
            }
        }

        // Pass a snapshot, not the live array: `this.messages` is mutated right after
        // this call (the assistant turn is appended), and callers/tests that hold onto
        // the params object passed to `create` must see the history AS IT WAS AT CALL
        // TIME, not after.
        const completion = await this.client.chat.completions.create({
            model: this.model,
            messages: [...this.messages],
            tools: this.tools.length > 0 ? this.tools : undefined,
            temperature: 0.2
        });

        const message = completion.choices[0]?.message;
        if (!message) return { text: '' };

        // Persist the assistant turn so the next sendMessage's history is coherent —
        // required for OpenAI's stateless API (unlike Gemini's stateful SDK session).
        this.messages.push(message);

        const functionCalls: AgentFunctionCall[] | undefined = message.tool_calls
            ?.filter(
                (c): c is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & { type: 'function' } =>
                    c.type === 'function'
            )
            .map((c) => ({
                id: c.id,
                name: c.function.name,
                args: safeParseJson(c.function.arguments)
            }));

        return {
            text: message.content ?? undefined,
            ...(functionCalls && functionCalls.length > 0 ? { functionCalls } : {})
        };
    }
}

function safeParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

/**
 * OpenAI chat-completions adapter implementing the same vendor-neutral `LlmProvider`
 * contract as `GeminiProvider`. Function/tool declarations are translated from the
 * Gemini-style schema convention already used across this repo; message history is
 * accumulated in-process because, unlike the Gemini SDK, OpenAI's API is stateless.
 *
 * VERIFICATION STATUS: implemented and covered by tests using an injected fake client
 * (`openai.test.ts`) — translation of tool schemas, message-history bookkeeping across
 * multiple turns, and tool_call parsing are all exercised for real. End-to-end
 * verification against the REAL OpenAI API is NOT done — no `OPENAI_API_KEY` was
 * available in this environment. Wire a real key and re-run the agent loop with
 * `LLM_PROVIDER=openai` to close that gap.
 */
export class OpenAiProvider implements LlmProvider {
    readonly name = 'openai';

    constructor(
        private readonly model: string = DEFAULT_OPENAI_MODEL,
        private readonly clientFactory: () => OpenAiChatClient = () => new OpenAI() as unknown as OpenAiChatClient
    ) {}

    hasApiKey(): boolean {
        return hasOpenAiApiKey();
    }

    createChat(systemInstruction: string, tools: FunctionDeclaration[]): ChatLike {
        return new OpenAiChat(this.clientFactory(), this.model, toOpenAiTools(tools), systemInstruction);
    }
}
