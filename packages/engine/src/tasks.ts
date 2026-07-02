/** The five momentum queues the OS tracks in each workspace's `tasks.md`. */
export type QueueName = 'now' | 'next' | 'blocked' | 'improve' | 'recurring';

export type TaskQueues = Record<QueueName, string[]>;

let taskIdSequence = 0;

/** Monotonic-enough id for a single process: timestamp + in-process counter, same shape as `governance/approvals.ts: generateId`. */
export function generateTaskId(now: Date = new Date()): string {
    taskIdSequence = (taskIdSequence + 1) % 1_000_000;
    return `task-${now.getTime()}-${taskIdSequence}`;
}

// Not anchored to end-of-line: a task blocked on approval gets `(pending-approval:...)`
// appended AFTER this annotation, so `(task-id:...)` can end up mid-line.
const TASK_ID_RE = /\(task-id:([^)]+)\)/;

/** Reads the `(task-id:<id>)` annotation off a task line, if present. Null for legacy lines without one. */
export function extractTaskId(line: string): string | null {
    return TASK_ID_RE.exec(line)?.[1] ?? null;
}

const PENDING_APPROVAL_ANNOTATION_RE = / \(pending-approval:[^)]+\)/;

/**
 * The human-readable version of a task line: no checkbox marker, no `(task-id:...)`,
 * no `(pending-approval:...)`. Anything that quotes a task inside generated prose
 * (`improve.ts: proposeImprovement`, `memory.ts: distillLearning`) should read through
 * this instead of the raw line — those annotations are bookkeeping, never meant to
 * surface to a human. Mirrors `apps/web/src/app/shared/format.ts: parseTaskLine`, which
 * does the same stripping for on-screen text.
 */
export function humanTaskText(line: string): string {
    return line
        .replace(/^-\s*\[[ x!]\]\s*/, '')
        .replace(TASK_ID_RE, '')
        .replace(PENDING_APPROVAL_ANNOTATION_RE, '')
        .trim();
}

const SECTION_MARKERS: Array<[string, QueueName]> = [
    ['## [now]', 'now'],
    ['## [next]', 'next'],
    ['## [blocked]', 'blocked'],
    ['## [improve]', 'improve'],
    ['## [recurring]', 'recurring']
];

/**
 * Parses a `tasks.md` file into its five queues. Only unchecked items (`- [ ]`)
 * are collected; checked (`- [x]`) and failed (`- [!]`) items are intentionally
 * ignored so the engine only ever picks up pending work.
 */
export function parseTasks(content: string): TaskQueues {
    const lines = content.split('\n');
    let currentSection: QueueName | '' = '';
    const queues: TaskQueues = { now: [], next: [], blocked: [], improve: [], recurring: [] };

    for (const line of lines) {
        const marker = SECTION_MARKERS.find(([m]) => line.includes(m));
        if (marker) {
            currentSection = marker[1];
        } else if (line.startsWith('- [ ]') && currentSection) {
            queues[currentSection].push(line);
        }
    }
    return queues;
}

/** Marks a specific task line as completed (`- [ ]` → `- [x]`). */
export function markTaskDone(content: string, taskLine: string): string {
    return content.replace(taskLine, taskLine.replace('- [ ]', '- [x]'));
}

/** Marks a specific task line as failed (`- [ ]` → `- [!]`). */
export function markTaskFailed(content: string, taskLine: string): string {
    return content.replace(taskLine, taskLine.replace('- [ ]', '- [!]'));
}

const IMPROVE_HEADER = '## [improve]';

/**
 * Queues a follow-up item under the `[improve]` section, creating the section if
 * it doesn't exist. This is what feeds the self-improvement loop (later milestone).
 */
export function addImproveTask(content: string, text: string): string {
    const item = `- [ ] ${text.trim()}`;
    const headerLine = content.split('\n').find((l) => l.includes(IMPROVE_HEADER));
    if (headerLine) {
        return content.replace(headerLine, `${headerLine}\n${item}`);
    }
    const trimmed = content.endsWith('\n') ? content : `${content}\n`;
    return `${trimmed}\n${IMPROVE_HEADER} - Auto-Mejora y Correcciones\n${item}\n`;
}

/** Builds a fresh `tasks.md` scaffold with the five queues and one seed task. */
export function buildTasksScaffold(seedTask: string, now: Date = new Date()): string {
    return [
        '# Plan de Tareas',
        '',
        '## [now]',
        `- [ ] ${seedTask.trim()} (task-id:${generateTaskId(now)})`,
        '',
        '## [next]',
        '',
        '## [blocked]',
        '',
        '## [improve] - Auto-Mejora y Correcciones',
        '',
        '## [recurring]',
        ''
    ].join('\n');
}

/** Appends decomposed subtasks under the `[now]` queue of an existing tasks.md. */
export function appendTasksToNow(content: string, tasks: string[], now: Date = new Date()): string {
    if (tasks.length === 0) return content;
    const items = tasks.map((t) => `- [ ] ${t.trim()} (task-id:${generateTaskId(now)})`).join('\n');
    const nowHeader = content.split('\n').find((l) => l.includes('## [now]'));
    if (nowHeader) {
        return content.replace(nowHeader, `${nowHeader}\n${items}`);
    }
    const trimmed = content.endsWith('\n') ? content : `${content}\n`;
    return `${trimmed}\n## [now]\n${items}\n`;
}

const RECURRING_HEADER = '## [recurring]';

/**
 * Queues a task under `[recurring]` (creating the section if missing), tagged with a
 * default `@every:1` cadence — see `recurring.ts: parseCadence` — so it re-arms every
 * tick. Used by the ask bar's `monitorear`/`automatizar`/`agendar` verbs
 * (`askRouter.ts`). Known limitation, documented rather than hidden: cadence here is in
 * engine ticks, not wall-clock time — "todos los lunes" has no real translation yet.
 */
export function appendTaskToRecurring(content: string, task: string, now: Date = new Date()): string {
    const item = `- [ ] @every:1 ${task.trim()} (task-id:${generateTaskId(now)})`;
    const headerLine = content.split('\n').find((l) => l.includes(RECURRING_HEADER));
    if (headerLine) {
        return content.replace(headerLine, `${headerLine}\n${item}`);
    }
    const trimmed = content.endsWith('\n') ? content : `${content}\n`;
    return `${trimmed}\n${RECURRING_HEADER}\n${item}\n`;
}

const BLOCKED_HEADER = '## [blocked]';

/** Removes the first line that matches `line` exactly, if any. */
function removeFirstLine(content: string, line: string): string {
    const lines = content.split('\n');
    const idx = lines.indexOf(line);
    if (idx !== -1) lines.splice(idx, 1);
    return lines.join('\n');
}

/**
 * Moves a task out of its current queue and into `[blocked]`, annotated with the id of
 * the `PendingApproval` (from `@cognitive-substrate/governance`) it's waiting on. Used
 * when a dangerous command is deferred to a human instead of auto-denied — the task
 * genuinely can't make progress until someone resolves it.
 */
export function markTaskAwaitingApproval(content: string, taskLine: string, approvalId: string): string {
    const withoutTask = removeFirstLine(content, taskLine);
    const bareTask = taskLine.replace(/^-\s*\[[ x!]\]\s*/, '').trim();
    const item = `- [ ] ${bareTask} (pending-approval:${approvalId})`;

    const headerLine = withoutTask.split('\n').find((l) => l.includes(BLOCKED_HEADER));
    if (headerLine) {
        return withoutTask.replace(headerLine, `${headerLine}\n${item}`);
    }
    const trimmed = withoutTask.endsWith('\n') ? withoutTask : `${withoutTask}\n`;
    return `${trimmed}\n${BLOCKED_HEADER}\n${item}\n`;
}

/**
 * Moves a task back from `[blocked]` to `[now]` once its pending approval has been
 * resolved, stripping the `(pending-approval:<id>)` annotation. No-op if no blocked
 * task references this approval id.
 */
export function requeueApprovedTask(content: string, approvalId: string): string {
    const marker = ` (pending-approval:${approvalId})`;
    const lines = content.split('\n');
    const idx = lines.findIndex((l) => l.includes(marker));
    if (idx === -1) return content;

    const restored = lines[idx]!.replace(marker, '');
    lines.splice(idx, 1);
    const withoutBlocked = lines.join('\n');

    const nowHeader = withoutBlocked.split('\n').find((l) => l.includes('## [now]'));
    if (nowHeader) {
        return withoutBlocked.replace(nowHeader, `${nowHeader}\n${restored}`);
    }
    const trimmed = withoutBlocked.endsWith('\n') ? withoutBlocked : `${withoutBlocked}\n`;
    return `${trimmed}\n## [now]\n${restored}\n`;
}
