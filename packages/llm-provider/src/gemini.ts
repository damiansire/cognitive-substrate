import { GoogleGenAI, type Part, type PartListUnion } from '@google/genai';
import type { AgentResponse, ChatLike, ChatTurn, FunctionDeclaration, LlmProvider } from './types';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** True when a usable Gemini API key is configured — same rule the original
 * (pre-multi-provider) `gemini-agent-loop/src/client.ts#hasApiKey` used, preserved so
 * default behavior (LLM_PROVIDER unset) is byte-for-byte identical to before. */
function hasGeminiApiKey(): boolean {
    const key = process.env['GEMINI_API_KEY'];
    return !!key && !key.includes('tu_clave_aqui');
}

function turnToMessage(turn: ChatTurn): PartListUnion {
    if (turn.kind === 'text') return turn.text;
    return turn.results.map(
        (r): Part => ({
            functionResponse: { id: r.callId, name: r.name, response: { output: r.output } }
        })
    );
}

class GeminiChat implements ChatLike {
    constructor(private readonly session: { sendMessage(input: { message: PartListUnion }): Promise<AgentResponse> }) {}

    async sendMessage(turn: ChatTurn): Promise<AgentResponse> {
        return this.session.sendMessage({ message: turnToMessage(turn) });
    }
}

/**
 * Wraps `@google/genai`'s stateful chat session behind the vendor-neutral `LlmProvider`
 * contract. This is a pure adapter — no behavior change from the original inline
 * implementation in `gemini-agent-loop/src/index.ts`.
 */
export class GeminiProvider implements LlmProvider {
    readonly name = 'gemini';

    constructor(private readonly model: string = DEFAULT_GEMINI_MODEL) {}

    hasApiKey(): boolean {
        return hasGeminiApiKey();
    }

    createChat(systemInstruction: string, tools: FunctionDeclaration[]): ChatLike {
        const ai = new GoogleGenAI({ apiKey: process.env['GEMINI_API_KEY'] });
        const session = ai.chats.create({
            model: this.model,
            config: {
                systemInstruction,
                tools: [{ functionDeclarations: tools as any }],
                temperature: 0.2
            }
        });
        return new GeminiChat(session as any);
    }
}
