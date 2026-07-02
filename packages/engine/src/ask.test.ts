import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { interpretAsk, type AskVerb, type AskMode } from './ask';

const ALL_VERBS: AskVerb[] = [
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
const ALL_MODES: AskMode[] = [
    'respuesta',
    'borrador',
    'plan',
    'ejecucion_unica',
    'objetivo_largo_plazo',
    'automatizacion_recurrente',
    'reporte'
];

let savedKey: string | undefined;
beforeEach(() => {
    savedKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY']; // force the heuristic fallback (simulation mode)
});
afterEach(() => {
    if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
});

describe('interpretAsk (heuristic, no API key)', () => {
    it.each([
        ['pausá el daemon', 'detener'],
        ['reintentá la tarea que falló', 'reintentar'],
        ['escalá esto a un humano', 'escalar'],
        ['simplificá el plan', 'simplificar'],
        ['monitoreá el servicio', 'monitorear'],
        ['automatizá el backup semanal', 'automatizar'],
        ['agendá un reporte los lunes', 'agendar'],
        ['compará estos dos workspaces', 'comparar'],
        ['inspeccioná el último incidente', 'inspeccionar'],
        ['explicame por qué falló', 'explicar'],
        ['¿cuál es el estado del proyecto?', 'responder']
    ] as const)('classifies "%s" as verb "%s"', async (text, expectedVerb) => {
        const result = await interpretAsk(text);
        expect(result.verb).toBe(expectedVerb);
        expect(ALL_MODES).toContain(result.mode);
    });

    it('defaults to hacer/ejecucion_unica for free-form text with no recognized verb', async () => {
        const result = await interpretAsk('Crear un endpoint nuevo para usuarios');
        expect(result.verb).toBe('hacer');
        expect(result.mode).toBe('ejecucion_unica');
    });

    it('always returns a verb and mode from the known enums, with confidence in [0,1]', async () => {
        for (const text of ['algo random', '', 'test 123', ALL_VERBS.join(' ')]) {
            const result = await interpretAsk(text);
            expect(ALL_VERBS).toContain(result.verb);
            expect(ALL_MODES).toContain(result.mode);
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
        }
    });

    it('reports a low confidence for heuristic matches (never claims certainty)', async () => {
        const result = await interpretAsk('detené todo');
        expect(result.confidence).toBeLessThan(0.6);
    });
});
