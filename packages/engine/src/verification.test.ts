import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    referencedFiles,
    deterministicChecks,
    verifyTask,
    extractVerifyCommand,
    resolveVerifyCommand
} from './verification';

let workspace: string;
let savedKey: string | undefined;
beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-ver-'));
    savedKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY']; // force simulation
});
afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
});

describe('referencedFiles', () => {
    it('extracts file-like tokens from a task', () => {
        const files = referencedFiles('Crear app.js y public/index.html');
        expect(files).toContain('app.js');
        expect(files).toContain('public/index.html');
    });
});

describe('deterministicChecks', () => {
    it('fails when a referenced file is missing', () => {
        const checks = deterministicChecks(workspace, 'Crear app.js', 'log', true);
        const fileCheck = checks.find((c) => c.name === 'archivo-existe:app.js');
        expect(fileCheck?.passed).toBe(false);
    });

    it('passes when the referenced file exists', () => {
        fs.writeFileSync(path.join(workspace, 'app.js'), '// hi');
        const checks = deterministicChecks(workspace, 'Crear app.js', 'log', true);
        const fileCheck = checks.find((c) => c.name === 'archivo-existe:app.js');
        expect(fileCheck?.passed).toBe(true);
    });
});

describe('verifyTask (simulation mode)', () => {
    it('verifies when execution succeeded and no missing evidence', async () => {
        const verdict = await verifyTask(workspace, 'Tarea simple', 'hice la tarea', true);
        expect(verdict.verified).toBe(true);
    });

    it('does not verify when execution failed', async () => {
        const verdict = await verifyTask(workspace, 'Tarea simple', '', false);
        expect(verdict.verified).toBe(false);
    });

    it('does not verify when a referenced file is missing', async () => {
        const verdict = await verifyTask(workspace, 'Crear faltante.txt', 'dije que lo hice', true);
        expect(verdict.verified).toBe(false);
    });
});

describe('extractVerifyCommand', () => {
    it('extracts an inline @verify: annotation', () => {
        expect(extractVerifyCommand('Crear server.js @verify: npm test')).toBe('npm test');
    });

    it('returns null when there is no annotation', () => {
        expect(extractVerifyCommand('Crear server.js')).toBeNull();
    });
});

describe('resolveVerifyCommand', () => {
    it('prefers the inline annotation over package.json', () => {
        fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
        const cmd = resolveVerifyCommand(workspace, 'Tarea @verify: node check.js');
        expect(cmd).toBe('node check.js');
    });

    it('falls back to "npm test" when package.json declares a test script', () => {
        fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
        const cmd = resolveVerifyCommand(workspace, 'Tarea sin anotación');
        expect(cmd).toBe('npm test');
    });

    it('returns null with neither annotation nor a package.json test script', () => {
        expect(resolveVerifyCommand(workspace, 'Tarea sin anotación')).toBeNull();
    });
});

describe('verifyTask — behavioral check (regression-safe)', () => {
    it('verifies when the @verify: command exits 0', async () => {
        const verdict = await verifyTask(workspace, `Tarea @verify: node -e "process.exit(0)"`, 'hice la tarea', true);
        expect(verdict.verified).toBe(true);
        expect(verdict.checks.find((c) => c.name === 'verificacion-real')?.passed).toBe(true);
    });

    it('does NOT verify when the @verify: command exits non-zero, even with evidence otherwise present', async () => {
        const verdict = await verifyTask(workspace, `Tarea @verify: node -e "process.exit(1)"`, 'hice la tarea', true);
        expect(verdict.verified).toBe(false);
        expect(verdict.checks.find((c) => c.name === 'verificacion-real')?.passed).toBe(false);
    });

    it('is unaffected when there is no @verify: annotation and no package.json test script', async () => {
        const verdict = await verifyTask(workspace, 'Tarea simple', 'hice la tarea', true);
        expect(verdict.checks.find((c) => c.name === 'verificacion-real')).toBeUndefined();
        expect(verdict.verified).toBe(true);
    });
});
