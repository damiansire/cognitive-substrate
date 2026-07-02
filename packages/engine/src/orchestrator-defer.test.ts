import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The real `executeTaskWithLLM` degrades to a deterministic "simulated success" the
 * moment GEMINI_API_KEY is absent (see gemini-agent-loop/src/index.ts) — it never
 * reaches `dispatchTool`, so the governance-defer path can't be exercised offline
 * through it. The defer decision itself and the tasks.md move are both proven for real
 * elsewhere (governance.test.ts, tasks.test.ts, dispatch-defer.test.ts); this file
 * mocks ONLY the LLM call boundary — a genuinely external, paid, non-deterministic
 * dependency — to prove the orchestrator's glue around it (queue mutation, WorkspaceResult
 * shape, skipping verify/incident) is wired correctly end-to-end.
 */
vi.mock('@cognitive-substrate/gemini-agent-loop', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@cognitive-substrate/gemini-agent-loop')>();
    return { ...actual, executeTaskWithLLM: vi.fn() };
});

import { executeTaskWithLLM } from '@cognitive-substrate/gemini-agent-loop';
import { processWorkspace } from './orchestrator';
import { parseTasks, requeueApprovedTask } from './tasks';
import { countIncidents } from './incidents';

const mockedExecute = executeTaskWithLLM as unknown as ReturnType<typeof vi.fn>;

let root: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-orch-defer-'));
    mockedExecute.mockReset();
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('processWorkspace — governance defer pauses the task instead of failing it', () => {
    it('moves the task to [blocked] and skips verify/incident when awaitingApproval is set', async () => {
        fs.writeFileSync(
            path.join(root, 'tasks.md'),
            '# Plan de Tareas\n\n## [now]\n- [ ] borrar el build\n\n## [blocked]\n\n## [improve]\n\n## [recurring]\n'
        );
        mockedExecute.mockResolvedValue({
            success: false,
            log: 'esperando aprobación',
            awaitingApproval: { approvalId: 'appr-xyz', command: 'rm -rf build' }
        });

        const result = await processWorkspace(root, 'demo');

        expect(result.run).toBeNull();
        expect(result.summary).toContain('Esperando aprobación humana');
        expect(result.summary).toContain('appr-xyz');
        expect(countIncidents(root)).toBe(0); // not a failure — no incident recorded

        const tasksContent = fs.readFileSync(path.join(root, 'tasks.md'), 'utf8');
        const queues = parseTasks(tasksContent);
        expect(queues.now).toHaveLength(0);
        expect(tasksContent).toContain('pending-approval:appr-xyz');
        expect(fs.existsSync(path.join(root, 'FAILURE.md'))).toBe(false);
    });

    it('the requeued task is picked up and completes normally on the next tick', async () => {
        fs.writeFileSync(
            path.join(root, 'tasks.md'),
            '# Plan de Tareas\n\n## [now]\n- [ ] borrar el build\n\n## [blocked]\n\n## [improve]\n\n## [recurring]\n'
        );
        mockedExecute.mockResolvedValueOnce({
            success: false,
            log: 'esperando aprobación',
            awaitingApproval: { approvalId: 'appr-xyz', command: 'rm -rf build' }
        });
        await processWorkspace(root, 'demo');
        expect(parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8')).now).toHaveLength(0);

        // A human resolves it (simulating what the CLI/TUI 'approve' action does in Fase 1/2).
        const tasksPath = path.join(root, 'tasks.md');
        const requeued = requeueApprovedTask(fs.readFileSync(tasksPath, 'utf8'), 'appr-xyz');
        fs.writeFileSync(tasksPath, requeued, 'utf8');
        expect(parseTasks(requeued).now).toContain('- [ ] borrar el build');

        // Next tick: the LLM call (still mocked) now succeeds normally.
        mockedExecute.mockResolvedValueOnce({ success: true, log: 'Simulated success' });
        const result = await processWorkspace(root, 'demo');
        expect(result.run).not.toBeNull();
    });
});
