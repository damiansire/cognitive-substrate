import { generateJson, hasApiKey } from '@cognitive-substrate/gemini-agent-loop';
import { humanTaskText } from './tasks';
import type { Verdict } from './types';

const SYSTEM_PROMPT = `Eres el módulo de auto-mejora del Cognitive Substrate OS. Dada una tarea que falló su verificación y la razón, proponés UNA única acción concreta y accionable que probablemente la desbloquee la próxima vez (cambiar UNA variable, no una lista). Respondés SOLO con JSON.`;

/**
 * Proposes a single concrete improvement action for a task that failed verification.
 * This is the seed of the self-improvement loop: failures become sharper, actionable
 * follow-ups (one variable at a time) instead of vague "investigate" notes.
 *
 * Deterministic fallback in simulation mode.
 */
export async function proposeImprovement(task: string, verdict: Verdict, log: string): Promise<string> {
    const cleanTask = humanTaskText(task);
    const failedChecks = verdict.checks.filter((c) => !c.passed).map((c) => c.name);
    const fallback = `Reintentar "${cleanTask}" corrigiendo: ${verdict.reason}${
        failedChecks.length ? ` (checks fallidos: ${failedChecks.join(', ')})` : ''
    }`;

    if (!hasApiKey()) return fallback;

    const userPrompt = `Tarea fallida: ${cleanTask}\nRazón: ${verdict.reason}\nChecks fallidos: ${failedChecks.join(', ') || '(ninguno)'}\nLog:\n${log.slice(0, 3000)}\n\nDevolvé JSON {"action": "una acción concreta"}.`;
    const result = await generateJson<{ action?: string }>(SYSTEM_PROMPT, userPrompt);
    return result?.action?.trim() || fallback;
}
