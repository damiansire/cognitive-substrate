import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { terminalTools } from './index';

let workspace: string;

beforeEach(() => {
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csos-term-')));
});

afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
});

describe('terminalTools.runCommand', () => {
    it('executes a command and returns its stdout', async () => {
        const out = await terminalTools.runCommand(workspace, {
            command: `node -e "console.log('pong')"`
        });
        expect(out.trim()).toBe('pong');
    });

    it('runs with the workspace as cwd', async () => {
        const out = await terminalTools.runCommand(workspace, {
            command: `node -e "console.log(process.cwd())"`
        });
        expect(fs.realpathSync(out.trim())).toBe(workspace);
    });

    it('blocks obvious destructive commands as an accident guard', async () => {
        const out = await terminalTools.runCommand(workspace, { command: 'rm -rf /' });
        expect(out).toContain('Error de Seguridad');
    });

    it('surfaces a non-zero exit code without throwing', async () => {
        const out = await terminalTools.runCommand(workspace, {
            command: `node -e "process.exit(3)"`
        });
        expect(out).toContain('Command failed');
    });

    it('honors a custom timeoutMs for longer-running commands', async () => {
        const out = await terminalTools.runCommand(
            workspace,
            { command: `node -e "setTimeout(() => console.log('done'), 50)"` },
            1000
        );
        expect(out.trim()).toBe('done');
    });
});
