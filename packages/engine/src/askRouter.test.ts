import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleAsk } from './askRouter';
import { parseTasks, extractTaskId } from './tasks';

let workspace: string;
let savedKey: string | undefined;
beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-askrouter-'));
    savedKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY']; // deterministic heuristic mode
});
afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
});

describe('handleAsk (simulation)', () => {
    it('a "hacer"-classified request queues a [now] task with a task-id, creating tasks.md from scratch', async () => {
        const outcome = await handleAsk(workspace, 'Crear un endpoint nuevo para usuarios');
        expect(outcome.interpretation.verb).toBe('hacer');

        const content = fs.readFileSync(path.join(workspace, 'tasks.md'), 'utf8');
        const now = parseTasks(content).now;
        expect(now.some((l) => l.includes('Crear un endpoint nuevo'))).toBe(true);
        expect(extractTaskId(now[0]!)).not.toBeNull();
    });

    it('appends to an existing tasks.md instead of overwriting it', async () => {
        fs.writeFileSync(
            path.join(workspace, 'tasks.md'),
            '# Plan de Tareas\n\n## [now]\n- [ ] Tarea preexistente\n\n## [next]\n\n## [blocked]\n\n## [improve]\n\n## [recurring]\n'
        );
        await handleAsk(workspace, 'Agregar tests al endpoint');

        const now = parseTasks(fs.readFileSync(path.join(workspace, 'tasks.md'), 'utf8')).now;
        expect(now.some((l) => l.includes('Tarea preexistente'))).toBe(true);
        expect(now.some((l) => l.includes('Agregar tests al endpoint'))).toBe(true);
    });

    it('an "automatizar"-classified request queues a [recurring] task with @every:1, not [now]', async () => {
        const outcome = await handleAsk(workspace, 'automatizá el backup semanal');
        expect(outcome.interpretation.verb).toBe('automatizar');

        const queues = parseTasks(fs.readFileSync(path.join(workspace, 'tasks.md'), 'utf8'));
        expect(queues.now).toHaveLength(0);
        expect(queues.recurring.some((l) => l.includes('automatizá el backup semanal'))).toBe(true);
        expect(queues.recurring.some((l) => l.includes('@every:1'))).toBe(true);
    });

    it('a "monitorear"-classified request also goes to [recurring]', async () => {
        const outcome = await handleAsk(workspace, 'monitoreá el servicio de pagos');
        expect(outcome.interpretation.verb).toBe('monitorear');
        const queues = parseTasks(fs.readFileSync(path.join(workspace, 'tasks.md'), 'utf8'));
        expect(queues.recurring.some((l) => l.includes('monitoreá el servicio de pagos'))).toBe(true);
    });

    it('a "detener"-classified request does NOT touch tasks.md', async () => {
        const outcome = await handleAsk(workspace, 'detené el daemon');
        expect(outcome.interpretation.verb).toBe('detener');
        expect(outcome.message).toContain('Ctrl-C');
        expect(fs.existsSync(path.join(workspace, 'tasks.md'))).toBe(false);
    });

    it('creates tasks.md for a recurring request even when it does not exist yet', async () => {
        await handleAsk(workspace, 'agendá un reporte semanal');
        const queues = parseTasks(fs.readFileSync(path.join(workspace, 'tasks.md'), 'utf8'));
        expect(queues.recurring.some((l) => l.includes('agendá un reporte semanal'))).toBe(true);
        expect(queues.now).toHaveLength(0);
    });
});
