import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLlmCalls, resetLlmCalls, hasApiKey } from '@cognitive-substrate/gemini-agent-loop';
import type { EvalCase, EvalReport, EvalResult, CategorySummary } from './types';

/** Millisecond clock seam (so tests don't depend on wall time). */
export type Now = () => number;
const defaultNow: Now = () => Date.now();

/**
 * Removes a workspace dir, retrying past a transient EPERM/EBUSY.
 *
 * On Windows, forcibly killing a process tree (see `adversarial-resource-exhaustion` /
 * `sandbox-terminal`'s `killProcessTree`) can leave the OS holding the directory handle
 * open for a brief moment after the process is already gone from the process list —
 * an immediate `rmSync` can lose that race with EPERM. Retrying with backoff is the
 * standard mitigation (same pattern `rimraf` uses on Windows) rather than failing the
 * whole eval run over a lock that clears itself within milliseconds.
 */
async function rmWorkspace(workspace: string, attempts = 5): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            fs.rmSync(workspace, { recursive: true, force: true });
            return;
        } catch (e: any) {
            const transient = e?.code === 'EPERM' || e?.code === 'EBUSY';
            if (!transient || attempt === attempts) throw e;
            await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        }
    }
}

/** Runs a single case in a fresh temp workspace, measuring time and model cost. */
export async function runCase(c: EvalCase, now: Now = defaultNow): Promise<EvalResult> {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `csos-eval-${c.id}-`));
    const startCalls = getLlmCalls();
    const start = now();
    let result: EvalResult;
    try {
        const outcome = await c.run({ workspace });
        result = {
            id: c.id,
            category: c.category,
            description: c.description,
            passed: outcome.passed,
            detail: outcome.detail,
            durationMs: now() - start,
            llmCalls: getLlmCalls() - startCalls
        };
    } catch (e: any) {
        result = {
            id: c.id,
            category: c.category,
            description: c.description,
            passed: false,
            detail: 'La case lanzó una excepción.',
            durationMs: now() - start,
            llmCalls: getLlmCalls() - startCalls,
            error: e?.message ?? String(e)
        };
    } finally {
        await rmWorkspace(workspace);
    }
    return result;
}

/** Runs all cases sequentially and aggregates an honest report. */
export async function runEvals(cases: EvalCase[], now: Now = defaultNow): Promise<EvalReport> {
    resetLlmCalls();
    const results: EvalResult[] = [];
    for (const c of cases) {
        results.push(await runCase(c, now));
    }

    const passed = results.filter((r) => r.passed).length;
    const byCategory: Record<string, CategorySummary> = {};
    for (const r of results) {
        const bucket = (byCategory[r.category] ??= { total: 0, passed: 0 });
        bucket.total++;
        if (r.passed) bucket.passed++;
    }

    return {
        generatedAt: new Date().toISOString(),
        simulation: !hasApiKey(),
        total: results.length,
        passed,
        passRate: results.length ? passed / results.length : 0,
        totalDurationMs: results.reduce((a, r) => a + r.durationMs, 0),
        totalLlmCalls: results.reduce((a, r) => a + r.llmCalls, 0),
        byCategory,
        results
    };
}
