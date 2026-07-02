import * as fs from 'fs';
import * as path from 'path';
import { requeueApprovedTask } from './tasks';
import {
    ApprovalStore,
    savePolicyAlwaysRule,
    type PendingApproval,
    type ResolveInput
} from '@cognitive-substrate/governance';

const TASKS_FILE = 'tasks.md';

/**
 * Resolves a pending approval and applies every side effect that implies: persisting an
 * `always` allow/deny rule to `governance.json`, and — on `approve` — requeuing the task
 * back into `[now]`. This is the ONE place that sequence lives; the CLI (`approve`
 * command), the TUI (Inbox view), and the web backend all call this instead of each
 * re-implementing the same three steps.
 *
 * Returns the resolved `PendingApproval`, or null if `approvalId` doesn't exist.
 */
export function resolveApprovalAction(
    workspacePath: string,
    approvalId: string,
    resolution: ResolveInput
): PendingApproval | null {
    const store = new ApprovalStore(workspacePath);
    const resolved = store.resolve(approvalId, resolution);
    if (!resolved) return null;

    if (resolution.scope === 'always') {
        savePolicyAlwaysRule(workspacePath, resolution.action === 'approve' ? 'allow' : 'deny', resolved.command);
    }

    if (resolution.action === 'approve') {
        const tasksPath = path.resolve(workspacePath, TASKS_FILE);
        if (fs.existsSync(tasksPath)) {
            const requeued = requeueApprovedTask(fs.readFileSync(tasksPath, 'utf8'), approvalId);
            fs.writeFileSync(tasksPath, requeued, 'utf8');
        }
    }

    return resolved;
}
