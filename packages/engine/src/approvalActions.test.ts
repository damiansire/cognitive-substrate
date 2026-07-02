import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveApprovalAction } from './approvalActions';
import { markTaskAwaitingApproval, parseTasks } from './tasks';
import { ApprovalStore, loadPolicy } from '@cognitive-substrate/governance';

/**
 * The one place "resolve + persist always-rule + requeue" lives — CLI (`cmdApprove`),
 * TUI (`App.tsx`) and the web backend all call this instead of re-implementing it.
 */

let workspace: string;
beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-approval-actions-'));
});
afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
});

function seedPendingApproval(): string {
    const approval = new ApprovalStore(workspace).request({
        workspace: 'demo',
        task: '- [ ] borrar build',
        command: 'rm -rf build',
        reason: 'peligroso',
        risk: 'dangerous'
    });
    const tasksContent = markTaskAwaitingApproval(
        '# Plan de Tareas\n\n## [now]\n- [ ] borrar build\n\n## [blocked]\n\n## [improve]\n\n## [recurring]\n',
        '- [ ] borrar build',
        approval.id
    );
    fs.writeFileSync(path.join(workspace, 'tasks.md'), tasksContent, 'utf8');
    return approval.id;
}

describe('resolveApprovalAction', () => {
    it('returns null for an unknown approval id', () => {
        expect(resolveApprovalAction(workspace, 'does-not-exist', { action: 'approve', scope: 'once' })).toBeNull();
    });

    it('approve + once: marks approved and requeues the task into [now], without touching governance.json', () => {
        const id = seedPendingApproval();
        const resolved = resolveApprovalAction(workspace, id, { action: 'approve', scope: 'once' });

        expect(resolved?.status).toBe('approved');
        const tasks = parseTasks(fs.readFileSync(path.join(workspace, 'tasks.md'), 'utf8'));
        expect(tasks.now).toContain('- [ ] borrar build');
        expect(loadPolicy(workspace).allow).toEqual([]);
    });

    it('approve + always: also persists an allow rule in governance.json', () => {
        const id = seedPendingApproval();
        resolveApprovalAction(workspace, id, { action: 'approve', scope: 'always' });

        expect(loadPolicy(workspace).allow).toContain('rm -rf build');
    });

    it('deny + once: marks denied and does NOT requeue the task', () => {
        const id = seedPendingApproval();
        resolveApprovalAction(workspace, id, { action: 'deny', scope: 'once' });

        const tasks = parseTasks(fs.readFileSync(path.join(workspace, 'tasks.md'), 'utf8'));
        expect(tasks.now).toHaveLength(0);
    });

    it('deny + always: persists a deny rule', () => {
        const id = seedPendingApproval();
        resolveApprovalAction(workspace, id, { action: 'deny', scope: 'always' });

        expect(loadPolicy(workspace).deny).toContain('rm -rf build');
    });

    it('modify: records the modified command but does not requeue', () => {
        const id = seedPendingApproval();
        const resolved = resolveApprovalAction(workspace, id, {
            action: 'modify',
            scope: 'once',
            modifiedCommand: 'rm -rf build-modified'
        });

        expect(resolved?.status).toBe('modified');
        expect(resolved?.modifiedCommand).toBe('rm -rf build-modified');
        const tasks = parseTasks(fs.readFileSync(path.join(workspace, 'tasks.md'), 'utf8'));
        expect(tasks.now).toHaveLength(0);
    });

    it('is a no-op on tasks.md when the file does not exist', () => {
        const id = new ApprovalStore(workspace).request({
            workspace: 'demo',
            task: '- [ ] algo',
            command: 'rm -rf x',
            reason: 'peligroso',
            risk: 'dangerous'
        }).id;
        expect(() => resolveApprovalAction(workspace, id, { action: 'approve', scope: 'once' })).not.toThrow();
    });
});
