import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves a workspace-relative path and guarantees it stays inside the workspace.
 *
 * This is the core security invariant of the sandbox: the agent must never be able
 * to read or write outside its designated workspace. We deliberately do NOT use a
 * naive `target.startsWith(workspacePath)` check, because that is vulnerable
 * (`/workspace-evil` starts with `/workspace`) and breaks on Windows due to drive
 * casing and separators.
 *
 * Instead we compute the relative path from the workspace to the resolved target.
 * If that relative path escapes upward (`..`) or resolves to an absolute path
 * (different drive on Windows), the access is denied. We also resolve symlinks on
 * the existing portion of the path to prevent symlink-based escapes.
 *
 * @param workspacePath - The absolute path to the designated workspace.
 * @param requestedPath - The (untrusted) path supplied by the agent, relative to the workspace.
 * @returns The validated absolute target path.
 * @throws {SandboxEscapeError} If the resolved target would fall outside the workspace.
 */
export function resolveInsideWorkspace(workspacePath: string, requestedPath: string): string {
    const workspaceRoot = realpathIfExists(path.resolve(workspacePath));
    const target = path.resolve(workspaceRoot, requestedPath ?? '.');

    // Resolve symlinks on the deepest existing ancestor so a symlink inside the
    // workspace can't point outside it and slip past the textual check below.
    const realTarget = realpathIfExists(target);

    const relative = path.relative(workspaceRoot, realTarget);
    const escapes = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

    if (escapes) {
        throw new SandboxEscapeError(workspaceRoot, requestedPath);
    }
    return realTarget;
}

/** Error thrown when an agent attempts to access a path outside its workspace. */
export class SandboxEscapeError extends Error {
    constructor(workspaceRoot: string, requestedPath: string) {
        super(`Error de Seguridad: Acceso denegado. La ruta "${requestedPath}" sale del workspace (${workspaceRoot}).`);
        this.name = 'SandboxEscapeError';
    }
}

/**
 * Returns the canonical (symlink-resolved) path if it exists, otherwise resolves
 * symlinks on the closest existing ancestor and re-appends the missing tail.
 * This lets us validate paths for files that don't exist yet (e.g. on writeFile).
 */
function realpathIfExists(targetPath: string): string {
    let current = targetPath;
    const tail: string[] = [];
    // Walk up until we find an existing ancestor.
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) {
            // Reached the filesystem root without finding anything that exists.
            return targetPath;
        }
        tail.unshift(path.basename(current));
        current = parent;
    }
    const realBase = fs.realpathSync(current);
    return tail.length > 0 ? path.join(realBase, ...tail) : realBase;
}

export const fsTools = {
    /**
     * Reads the content of a file within the allowed workspace.
     * @param workspacePath - The absolute path to the designated workspace.
     * @param args - The arguments containing the file path to read.
     * @returns The file content as a string, or an error message.
     */
    readFile(workspacePath: string, args: { filepath: string }): string {
        try {
            const target = resolveInsideWorkspace(workspacePath, args.filepath);
            return fs.readFileSync(target, 'utf8');
        } catch (e: any) {
            if (e instanceof SandboxEscapeError) return e.message;
            return `Error reading file: ${e.message}`;
        }
    },

    /**
     * Writes content to a file within the allowed workspace.
     * Creates directories recursively if they don't exist.
     * @param workspacePath - The absolute path to the designated workspace.
     * @param args - The arguments containing the file path and content.
     * @returns A success or error message string.
     */
    writeFile(workspacePath: string, args: { filepath: string; content: string }): string {
        try {
            const target = resolveInsideWorkspace(workspacePath, args.filepath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, args.content, 'utf8');
            return `Success: File ${args.filepath} written.`;
        } catch (e: any) {
            if (e instanceof SandboxEscapeError) return e.message;
            return `Error writing file: ${e.message}`;
        }
    },

    /**
     * Lists files and directories within a specific path of the workspace.
     * @param workspacePath - The absolute path to the designated workspace.
     * @param args - The arguments containing the directory path relative to the workspace.
     * @returns A newline-separated list of files, or an error message.
     */
    listFiles(workspacePath: string, args: { dirpath: string }): string {
        try {
            const target = resolveInsideWorkspace(workspacePath, args.dirpath || '.');
            return fs.readdirSync(target).join('\n');
        } catch (e: any) {
            if (e instanceof SandboxEscapeError) return e.message;
            return `Error listing directory: ${e.message}`;
        }
    }
};
