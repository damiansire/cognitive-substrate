import * as fs from 'fs';
import * as path from 'path';
import { runOnce, processWorkspace, type Clock } from './orchestrator';
import { renderDashboard } from './dashboard';
import type { WorkspaceResult } from './types';

const DEFAULT_INTERVAL_MS = 30_000;

/** Writes the control dashboard for a set of results to `<rootDir>/<file>`. */
export function writeDashboard(
    rootDir: string,
    mode: 'local' | 'global',
    results: WorkspaceResult[],
    when: Date,
    file = 'dashboard.md'
): string {
    const content = renderDashboard({ mode, updatedAt: when, results });
    const target = path.resolve(rootDir, file);
    fs.writeFileSync(target, content, 'utf8');
    return target;
}

/**
 * One full tick in GLOBAL mode: process every workspace concurrently and refresh
 * the dashboard. Returns the per-workspace results.
 */
export async function tickGlobal(rootDir: string, clock: Clock = () => new Date()): Promise<WorkspaceResult[]> {
    const workspacesDir = path.resolve(rootDir, 'workspaces');
    const results = await runOnce(workspacesDir, clock);
    writeDashboard(rootDir, 'global', results, clock());
    return results;
}

/**
 * One full tick in LOCAL mode: the current directory IS the single workspace.
 */
export async function tickLocal(
    rootDir: string,
    project = 'Local Project',
    clock: Clock = () => new Date()
): Promise<WorkspaceResult[]> {
    const result = await processWorkspace(rootDir, project, clock);
    const results = [result];
    writeDashboard(rootDir, 'local', results, clock(), 'local_dashboard.md');
    return results;
}

export interface DaemonOptions {
    rootDir: string;
    mode: 'local' | 'global';
    intervalMs?: number;
    /** Stop after this many ticks (default: run until aborted). Useful for evals. */
    maxTicks?: number;
    signal?: AbortSignal;
    clock?: Clock;
}

/**
 * Runs the OS as a continuous daemon: ticks on an interval until aborted (SIGINT)
 * or until `maxTicks` is reached. Each tick is awaited fully before sleeping, so
 * ticks never overlap. Returns the results of the final tick.
 */
export async function runDaemon(opts: DaemonOptions): Promise<WorkspaceResult[]> {
    const { rootDir, mode, intervalMs = DEFAULT_INTERVAL_MS, maxTicks, signal, clock } = opts;
    const tick = mode === 'global' ? tickGlobal : (r: string, c?: Clock) => tickLocal(r, 'Local Project', c);

    let ticks = 0;
    let lastResults: WorkspaceResult[] = [];
    while (!signal?.aborted) {
        lastResults = await tick(rootDir, clock);
        ticks++;
        if (maxTicks && ticks >= maxTicks) break;
        if (signal?.aborted) break;
        await sleep(intervalMs, signal);
    }
    return lastResults;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true }
        );
    });
}
