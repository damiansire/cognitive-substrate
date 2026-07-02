import { exec } from 'child_process';

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
            exec(
                command,
                {
                    encoding: 'utf8',
                    cwd: workspacePath,
                    timeout: timeoutMs,
                    killSignal: 'SIGKILL',
                    windowsHide: true,
                    maxBuffer: MAX_OUTPUT_BYTES
                },
                (error, stdout, stderr) => {
                    if (error) {
                        if ((error as any).killed && (error as any).signal === 'SIGKILL') {
                            resolve(
                                `Error Crítico: El comando excedió el tiempo máximo de ${
                                    timeoutMs / 1000
                                } segundos y fue abortado por el OS para evitar cuelgues.`
                            );
                            return;
                        }
                        const code = (error as any).code ?? 'desconocido';
                        resolve(`Command failed. Exit code: ${code}. Stderr: ${stderr || error.message}`);
                        return;
                    }
                    resolve(stdout || 'Command executed successfully with no output.');
                }
            );
        });
    }
};
