import { describe, it, expect, vi } from 'vitest';

// Wrap readRun with a call counter (delegating to the real impl) so we can prove the KPI
// scan STOPS at the window boundary instead of reading every run.json in history. Kept in
// its own file so the spy doesn't perturb the behavioral tests in kpis.test.ts.
const readRunCalls: string[] = [];
vi.mock('./evidence', async () => {
    const actual = await vi.importActual<typeof import('./evidence')>('./evidence');
    return {
        ...actual,
        readRun: (workspacePath: string, evidencePath: string) => {
            readRunCalls.push(evidencePath);
            return actual.readRun(workspacePath, evidencePath);
        }
    };
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeWorkspaceKpis } from './kpis';
import { recordRun } from './evidence';
import type { Verdict } from './types';

const okVerdict: Verdict = { verified: true, reason: 'ok', checks: [] };

describe('computeWorkspaceKpis — early termination', () => {
    it('stops reading run.json once dirs fall outside the window (bounds work to the window)', () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-kpis-et-'));
        try {
            const now = new Date('2026-07-01T12:00:00Z');
            // One recent run (in the 7-day window) + three ancient ones (Jan), all via the
            // real recordRun so their dir names carry the real timestamp prefix.
            const mk = (startedAt: Date) =>
                recordRun({
                    workspacePath: workspace,
                    task: `t-${startedAt.toISOString()}`,
                    startedAt,
                    finishedAt: new Date(startedAt.getTime() + 1000),
                    executionSuccess: true,
                    verdict: okVerdict,
                    log: 'l',
                    learning: ''
                });
            mk(new Date('2026-06-30T09:00:00Z')); // in window
            mk(new Date('2026-01-03T09:00:00Z'));
            mk(new Date('2026-01-02T09:00:00Z'));
            mk(new Date('2026-01-01T09:00:00Z'));

            readRunCalls.length = 0;
            const kpis = computeWorkspaceKpis(workspace, now, 7);

            // Correctness preserved: only the recent run counts.
            expect(kpis.runsTotal).toBe(1);
            // Early-terminate: read the one in-window run, then break at the first old dir.
            // Without the optimization this would be 4 reads (the whole history).
            expect(readRunCalls).toHaveLength(1);
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });
});
