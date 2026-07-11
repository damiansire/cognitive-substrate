import { describe, it, expect } from 'vitest';
import { selectProvider } from './index';
import { GeminiProvider } from './gemini';
import { OpenAiProvider } from './openai';

describe('selectProvider', () => {
    it('defaults to Gemini when LLM_PROVIDER is unset — unchanged prior behavior', () => {
        expect(selectProvider({})).toBeInstanceOf(GeminiProvider);
    });

    it('defaults to Gemini for an unrecognized value (fail-safe to the known provider)', () => {
        expect(selectProvider({ LLM_PROVIDER: 'anthropic' })).toBeInstanceOf(GeminiProvider);
    });

    it('selects OpenAI when explicitly requested', () => {
        expect(selectProvider({ LLM_PROVIDER: 'openai' })).toBeInstanceOf(OpenAiProvider);
    });
});
