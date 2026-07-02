import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { processWorkspace, intakeGoal, runOnce } from './orchestrator';
import { runDaemon, tickGlobal } from './daemon';
import { parseTasks } from './tasks';

let root: string;
let savedKey: string | undefined;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-orch-'));
    savedKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY']; // deterministic simulation mode (offline eval)
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
});

describe('intakeGoal', () => {
    it('decomposes a goal into tasks.md exactly once', async () => {
        fs.writeFileSync(path.join(root, 'goal.md'), 'Escribir un saludo amable');
        const added = await intakeGoal(root);
        expect(added).toBe(1);

        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.now[0]).toContain('Escribir un saludo amable');

        // Idempotent: second intake does nothing (marker present).
        expect(await intakeGoal(root)).toBe(0);
    });
});

describe('processWorkspace — FIRST MILESTONE loop end-to-end (simulation)', () => {
    it('goal -> decompose -> execute -> verify -> evidence -> memory -> queue update', async () => {
        fs.writeFileSync(path.join(root, 'goal.md'), 'Escribir un saludo amable');

        const result = await processWorkspace(root, 'demo');

        // Executed and verified with evidence on disk.
        expect(result.run).not.toBeNull();
        expect(result.run!.verdict.verified).toBe(true);
        const evidenceDir = path.resolve(root, result.run!.evidencePath);
        expect(fs.existsSync(path.join(evidenceDir, 'run.json'))).toBe(true);
        expect(fs.existsSync(path.join(evidenceDir, 'summary.md'))).toBe(true);

        // Task marked done in the queue (only WITH evidence).
        const tasksContent = fs.readFileSync(path.join(root, 'tasks.md'), 'utf8');
        expect(tasksContent).toContain('- [x] Escribir un saludo amable');

        // Learning recorded to archival memory.
        const knowledge = fs.readFileSync(path.join(root, 'knowledge.md'), 'utf8');
        expect(knowledge.length).toBeGreaterThan(0);

        // Human-readable summary produced.
        expect(result.summary).toContain('Verificado');

        // The run's evidence carries the task-id embedded by intake, for drill-down.
        expect(result.run!.taskId).toMatch(/^task-/);
    });

    it('records a failure (no [x]) and queues an improve task when verification fails', async () => {
        // A goal that references a file the simulated agent never creates -> verification fails.
        fs.writeFileSync(path.join(root, 'goal.md'), 'Crear el archivo entrega-final.txt');

        const result = await processWorkspace(root, 'demo');
        expect(result.run!.verdict.verified).toBe(false);

        const tasksContent = fs.readFileSync(path.join(root, 'tasks.md'), 'utf8');
        expect(tasksContent).toContain('- [!] Crear el archivo entrega-final.txt');
        // A concrete improvement follow-up was queued under [improve].
        expect(parseTasks(tasksContent).improve.length).toBeGreaterThan(0);
        expect(fs.existsSync(path.join(root, 'FAILURE.md'))).toBe(true);
    });
});

describe('global daemon', () => {
    it('processes multiple workspaces concurrently and writes a dashboard', async () => {
        const wsDir = path.join(root, 'workspaces');
        for (const name of ['alpha', 'beta']) {
            const ws = path.join(wsDir, name);
            fs.mkdirSync(ws, { recursive: true });
            fs.writeFileSync(path.join(ws, 'goal.md'), `Saludar desde ${name}`);
        }

        const results = await runOnce(wsDir);
        expect(results).toHaveLength(2);
        expect(results.every((r) => r.run?.verdict.verified)).toBe(true);

        await tickGlobal(root);
        const dashboard = fs.readFileSync(path.join(root, 'dashboard.md'), 'utf8');
        expect(dashboard).toContain('Daemon Global');
        expect(dashboard).toContain('alpha');
        expect(dashboard).toContain('beta');
    });

    it('runDaemon stops after maxTicks', async () => {
        fs.mkdirSync(path.join(root, 'workspaces', 'solo'), { recursive: true });
        fs.writeFileSync(path.join(root, 'workspaces', 'solo', 'goal.md'), 'Saludar');
        const results = await runDaemon({ rootDir: root, mode: 'global', maxTicks: 2, intervalMs: 1 });
        expect(Array.isArray(results)).toBe(true);
    });
});
