import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { claimFileName } from './claims';

/**
 * `claims.test.ts` proves `claimTask`'s own logic is correct, but every call there runs
 * IN-PROCESS and SEQUENTIAL (`claimTask(A)` then `claimTask(B)`), so it never actually
 * exercises what cso-adn-1 flags as untested: whether the `wx`-flag exclusive-create in
 * `claims.ts` is truly atomic when two REAL, independent OS processes race for the same
 * lock file at (as close as possible to) the same instant. This suite spawns two real
 * `node` processes running `claimWorker.fixture.ts` and lets them race for real.
 */

let ws: string;
beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-claim-mp-'));
});
afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
});

const TSX_CLI = require.resolve('tsx/cli');
const FIXTURE = path.resolve(__dirname, 'claimWorker.fixture.ts');

interface WorkerResult {
    workerId: string;
    claimed: boolean;
}

function runWorker(workspacePath: string, taskKey: string, workerId: string, startAt: number): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [TSX_CLI, FIXTURE, workspacePath, taskKey, workerId, String(startAt)], {
            windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`worker ${workerId} exited with code ${code}. stderr: ${stderr}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout) as WorkerResult);
            } catch {
                reject(new Error(`worker ${workerId} produced non-JSON stdout: "${stdout}". stderr: ${stderr}`));
            }
        });
    });
}

describe('pull-based claiming across real OS processes', () => {
    it('lets exactly ONE of two concurrent real processes win the claim on the same lock file', async () => {
        const task = '- [ ] Tarea disputada entre procesos reales';
        // Give both child processes (tsx boot + esbuild transform) time to start up before
        // they race, so the race is decided by the filesystem, not by process-spawn jitter.
        const startAt = Date.now() + 500;

        const [a, b] = await Promise.all([
            runWorker(ws, task, 'proc-A', startAt),
            runWorker(ws, task, 'proc-B', startAt)
        ]);

        const winners = [a, b].filter((r) => r.claimed);
        expect(winners).toHaveLength(1);

        // The lock file must be well-formed JSON belonging to the winner. A torn/interleaved
        // write from two processes hitting the file concurrently would fail to parse or would
        // record the wrong worker — this is the actual corruption cso-adn-1 worried about.
        const lockFile = path.join(ws, 'runs', '.claims', claimFileName(task));
        const stored = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        expect(stored.workerId).toBe(winners[0]!.workerId);
    }, 20_000);
});
