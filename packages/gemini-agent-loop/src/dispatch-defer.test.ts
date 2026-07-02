import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dispatchTool } from './index';
import { BrowserSession } from '@cognitive-substrate/sandbox-browser';
import { defaultPolicy, ApprovalStore } from '@cognitive-substrate/governance';

/**
 * `dispatchTool` is what actually applies governance to a `runCommand` call. It never
 * touches the LLM, so the defer/approval wiring is fully testable here without a
 * GEMINI_API_KEY — unlike `executeTaskWithLLM`, which degrades to a no-op simulation
 * offline and can't exercise this path at all.
 */
describe('dispatchTool — runCommand defer wiring', () => {
    let workspace: string;
    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-dispatch-'));
    });
    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    const deferPolicy = { ...defaultPolicy, mode: 'defer' as const };

    it('defers a dangerous command and pauses the task instead of denying it', async () => {
        const result = await dispatchTool(
            workspace,
            'runCommand',
            { command: 'rm -rf build' },
            deferPolicy,
            new BrowserSession(),
            '- [ ] limpiar build'
        );

        expect(result.awaitingApproval).toBeTruthy();
        expect(result.awaitingApproval!.command).toBe('rm -rf build');

        const pending = new ApprovalStore(workspace).listPending();
        expect(pending).toHaveLength(1);
        expect(pending[0].task).toBe('- [ ] limpiar build');
    });

    it('allows the command once a human has approved the matching PendingApproval', async () => {
        const first = await dispatchTool(
            workspace,
            'runCommand',
            { command: 'rm -rf build' },
            deferPolicy,
            new BrowserSession(),
            '- [ ] limpiar build'
        );
        const approvals = new ApprovalStore(workspace);
        approvals.resolve(first.awaitingApproval!.approvalId, { action: 'approve', scope: 'once' });

        const retry = await dispatchTool(
            workspace,
            'runCommand',
            { command: 'rm -rf build' },
            deferPolicy,
            new BrowserSession(),
            '- [ ] limpiar build'
        );
        expect(retry.awaitingApproval).toBeUndefined();
        expect(retry.text).not.toContain('Bloqueado por governance');
    });

    it('still denies dangerous commands outright in default (deny) mode', async () => {
        const result = await dispatchTool(
            workspace,
            'runCommand',
            { command: 'rm -rf /' },
            defaultPolicy,
            new BrowserSession(),
            '- [ ] tarea'
        );
        expect(result.awaitingApproval).toBeUndefined();
        expect(result.text).toContain('Bloqueado por governance');
    });

    it('runs safe commands normally, unaffected by defer mode', async () => {
        const result = await dispatchTool(
            workspace,
            'runCommand',
            { command: 'node -e "console.log(1)"' },
            deferPolicy,
            new BrowserSession(),
            '- [ ] tarea'
        );
        expect(result.awaitingApproval).toBeUndefined();
        expect(result.text).not.toContain('Bloqueado por governance');
    });
});
