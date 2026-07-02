import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { watchWorkspace } from './events';

let workspace: string;
beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-events-'));
});
afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
});

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('watchWorkspace', () => {
    it('notifies when a top-level workspace file changes', async () => {
        fs.writeFileSync(path.join(workspace, 'tasks.md'), '# Plan\n');
        let notified = 0;
        const stop = watchWorkspace(workspace, () => notified++, 20);

        fs.writeFileSync(path.join(workspace, 'tasks.md'), '# Plan\n\n## [now]\n- [ ] X\n');
        await wait(300);

        expect(notified).toBeGreaterThan(0);
        stop();
    });

    it('debounces multiple rapid writes into a single notification', async () => {
        let notified = 0;
        const stop = watchWorkspace(workspace, () => notified++, 100);

        fs.writeFileSync(path.join(workspace, 'a.json'), '1');
        fs.writeFileSync(path.join(workspace, 'a.json'), '2');
        fs.writeFileSync(path.join(workspace, 'a.json'), '3');
        await wait(400);

        expect(notified).toBe(1);
        stop();
    });

    it('notifies when a new run directory appears under runs/', async () => {
        fs.mkdirSync(path.join(workspace, 'runs'));
        let notified = 0;
        const stop = watchWorkspace(workspace, () => notified++, 20);

        fs.mkdirSync(path.join(workspace, 'runs', '2026-01-01T00-00-00-000Z-hacer-algo'));
        await wait(300);

        expect(notified).toBeGreaterThan(0);
        stop();
    });

    it('stops notifying once the returned cleanup function is called', async () => {
        fs.writeFileSync(path.join(workspace, 'tasks.md'), '# Plan\n');
        let notified = 0;
        const stop = watchWorkspace(workspace, () => notified++, 20);
        stop();

        fs.writeFileSync(path.join(workspace, 'tasks.md'), '# Plan\n\n## [now]\n');
        await wait(300);

        expect(notified).toBe(0);
    });

    it('does not throw when runs/ does not exist yet', () => {
        expect(() => watchWorkspace(workspace, () => {}, 20)()).not.toThrow();
    });
});
