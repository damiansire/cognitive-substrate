import { generateJson, hasApiKey } from '@cognitive-substrate/gemini-agent-loop';

/**
 * The 12 control verbs from the charter's "ASK BAR UNIVERSAL" doctrine
 * (docs/vision/07-interfaz-y-ux.md). `aprobar`/`denegar`/`estado` are deliberately NOT
 * here — those are precise commands with concrete side effects, handled as local regex
 * shortcuts in `cmdAsk` (apps/cli/src/commands.ts), never routed through the LLM.
 */
export type AskVerb =
    | 'responder'
    | 'explicar'
    | 'hacer'
    | 'monitorear'
    | 'automatizar'
    | 'agendar'
    | 'comparar'
    | 'inspeccionar'
    | 'detener'
    | 'reintentar'
    | 'escalar'
    | 'simplificar';

/** The 7 response modes the charter expects the system to INFER, not have declared. */
export type AskMode =
    | 'respuesta'
    | 'borrador'
    | 'plan'
    | 'ejecucion_unica'
    | 'objetivo_largo_plazo'
    | 'automatizacion_recurrente'
    | 'reporte';

export interface AskInterpretation {
    verb: AskVerb;
    mode: AskMode;
    /** 0-1. Heuristic fallback always reports a low confidence — it's pattern matching,
     * not understanding, and callers/UI should be able to tell the difference. */
    confidence: number;
}

const VERBS: readonly AskVerb[] = [
    'responder',
    'explicar',
    'hacer',
    'monitorear',
    'automatizar',
    'agendar',
    'comparar',
    'inspeccionar',
    'detener',
    'reintentar',
    'escalar',
    'simplificar'
];

const MODES: readonly AskMode[] = [
    'respuesta',
    'borrador',
    'plan',
    'ejecucion_unica',
    'objetivo_largo_plazo',
    'automatizacion_recurrente',
    'reporte'
];

// JS regex `\b` is ASCII-only — it doesn't treat accented letters (á, é, í, ó, ú, ñ) as
// "word" characters, so `\bpausá\b` silently never matches (no boundary right after the
// á). `wordMatch` builds a boundary-safe alternation by hand instead, so voseo
// imperatives ("pausá", "agendá", "compará"...) — the everyday register this OS's own
// copy already uses — actually match.
function wordMatch(...forms: string[]): RegExp {
    const alternation = forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return new RegExp(`(?<![a-záéíóúñ])(?:${alternation})(?![a-záéíóúñ])`, 'i');
}

/** Ordered so the first match wins — more specific verbs before generic ones. */
const HEURISTIC_RULES: ReadonlyArray<{ verb: AskVerb; mode: AskMode; re: RegExp }> = [
    // "pará"/"detené" (accented) only, never bare "para" — that's the extremely common
    // preposition "for/to", not the imperative of "parar".
    {
        verb: 'detener',
        mode: 'reporte',
        re: wordMatch('detener', 'detené', 'detén', 'pausar', 'pausá', 'pausa', 'parar', 'pará')
    },
    { verb: 'reintentar', mode: 'ejecucion_unica', re: wordMatch('reintentar', 'reintentá', 'reintenta') },
    { verb: 'escalar', mode: 'reporte', re: wordMatch('escalar', 'escalá', 'escala') },
    { verb: 'simplificar', mode: 'plan', re: wordMatch('simplificar', 'simplificá', 'simplifica') },
    {
        verb: 'monitorear',
        mode: 'automatizacion_recurrente',
        re: wordMatch('monitorear', 'monitoreá', 'monitorea', 'vigilar', 'vigilá', 'vigila')
    },
    {
        verb: 'automatizar',
        mode: 'automatizacion_recurrente',
        re: wordMatch('automatizar', 'automatizá', 'automatiza')
    },
    {
        verb: 'agendar',
        mode: 'automatizacion_recurrente',
        re: wordMatch('agendar', 'agendá', 'agenda', 'programar', 'programá', 'programa')
    },
    { verb: 'comparar', mode: 'reporte', re: wordMatch('comparar', 'compará', 'compara') },
    {
        verb: 'inspeccionar',
        mode: 'reporte',
        re: wordMatch('inspeccionar', 'inspeccioná', 'inspecciona', 'revisar', 'revisá', 'revisa')
    },
    { verb: 'explicar', mode: 'respuesta', re: wordMatch('explicar', 'explicá', 'explica', 'explicame') },
    { verb: 'responder', mode: 'respuesta', re: /\?\s*$|^(qu[ée]|c[óo]mo|cu[áa]l|cu[áa]ndo|por qu[ée])\b/i }
];

/** Heuristic, not NLU — a fixed pattern-match table, same honesty as the CLI's
 * original 4-verb version. Used as-is without an API key, and as the fallback when the
 * model call fails or returns something outside the known enums. */
function heuristicInterpret(text: string): AskInterpretation {
    const lowered = text.toLowerCase();
    for (const rule of HEURISTIC_RULES) {
        if (rule.re.test(lowered)) return { verb: rule.verb, mode: rule.mode, confidence: 0.5 };
    }
    return { verb: 'hacer', mode: 'ejecucion_unica', confidence: 0.2 };
}

const SYSTEM_PROMPT = `Eres el intérprete del ask bar del Cognitive Substrate OS. Dado un pedido en lenguaje natural, clasificás DOS cosas: el verbo de control (qué tipo de acción pide) y el modo de respuesta (qué forma debería tomar el resultado). Respondés SOLO con JSON.`;

/**
 * Classifies free-form ask-bar text into a control verb + response mode. Uses the model
 * when available (same `generateJson` client the rest of the engine already uses, e.g.
 * `decomposition.ts`), with a deterministic heuristic fallback — no API key, a failed
 * call, or a response outside the known enums all degrade to the same heuristic rather
 * than throwing.
 */
export async function interpretAsk(text: string): Promise<AskInterpretation> {
    const trimmed = text.trim();
    const fallback = heuristicInterpret(trimmed);
    if (!hasApiKey()) return fallback;

    const userPrompt = `Pedido del usuario: "${trimmed}"\n\nDevolvé JSON {"verb": "<uno de: ${VERBS.join(', ')}>", "mode": "<uno de: ${MODES.join(', ')}>", "confidence": <número entre 0 y 1>}.`;
    const result = await generateJson<{ verb?: string; mode?: string; confidence?: number }>(SYSTEM_PROMPT, userPrompt);
    if (!result) return fallback;

    const verb = VERBS.includes(result.verb as AskVerb) ? (result.verb as AskVerb) : null;
    const mode = MODES.includes(result.mode as AskMode) ? (result.mode as AskMode) : null;
    if (!verb || !mode) return fallback;

    const confidence =
        typeof result.confidence === 'number' && result.confidence >= 0 && result.confidence <= 1
            ? result.confidence
            : 0.7;
    return { verb, mode, confidence };
}
