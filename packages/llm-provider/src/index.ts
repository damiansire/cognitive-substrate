export * from './types';
export { GeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini';
export { OpenAiProvider, DEFAULT_OPENAI_MODEL, toJsonSchema, toOpenAiTools, type OpenAiChatClient } from './openai';

import { GeminiProvider } from './gemini';
import { OpenAiProvider } from './openai';
import type { LlmProvider } from './types';

/**
 * Picks the active provider from `LLM_PROVIDER` ('gemini' | 'openai'), defaulting to
 * 'gemini' so existing behavior (no env var set) is unchanged. Any other/unset value
 * falls back to Gemini rather than throwing — fail-safe to the provider this repo was
 * built around, not fail-open to an unconfigured one.
 */
export function selectProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
    return env['LLM_PROVIDER'] === 'openai' ? new OpenAiProvider() : new GeminiProvider();
}
