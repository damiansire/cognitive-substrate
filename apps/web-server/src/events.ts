import * as fs from 'fs';
import * as path from 'path';

/**
 * Watches the files that make up a workspace's on-disk state — `tasks.md`,
 * `approvals.json`, `incidents.jsonl` (all direct children of `workspacePath`) plus the
 * `runs/` directory (new run subfolders appearing) — and calls `onChange` (debounced,
 * since a single logical event often touches more than one file, e.g. `recordRun`
 * writing `run.json` then `summary.md`).
 *
 * Non-recursive on purpose: `fs.watch({recursive:true})` isn't reliable on Linux. This
 * only needs to know THAT something changed, not what — the caller always re-fetches
 * the real state from `readModel.ts` afterwards, same as a poll would.
 *
 * Returns a cleanup function that closes every underlying watcher.
 */
export function watchWorkspace(workspacePath: string, onChange: () => void, debounceMs = 200): () => void {
    const watchers: fs.FSWatcher[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    function scheduleNotify(): void {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            onChange();
        }, debounceMs);
    }

    function safeWatch(target: string): void {
        try {
            watchers.push(fs.watch(target, scheduleNotify));
        } catch {
            // Doesn't exist yet (e.g. `runs/` before the first run ever happens in this
            // workspace) — nothing to watch. A fresh SSE connection after it's created
            // (the client reconnects on its own) will pick it up.
        }
    }

    safeWatch(workspacePath);
    safeWatch(path.join(workspacePath, 'runs'));

    return () => {
        if (timer) clearTimeout(timer);
        for (const watcher of watchers) watcher.close();
    };
}
