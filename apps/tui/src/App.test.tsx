import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { parseTasks } from '@cognitive-substrate/engine';
import { ApprovalStore, loadPolicy } from '@cognitive-substrate/governance';

/**
 * `ink-testing-library` renders against a fake stdin/stdout, so it exercises the real
 * component tree (including `useInput`) without needing a real TTY — a real terminal
 * would show the exact same frames `lastFrame()` returns here. This is the closest
 * thing to a terminal screenshot that's honestly automatable.
 *
 * React's state updates from `useInput` handlers flush asynchronously (microtask), so
 * `lastFrame()` right after a synchronous `stdin.write()` can still show the pre-update
 * frame — `tick()` yields once so the re-render lands before we assert.
 */
function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
}

let root: string;
let savedKey: string | undefined;
beforeEach(() => {
    savedKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY']; // deterministic heuristic mode for the ask view
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-tui-app-'));
    fs.writeFileSync(
        path.join(root, 'tasks.md'),
        '# Plan de Tareas\n\n## [now]\n- [ ] Escribir un saludo\n\n## [next]\n\n' +
            '## [blocked]\n- [ ] borrar build (pending-approval:appr-1)\n\n## [improve]\n\n## [recurring]\n'
    );
    fs.writeFileSync(
        path.join(root, 'approvals.json'),
        JSON.stringify(
            [
                {
                    id: 'appr-1',
                    workspace: 'demo',
                    task: '- [ ] borrar build',
                    command: 'rm -rf build',
                    reason: 'comando peligroso (rm -rf)',
                    risk: 'dangerous',
                    requestedAt: '2026-06-30T20:00:00.000Z',
                    status: 'pending'
                }
            ],
            null,
            2
        )
    );
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
});

describe('App (TUI)', () => {
    it('renders the Home view by default with a real project summary', async () => {
        const { lastFrame, unmount } = render(<App rootDir={root} />);
        await tick();
        const frame = lastFrame();
        expect(frame).toContain('Cognitive Substrate OS');
        expect(frame).toContain('now=1');
        expect(frame).toContain('aprobaciones=1');
        unmount();
    });

    it('switches to the Inbox view and shows the pending approval', async () => {
        const { lastFrame, stdin, unmount } = render(<App rootDir={root} />);
        await tick();
        stdin.write('2');
        await tick();
        const frame = lastFrame();
        expect(frame).toContain('rm -rf build');
        expect(frame).toContain('appr-1');
        unmount();
    });

    it('approving from the Inbox view resolves the approval and requeues the task for real', async () => {
        const { stdin, unmount } = render(<App rootDir={root} />);
        await tick();
        stdin.write('2'); // -> inbox
        await tick();
        stdin.write('a'); // approve, scope 'once' (only pending item is pre-selected)
        await tick();

        const [approval] = new ApprovalStore(root).listAll();
        expect(approval?.status).toBe('approved');

        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.now).toContain('- [ ] borrar build');
        unmount();
    });

    it('approving with scope "always" persists an allow rule in governance.json', async () => {
        const { stdin, unmount } = render(<App rootDir={root} />);
        await tick();
        stdin.write('2');
        await tick();
        stdin.write('A'); // approve, scope 'always'
        await tick();

        expect(loadPolicy(root).allow).toContain('rm -rf build');
        unmount();
    });

    it('the ask view classifies text via handleAsk and queues a real task', async () => {
        const { lastFrame, stdin, unmount } = render(<App rootDir={root} />);
        await tick();
        stdin.write('5'); // -> ask view
        await tick();
        stdin.write('Reintentar el deploy');
        await tick();
        stdin.write('\r'); // submit
        await tick();
        await tick(); // handleAsk resolves asynchronously (one extra microtask hop)

        const frame = lastFrame();
        expect(frame).toContain('reintentar');
        expect(frame).toContain('ejecucion_unica');

        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.now.some((l) => l.includes('Reintentar el deploy'))).toBe(true);
        unmount();
    });

    it('Escape clears the ask buffer before it navigates away, and "5" is captured as text while composing', async () => {
        const { lastFrame, stdin, unmount } = render(<App rootDir={root} />);
        await tick();
        stdin.write('5'); // -> ask view
        await tick();
        stdin.write('a5b'); // the digit must be captured as text, not a view-switch shortcut
        await tick();
        expect(lastFrame()).toContain('a5b');

        stdin.write(''); // Escape: buffer is non-empty, so it clears instead of navigating away
        await tick();
        expect(lastFrame()).not.toContain('a5b');
        unmount();
    });

    it('navigates home -> board -> session via Enter (altitude drill-down)', async () => {
        const { lastFrame, stdin, unmount } = render(<App rootDir={root} />);
        await tick();
        stdin.write('\r'); // Enter on Home -> Board
        await tick();
        expect(lastFrame()).toContain('now');
        stdin.write('\r'); // Enter on Board -> Session
        await tick();
        expect(lastFrame()).toMatch(/sesión registrada|Run:/i);
        unmount();
    });
});
