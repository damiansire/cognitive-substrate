import { exec, execFile } from 'child_process';

/**
 * Container execution adapter: runs a command inside a throwaway Docker container whose
 * only mounted, writable surface is the workspace, with networking disabled by default.
 *
 * This is the "strong sandbox" the native terminal cannot provide: a real isolation
 * boundary (separate filesystem + PID + network namespaces). It is OPTIONAL — if Docker
 * is unavailable we FAIL SAFE (refuse to run) rather than silently falling back to an
 * unsandboxed shell.
 */

export const DEFAULT_IMAGE = 'node:20-alpine';
export const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface ContainerOptions {
    image?: string;
    timeoutMs?: number;
    /** 'none' (default, no egress) or 'bridge' (network allowed — use with care). */
    network?: 'none' | 'bridge';
}

/**
 * Builds the `docker run` argument vector. Pure and deterministic so it can be unit
 * tested without Docker present. The workspace is bind-mounted at /workspace and used
 * as the working directory; the container is removed on exit (`--rm`).
 */
export function buildDockerArgs(workspacePath: string, command: string, opts: ContainerOptions = {}): string[] {
    const image = opts.image ?? DEFAULT_IMAGE;
    const network = opts.network ?? 'none';
    return [
        'run',
        '--rm',
        '--network',
        network,
        '--workdir',
        '/workspace',
        '--volume',
        `${workspacePath}:/workspace`,
        image,
        'sh',
        '-c',
        command
    ];
}

/** Resolves true if a working Docker CLI + daemon is reachable. */
export function isDockerAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        const child = exec('docker version', { timeout: 5000 }, (error) => resolve(!error));
        child.on('error', () => resolve(false));
    });
}

export const containerTools = {
    /**
     * Runs a command inside an isolated container scoped to `workspacePath`.
     * Fails safe: if Docker is not available, it refuses to execute (it does NOT fall
     * back to the host shell), returning an explanatory message instead.
     */
    async runCommand(
        workspacePath: string,
        args: { command: string },
        opts: ContainerOptions = {},
        checkDocker: () => Promise<boolean> = isDockerAvailable
    ): Promise<string> {
        const command = args?.command ?? '';
        if (!(await checkDocker())) {
            return (
                'Error: ejecución en contenedor solicitada pero Docker no está disponible. ' +
                'Fail-safe: no se ejecuta en el shell del host. Instalá/iniciá Docker o cambiá ' +
                "terminal a 'native' en governance.json (aceptando que native NO es un sandbox fuerte)."
            );
        }

        const dockerArgs = buildDockerArgs(workspacePath, command, opts);
        const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        console.log(`>>> [Container] docker ${dockerArgs.slice(0, 8).join(' ')} ... (cmd en /workspace)`);

        return new Promise<string>((resolve) => {
            execFile(
                'docker',
                dockerArgs,
                { encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
                (error, stdout, stderr) => {
                    if (error) {
                        if ((error as any).killed) {
                            resolve(
                                `Error Crítico: el comando excedió ${timeout / 1000}s en el contenedor y fue abortado.`
                            );
                            return;
                        }
                        resolve(`Container command failed. ${stderr || error.message}`);
                        return;
                    }
                    resolve(stdout || 'Command executed successfully with no output.');
                }
            );
        });
    }
};
