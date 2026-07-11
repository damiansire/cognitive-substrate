import { spawn, execFile } from 'child_process';

/** Hard wall-time limit so a runaway command can never hang the daemon. */
export const COMMAND_TIMEOUT_MS = 15_000;

/** Cap on captured output to avoid unbounded memory from chatty commands. */
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MiB

/**
 * Best-effort guard against the most obvious accidental footguns. This is a
 * convenience filter, NOT a security boundary: a substring blocklist is trivially
 * bypassable and must not be relied on for isolation. Real isolation (containers /
 * approval gates) is tracked in the governance milestone. We keep it only to catch
 * accidental destructive commands early.
 */
const ACCIDENT_PATTERNS = ['rm -rf /', 'rm -rf /*', 'del /s', 'format ', 'mkfs'];

interface ProcEntry {
    pid: number;
    ppid: number;
}

/** One snapshot of every PID/PPID pair currently running, for tree resolution below. */
function listWindowsProcesses(): Promise<ProcEntry[]> {
    return new Promise((resolve) => {
        execFile(
            'powershell',
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'
            ],
            { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
            (err, stdout) => {
                if (err || !stdout) {
                    resolve([]);
                    return;
                }
                try {
                    const parsed: unknown = JSON.parse(stdout);
                    const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
                    resolve(
                        rows
                            .map((r) => {
                                const row = r as { ProcessId?: unknown; ParentProcessId?: unknown };
                                return { pid: Number(row.ProcessId), ppid: Number(row.ParentProcessId) };
                            })
                            .filter((r) => Number.isFinite(r.pid) && Number.isFinite(r.ppid))
                    );
                } catch {
                    resolve([]);
                }
            }
        );
    });
}

/** BFS over a PID/PPID snapshot to find every live descendant of `rootPid`. */
function collectDescendants(rootPid: number, processes: ProcEntry[]): number[] {
    const byParent = new Map<number, number[]>();
    for (const p of processes) {
        const siblings = byParent.get(p.ppid) ?? [];
        siblings.push(p.pid);
        byParent.set(p.ppid, siblings);
    }
    const result: number[] = [];
    const queue = [rootPid];
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const child of byParent.get(current) ?? []) {
            result.push(child);
            queue.push(child);
        }
    }
    return result;
}

function killPidWindows(pid: number): Promise<void> {
    return new Promise((resolve) => {
        execFile('taskkill', ['/pid', String(pid), '/F'], () => resolve());
    });
}

/**
 * Kills an entire process TREE, not just the single PID Node handed us.
 *
 * `child_process.exec`'s own `timeout` option only signals the immediate process it
 * spawned (the shell). When the command itself spawns a further child (e.g. a shell
 * running `node -e "..."`), that grandchild is left orphaned and keeps running — on
 * Windows in particular there is no process-group/job-object cleanup by default, so a
 * runaway loop keeps burning CPU forever even after `runCommand` has already returned
 * a "timed out" message to the caller. That defeats the entire point of the timeout as
 * a resource limit.
 *
 * On Windows, `taskkill /pid <root> /T /F` alone was observed (under concurrent load in
 * this repo's own test suite) to sometimes miss deep descendants: it resolves the tree
 * internally at kill time, and once the immediate shell exits the parent-child link to
 * its own children can already be gone from the OS's bookkeeping by the time taskkill
 * gets to them, leaving the deepest process (e.g. the actual runaway `node`) orphaned
 * and still burning CPU. We avoid that race by resolving the FULL descendant list
 * ourselves from a single process snapshot taken before killing anything, then killing
 * every PID in that snapshot individually.
 *
 * POSIX does not need this: the child is spawned detached in its own process group, and
 * killing the *negative* pid reliably kills that whole group in one syscall.
 */
async function killProcessTree(pid: number): Promise<void> {
    if (process.platform === 'win32') {
        const processes = await listWindowsProcesses();
        const targets = [...collectDescendants(pid, processes), pid];
        await Promise.all(targets.map((p) => killPidWindows(p)));
        return;
    }
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        // Fall back to killing just the direct child if it was never in its own group.
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            /* already gone */
        }
    }
}

export const terminalTools = {
    /**
     * Executes a shell command within the workspace.
     *
     * Runs asynchronously (does NOT block the event loop, so multiple workspaces can
     * make progress concurrently) and enforces a hard wall-time timeout that kills the
     * process tree if exceeded.
     *
     * NOTE: `cwd` confines where the command starts, but a native shell can still reach
     * outside the workspace. Treat this as state isolation, not as a security sandbox.
     *
     * @param workspacePath - The absolute path to the designated workspace.
     * @param args - The arguments containing the command to execute.
     * @param timeoutMs - Wall-time limit override (defaults to `COMMAND_TIMEOUT_MS`).
     *   Callers that know a command legitimately takes longer than an agent tool-call
     *   (e.g. `npm test`) can opt into a longer bound without changing the default.
     * @returns A promise resolving to the command output, or an error message.
     */
    runCommand(
        workspacePath: string,
        args: { command: string },
        timeoutMs: number = COMMAND_TIMEOUT_MS
    ): Promise<string> {
        const command = args?.command ?? '';
        console.log(`>>> [Sandbox] Ejecutando en ${workspacePath}: ${command}`);

        const lowered = command.toLowerCase();
        const hit = ACCIDENT_PATTERNS.find((p) => lowered.includes(p));
        if (hit) {
            return Promise.resolve(
                `Error de Seguridad: comando bloqueado por contener un patrón destructivo conocido ("${hit}"). ` +
                    `Si era intencional, ejecutalo manualmente con aprobación humana.`
            );
        }

        return new Promise<string>((resolve) => {
            // NOTE: we deliberately use `spawn` (not `exec`) so we can pass `detached` —
            // `exec`'s TypeScript types don't expose it, and more importantly its built-in
            // `timeout` option only kills the single process it spawned (the shell), which
            // orphans any process that shell started. Running detached (its own process
            // group on POSIX) and enforcing the deadline ourselves via `killProcessTree`
            // reclaims the WHOLE tree, not just the shell.
            let timedOut = false;
            let settled = false;
            let stdout = '';
            let stderr = '';
            let outputBytes = 0;
            let maxBufferExceeded = false;

            const child = spawn(command, {
                cwd: workspacePath,
                shell: true,
                windowsHide: true,
                detached: process.platform !== 'win32'
            });

            const finish = (value: string) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            };

            const onChunk = (isStderr: boolean) => (chunk: Buffer) => {
                outputBytes += chunk.length;
                if (outputBytes > MAX_OUTPUT_BYTES) {
                    if (!maxBufferExceeded && child.pid) {
                        maxBufferExceeded = true;
                        void killProcessTree(child.pid);
                    }
                    return;
                }
                if (isStderr) stderr += chunk.toString('utf8');
                else stdout += chunk.toString('utf8');
            };
            child.stdout?.on('data', onChunk(false));
            child.stderr?.on('data', onChunk(true));

            child.on('error', (err) => {
                finish(`Command failed to start: ${err.message}`);
            });

            child.on('close', (code, signal) => {
                if (timedOut) {
                    finish(
                        `Error Crítico: El comando excedió el tiempo máximo de ${
                            timeoutMs / 1000
                        } segundos y fue abortado (junto con todo su árbol de procesos) para evitar cuelgues.`
                    );
                    return;
                }
                if (maxBufferExceeded) {
                    finish(
                        `Error Crítico: la salida del comando superó el límite de ${MAX_OUTPUT_BYTES} bytes y fue abortado.`
                    );
                    return;
                }
                if (code !== 0) {
                    finish(
                        `Command failed. Exit code: ${code ?? 'desconocido'}${
                            signal ? ` (signal ${signal})` : ''
                        }. Stderr: ${stderr || '(sin stderr)'}`
                    );
                    return;
                }
                finish(stdout || 'Command executed successfully with no output.');
            });

            const timer = setTimeout(() => {
                timedOut = true;
                if (child.pid) {
                    // Wait for the tree-kill to actually finish (not fire-and-forget):
                    // callers — including eval cleanup that removes the temp workspace right
                    // after this promise settles — must be able to rely on the runaway
                    // process truly being gone, not just "signaled".
                    void killProcessTree(child.pid).then(() => {
                        finish(
                            `Error Crítico: El comando excedió el tiempo máximo de ${
                                timeoutMs / 1000
                            } segundos y fue abortado (junto con todo su árbol de procesos) para evitar cuelgues.`
                        );
                    });
                } else {
                    finish(
                        `Error Crítico: El comando excedió el tiempo máximo de ${
                            timeoutMs / 1000
                        } segundos y fue abortado para evitar cuelgues.`
                    );
                }
            }, timeoutMs);
        });
    }
};
