import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cmdApprove, cmdAsk } from './commands';
import { parseTasks } from '@cognitive-substrate/engine';
import { ApprovalStore, loadPolicy } from '@cognitive-substrate/governance';

/**
 * `cmdApprove` takes its `prompt` function as a dependency so the interactive flow is
 * testable without a real TTY — piping multi-line answers through stdin is flaky in
 * some shells (confirmed: a second `readline.question()` never resolves after a piped
 * multi-line input in Git Bash on Windows), so we script the answers directly instead.
 */
function scriptedPrompt(answers: string[]): (q: string) => Promise<string> {
    let i = 0;
    return async () => answers[i++] ?? '';
}

let root: string;
let savedKey: string | undefined;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-cli-cmd-'));
    savedKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY']; // deterministic heuristic mode for cmdAsk
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
});

describe('cmdApprove', () => {
    function seedBlockedTask(approvalId: string): void {
        fs.writeFileSync(
            path.join(root, 'tasks.md'),
            `# Plan de Tareas\n\n## [now]\n\n## [blocked]\n- [ ] borrar build (pending-approval:${approvalId})\n\n## [improve]\n\n## [recurring]\n`
        );
    }

    it('approving once requeues the task into [now] without touching governance.json', async () => {
        const approval = new ApprovalStore(root).request({
            workspace: 'demo',
            task: '- [ ] borrar build',
            command: 'rm -rf build',
            reason: 'peligroso',
            risk: 'dangerous'
        });
        seedBlockedTask(approval.id);

        await cmdApprove(root, approval.id, scriptedPrompt(['a', 'o']));

        expect(new ApprovalStore(root).listAll()[0].status).toBe('approved');
        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.now).toContain('- [ ] borrar build');
        expect(loadPolicy(root).allow).toEqual([]);
    });

    it('approving with "always" scope persists an allow rule in governance.json', async () => {
        const approval = new ApprovalStore(root).request({
            workspace: 'demo',
            task: '- [ ] borrar build',
            command: 'rm -rf build',
            reason: 'peligroso',
            risk: 'dangerous'
        });
        seedBlockedTask(approval.id);

        await cmdApprove(root, approval.id, scriptedPrompt(['a', 's']));

        expect(loadPolicy(root).allow).toContain('rm -rf build');
    });

    it('denying leaves the task out of [now] and marks the approval denied', async () => {
        const approval = new ApprovalStore(root).request({
            workspace: 'demo',
            task: '- [ ] borrar build',
            command: 'rm -rf build',
            reason: 'peligroso',
            risk: 'dangerous'
        });
        seedBlockedTask(approval.id);

        await cmdApprove(root, approval.id, scriptedPrompt(['d', 'o']));

        expect(new ApprovalStore(root).listAll()[0].status).toBe('denied');
        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.now).toHaveLength(0);
    });

    it('is a no-op (does not throw) for an unknown id', async () => {
        await expect(cmdApprove(root, 'does-not-exist', scriptedPrompt([]))).resolves.toBeUndefined();
    });
});

describe('cmdAsk', () => {
    it('routes a local aprobar/denegar/estado shortcut without touching tasks.md', async () => {
        const result = await cmdAsk(root, 'quiero aprobar algo');
        expect(result.action).toBe('control');
        expect(result.interpretation).toBeUndefined();
        expect(fs.existsSync(path.join(root, 'tasks.md'))).toBe(false);
    });

    it('a "detener"-classified request (via handleAsk) is control action without touching tasks.md', async () => {
        const result = await cmdAsk(root, 'detené el daemon');
        expect(result.action).toBe('control');
        expect(result.interpretation?.verb).toBe('detener');
        expect(fs.existsSync(path.join(root, 'tasks.md'))).toBe(false);
    });

    it('falls back to task intake for free text, creating tasks.md if missing', async () => {
        const result = await cmdAsk(root, 'Arreglar el bug del login');
        expect(result.action).toBe('intake');
        expect(result.interpretation?.verb).toBe('hacer');
        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.now[0]).toContain('Arreglar el bug del login');
    });

    it('appends to an existing tasks.md instead of overwriting it', async () => {
        fs.writeFileSync(path.join(root, 'tasks.md'), '# Plan\n\n## [now]\n- [ ] Tarea previa\n');
        await cmdAsk(root, 'Tarea nueva');
        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.now).toHaveLength(2);
    });

    it('an "automatizar"-classified request queues a [recurring] task, not [now]', async () => {
        const result = await cmdAsk(root, 'automatizá el backup semanal');
        expect(result.interpretation?.verb).toBe('automatizar');
        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.now).toHaveLength(0);
        expect(tasks.recurring.some((l) => l.includes('automatizá el backup semanal'))).toBe(true);
    });
});
