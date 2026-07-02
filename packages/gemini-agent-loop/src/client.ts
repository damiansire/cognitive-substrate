import { GoogleGenAI } from '@google/genai';
import { recordLlmCall } from './metrics';

export const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_BACKOFF_ATTEMPTS = 3;

/**
 * True when a usable Gemini API key is configured. When false the system runs in
 * "simulation mode": LLM-backed steps degrade to deterministic fallbacks so the OS
 * (and its offline evals/tests) keep working without network or credentials.
 */
export function hasApiKey(): boolean {
    const key = process.env['GEMINI_API_KEY'];
    return !!key && !key.includes('tu_clave_aqui');
}

function getClient(): GoogleGenAI {
    return new GoogleGenAI({ apiKey: process.env['GEMINI_API_KEY'] });
}

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
    let attempts = 0;
    while (true) {
        try {
            return await fn();
        } catch (apiError: any) {
            attempts++;
            const status = apiError?.status || 500;
            const retryable = status === 429 || status === 503;
            if (!retryable || attempts >= MAX_BACKOFF_ATTEMPTS) throw apiError;
            const waitTime = Math.pow(2, attempts) * 1000;
            console.warn(`>>> [LLM] ${status} detectado. Reintentando en ${waitTime}ms...`);
            await new Promise((r) => setTimeout(r, waitTime));
        }
    }
}

/**
 * One-shot structured generation. Asks the model to return JSON and parses it.
 * Returns `null` when no API key is configured (simulation mode) so callers can
 * fall back to deterministic behavior.
 *
 * @param systemPrompt - High-level instruction / role.
 * @param userPrompt - The concrete request.
 * @param model - Model id (defaults to gemini-2.5-flash).
 */
export async function generateJson<T = unknown>(
    systemPrompt: string,
    userPrompt: string,
    model: string = DEFAULT_MODEL
): Promise<T | null> {
    if (!hasApiKey()) return null;

    const ai = getClient();
    const response = await withBackoff(() => {
        recordLlmCall();
        return ai.models.generateContent({
            model,
            contents: userPrompt,
            config: {
                systemInstruction: systemPrompt,
                temperature: 0.2,
                responseMimeType: 'application/json'
            }
        });
    });

    const text = response.text?.trim();
    if (!text) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
        // Strip markdown code fences if the model wrapped the JSON.
        const cleaned = text
            .replace(/^```(?:json)?/i, '')
            .replace(/```$/, '')
            .trim();
        try {
            return JSON.parse(cleaned) as T;
        } catch {
            return null;
        }
    }
}
