/**
 * Fixture spawned as a REAL, separate OS process by `claims.multiprocess.test.ts`.
 *
 * The existing `behavioral-worker-claiming` eval case (and the unit tests in
 * `claims.test.ts`) only ever call `claimTask` sequentially, in-process — that proves
 * the function's own logic is correct, but it can never exercise the actual guarantee
 * we depend on: that `fs.writeFileSync(..., { flag: 'wx' })` is atomic across two
 * independent OS processes racing for the same file. This fixture is that second,
 * real process.
 *
 * Not a `.test.ts` file on purpose (excluded from `tsc --build` via the
 * `**\/*.fixture.ts` pattern in tsconfig.base.json) — it is a script, not a test.
 *
 * argv: workspacePath taskKey workerId startAtEpochMs
 */
import { claimTask } from './claims';

const [, , workspacePath, taskKey, workerId, startAtRaw] = process.argv;

if (!workspacePath || !taskKey || !workerId || !startAtRaw) {
    console.error('claimWorker.fixture: expected argv <workspacePath> <taskKey> <workerId> <startAtEpochMs>');
    process.exit(2);
}

const startAt = Number(startAtRaw);

// Busy-wait (not setTimeout) until the shared start instant so both sibling processes
// attempt the claim as close together as possible, instead of racing purely on however
// fast each one happened to boot.
while (Date.now() < startAt) {
    /* spin */
}

const claimed = claimTask(workspacePath, taskKey, workerId);
process.stdout.write(JSON.stringify({ workerId, claimed }));
process.exit(0);
