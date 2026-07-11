/**
 * Provider-agnostic contract for the agent loop's chat/tool-calling surface. Any LLM
 * backend (Gemini today, OpenAI or others tomorrow) implements `LlmProvider` and the
 * rest of the system (`gemini-agent-loop`'s `executeTaskWithLLM`) never touches a
 * vendor SDK directly.
 */

/** One model function-call as the loop consumes it — vendor-neutral shape. */
export interface AgentFunctionCall {
    id?: string;
    name?: string;
    args?: unknown;
}

/** The model response shape the loop reads — vendor-neutral shape. */
export interface AgentResponse {
    text?: string;
    functionCalls?: AgentFunctionCall[];
}

/** A single JSON-Schema-ish property, matching the loose shape already used in
 * `gemini-agent-loop/src/schemas.ts` (Gemini's `type: 'OBJECT'|'STRING'|...`
 * convention — providers translate this to their own SDK's expected casing). */
export interface FunctionParameterSchema {
    type: string;
    description?: string;
    properties?: Record<string, FunctionParameterSchema>;
    required?: string[];
    items?: FunctionParameterSchema;
}

/** One tool the model may call, in the same shape as `toolDeclarations`. */
export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters?: FunctionParameterSchema;
}

/** One already-resolved tool result to feed back to the model, keyed to the call that
 * produced it. Vendor-neutral: each provider translates this into its own "tool
 * result" message shape (Gemini's `functionResponse` Part, OpenAI's `tool` message). */
export interface ToolResultPart {
    callId?: string;
    name?: string;
    output: string;
}

/** A single turn sent to `ChatLike.sendMessage`: either the next user-facing text, or
 * a batch of tool results answering the model's most recent function calls. */
export type ChatTurn = { kind: 'text'; text: string } | { kind: 'toolResults'; results: ToolResultPart[] };

/** The minimal chat surface the core loop drives — one implementation per provider. */
export interface ChatLike {
    sendMessage(turn: ChatTurn): Promise<AgentResponse>;
}

/** A provider: given a system prompt and the available tools, hands back a fresh
 * stateful chat session. Implementations own their own vendor SDK client and message
 * history bookkeeping (Gemini's SDK is stateful; OpenAI's is not, so the OpenAI
 * adapter accumulates history itself behind the same `ChatLike` contract). */
export interface LlmProvider {
    readonly name: string;
    /** True when this provider has a usable API key configured. When false the agent
     * loop degrades to simulation mode for this provider, exactly like the original
     * Gemini-only `hasApiKey()` did. */
    hasApiKey(): boolean;
    createChat(systemInstruction: string, tools: FunctionDeclaration[]): ChatLike;
}
