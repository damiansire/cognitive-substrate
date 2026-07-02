import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { proposeImprovement } from './improve';
import { processWorkspace } from './orchestrator';
import { parseTasks } from './tasks';
import type { Verdict } from './types';

let root: string;
let savedKey: string | undefined;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-improve-'));
    savedKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
});

const failVerdict: Verdict = {
    verified: false,
    reason: 'faltó crear el archivo',
    checks: [{ name: 'archivo-existe:x.txt', passed: false, detail: 'no existe' }]
};

describe('proposeImprovement (simulation)', () => {
    it('produces a concrete, single follow-up referencing the failure', async () => {
        const action = await proposeImprovement('- [ ] Crear x.txt', failVerdict, 'log');
        expect(action).toContain('Crear x.txt');
        expect(action).toContain('archivo-existe:x.txt');
    });

    it('never leaks the (task-id:...) bookkeeping annotation into the generated text', async () => {
        const action = await proposeImprovement('- [ ] Crear x.txt (task-id:task-123)', failVerdict, 'log');
        expect(action).toContain('Crear x.txt');
        expect(action).not.toContain('task-id');
    });
});

describe('self-improvement loop', () => {
    it('drains the [improve] queue once [now] is empty', async () => {
        // [now] empty, one [improve] item that will verify (no missing files).
        const content = [
            '# Plan',
            '',
            '## [now]',
            '',
            '## [improve] - Auto-Mejora y Correcciones',
            '- [ ] Saludar al usuario amablemente',
            ''
        ].join('\n');
        fs.writeFileSync(path.join(root, 'tasks.md'), content);

        const result = await processWorkspace(root, 'demo');
        expect(result.run).not.toBeNull();

        const tasks = fs.readFileSync(path.join(root, 'tasks.md'), 'utf8');
        // The improve item was processed and marked done (it verified in simulation).
        expect(tasks).toContain('- [x] Saludar al usuario amablemente');
    });

    it('does not re-spawn improvements from a failed [improve] task (converges)', async () => {
        const content = [
            '# Plan',
            '',
            '## [now]',
            '',
            '## [improve] - Auto-Mejora y Correcciones',
            '- [ ] Crear archivo-imposible-zzz.txt',
            ''
        ].join('\n');
        fs.writeFileSync(path.join(root, 'tasks.md'), content);

        await processWorkspace(root, 'demo');
        const improveCount = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8')).improve.length;
        // The failed improve task is marked [!]; no new improve item is queued.
        expect(improveCount).toBe(0);
    });
});
