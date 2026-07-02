import * as fs from 'fs';
import * as path from 'path';
import { executeTaskWithLLM } from '@cognitive-substrate/gemini-agent-loop';
import { decomposeGoal } from './decomposition';
import { verifyTask } from './verification';
import { distillLearning, appendLearning } from './memory';
import { proposeImprovement } from './improve';
import { recordIncident, countIncidents } from './incidents';
import { advanceTick, nextDueRecurring, markRecurringRan } from './recurring';
import { getWorkerId } from './claims';
import { createClaimBackend } from './coordination';
import { loadPolicy } from '@cognitive-substrate/governance';
import { recordRun } from './evidence';
import {
    parseTasks,
    markTaskDone,
    markTaskFailed,
    markTaskAwaitingApproval,
    addImproveTask,
    appendTasksToNow,
    extractTaskId
} from './tasks';
import type { WorkspaceResult } from './types';

const GOAL_FILE = 'goal.md';
const TASKS_FILE = 'tasks.md';
const DECOMPOSED_MARKER = '<!-- decomposed -->';

/** Clock seam so tests can inject deterministic timestamps. */
export type Clock = () => Date;
const systemClock: Clock = () => new Date();

/**
 * Goal intake: if the workspace has a `goal.md` that hasn't been decomposed yet,
 * break it into subtasks and seed them into the `[now]` queue. Idempotent — a
 * marker is appended to `goal.md` so a goal is only decomposed once.
 */
export async function intakeGoal(workspacePath: string): Promise<number> {
    const goalPath = path.resolve(workspacePath, GOAL_FILE);
    if (!fs.existsSync(goalPath)) return 0;

    const goalContent = fs.readFileSync(goalPath, 'utf8');
    if (goalContent.includes(DECOMPOSED_MARKER)) return 0;

    const goalText = goalContent.replace(DECOMPOSED_MARKER, '').trim();
    const subtasks = await decomposeGoal(goalText);
    if (subtasks.length === 0) return 0;

    const tasksPath = path.resolve(workspacePath, TASKS_FILE);
    const existing = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf8') : '# Plan de Tareas\n\n## [now]\n';
    fs.writeFileSync(tasksPath, appendTasksToNow(existing, subtasks), 'utf8');
    fs.appendFileSync(goalPath, `\n\n${DECOMPOSED_MARKER}\n`, 'utf8');
    console.log(`>>> [Goal] "${path.basename(workspacePath)}": descompuesto en ${subtasks.length} subtarea(s).`);
    return subtasks.length;
}

/**
 * Runs ONE tick for a single workspace: intake goal → pick the next [now] task →
 * execute → verify → record evidence → learn → update queues. Never throws; failures
 * are captured into the result and the failure loop.
 */
export async function processWorkspace(
    workspacePath: string,
    project: string,
    clock: Clock = systemClock
): Promise<WorkspaceResult> {
    try {
        await intakeGoal(workspacePath);
    } catch (e: any) {
        console.warn(`>>> [Goal] Error en intake de ${project}: ${e.message}`);
    }

    const tasksPath = path.resolve(workspacePath, TASKS_FILE);
    if (!fs.existsSync(tasksPath)) {
        return { project, pendingNow: 0, run: null, incidents: countIncidents(workspacePath), summary: '' };
    }

    const queues = parseTasks(fs.readFileSync(tasksPath, 'utf8'));
    const pendingNow = queues.now.length;
    const tick = advanceTick(workspacePath);

    // Priority: work [now] first; when empty, improve the system ([improve]); when
    // those are empty too, run any DUE [recurring] task. This is the full queue policy.
    const fromNow = queues.now[0];
    const fromImprove = !fromNow ? queues.improve[0] : undefined;
    const fromRecurring = !fromNow && !fromImprove ? nextDueRecurring(workspacePath, queues.recurring, tick) : null;

    const activeTask = fromNow ?? fromImprove ?? fromRecurring ?? undefined;
    const origin: 'now' | 'improve' | 'recurring' = fromNow ? 'now' : fromImprove ? 'improve' : 'recurring';
    if (!activeTask) {
        return { project, pendingNow: 0, run: null, incidents: countIncidents(workspacePath), summary: '' };
    }

    // Pull-based claiming through the configured backend (local fs or http multi-machine).
    const workerId = getWorkerId();
    const backend = createClaimBackend(workspacePath, loadPolicy(workspacePath).coordination);
    if (!(await backend.claim(activeTask, workerId))) {
        return {
            project,
            pendingNow,
            run: null,
            incidents: countIncidents(workspacePath),
            summary: `[${project}] ⏭️ Reclamada por otro worker: ${activeTask.trim()}`
        };
    }

    try {
        return await runClaimedTask(workspacePath, project, activeTask, origin, tick, clock);
    } finally {
        await backend.release(activeTask, workerId);
    }
}

/**
 * Executes a task the caller has already claimed: execute → verify → evidence →
 * memory → queue/recurring update. Split out so claim/release can wrap it cleanly.
 */
async function runClaimedTask(
    workspacePath: string,
    project: string,
    activeTask: string,
    origin: 'now' | 'improve' | 'recurring',
    tick: number,
    clock: Clock
): Promise<WorkspaceResult> {
    const tasksPath = path.resolve(workspacePath, TASKS_FILE);
    const pendingNow = parseTasks(fs.readFileSync(tasksPath, 'utf8')).now.length;

    console.log(`>>> [Workspace: ${project}] Procesando (${origin}): ${activeTask.trim()}`);
    const startedAt = clock();
    const coreMemory = `Proyecto: ${project}\n`;
    const execution = await executeTaskWithLLM(workspacePath, activeTask, coreMemory);

    // A dangerous command was deferred to a human (governance mode 'defer'): the task
    // isn't done and it isn't a failure either — it's paused. Skip verify/evidence/
    // learning/incidents entirely; the audit trail already lives in the PendingApproval
    // itself (`approvals.json`) plus the tool-call audit log.
    if (execution.awaitingApproval) {
        const { approvalId } = execution.awaitingApproval;
        const summary = `[${project}] ⏸️ Esperando aprobación humana (id: ${approvalId}): ${activeTask.trim()}`;
        if (origin === 'recurring') {
            // Left untouched under [recurring] — idempotent request() means retrying
            // next cadence won't spam duplicate pending approvals.
            return { project, pendingNow, run: null, incidents: countIncidents(workspacePath), summary };
        }
        const tasksContent = markTaskAwaitingApproval(fs.readFileSync(tasksPath, 'utf8'), activeTask, approvalId);
        fs.writeFileSync(tasksPath, tasksContent, 'utf8');
        return { project, pendingNow, run: null, incidents: countIncidents(workspacePath), summary };
    }

    const verdict = await verifyTask(workspacePath, activeTask, execution.log, execution.success);
    const learning = await distillLearning(activeTask, verdict, execution.log);
    const finishedAt = clock();

    const run = recordRun({
        workspacePath,
        task: activeTask,
        startedAt,
        finishedAt,
        executionSuccess: execution.success,
        verdict,
        log: execution.log,
        learning,
        taskId: extractTaskId(activeTask) ?? undefined
    });

    appendLearning(workspacePath, learning, finishedAt);

    // Recurring tasks are never consumed: they stay `- [ ]` and re-arm on their cadence.
    if (origin === 'recurring') {
        markRecurringRan(workspacePath, activeTask, tick);
        if (!verdict.verified) {
            recordIncident(
                workspacePath,
                {
                    severity: 'warning',
                    task: activeTask.trim(),
                    reason: verdict.reason,
                    evidencePath: run.evidencePath
                },
                finishedAt
            );
        }
        const tag = verdict.verified ? '🔁 Recurrente OK' : '🔁 Recurrente con incidencia';
        return {
            project,
            pendingNow,
            run,
            incidents: countIncidents(workspacePath),
            summary: `[${project}] ${tag}: ${activeTask.trim()} (evidencia: ${run.evidencePath})`
        };
    }

    // Update the task queues based on the verdict — only mark [x] WITH evidence.
    let tasksContent = fs.readFileSync(tasksPath, 'utf8');
    let summary: string;
    if (verdict.verified) {
        tasksContent = markTaskDone(tasksContent, activeTask);
        summary = `[${project}] ✅ Verificado: ${activeTask.trim()} (evidencia: ${run.evidencePath})`;
    } else {
        tasksContent = markTaskFailed(tasksContent, activeTask);
        // Only spawn a NEW improvement from a [now] failure. An [improve] task that
        // fails is not re-spawned, so the loop converges instead of running away.
        if (origin === 'now') {
            const improvement = await proposeImprovement(activeTask, verdict, execution.log);
            tasksContent = addImproveTask(tasksContent, improvement);
        }
        triggerFailureLog(workspacePath, activeTask, verdict.reason, finishedAt);
        recordIncident(
            workspacePath,
            {
                severity: 'error',
                task: activeTask.trim(),
                reason: verdict.reason,
                evidencePath: run.evidencePath
            },
            finishedAt
        );
        const tag = origin === 'improve' ? '❌ Mejora no resuelta' : '❌ No verificado';
        summary = `[${project}] ${tag}: ${activeTask.trim()} (evidencia: ${run.evidencePath})`;
    }
    fs.writeFileSync(tasksPath, tasksContent, 'utf8');

    return { project, pendingNow, run, incidents: countIncidents(workspacePath), summary };
}

function triggerFailureLog(workspacePath: string, task: string, reason: string, when: Date): void {
    const failurePath = path.resolve(workspacePath, 'FAILURE.md');
    const entry = `\n## Fallo de Verificación\n- **Fecha:** ${when.toISOString()}\n- **Tarea:** ${task.trim()}\n- **Razón:** ${reason}\n`;
    fs.appendFileSync(failurePath, entry, 'utf8');
}

/**
 * Discovers workspaces directly under `workspacesDir` (one level deep).
 */
export function discoverWorkspaces(workspacesDir: string): string[] {
    if (!fs.existsSync(workspacesDir)) return [];
    return fs.readdirSync(workspacesDir).filter((f) => fs.statSync(path.join(workspacesDir, f)).isDirectory());
}

/**
 * Runs one tick across ALL workspaces CONCURRENTLY. Because tool execution is now
 * async (non-blocking), multiple workspaces genuinely make progress in parallel —
 * this is what makes the "orchestrates multiple workspaces simultaneously" claim true.
 */
export async function runOnce(workspacesDir: string, clock: Clock = systemClock): Promise<WorkspaceResult[]> {
    const projects = discoverWorkspaces(workspacesDir);
    return Promise.all(projects.map((project) => processWorkspace(path.join(workspacesDir, project), project, clock)));
}
