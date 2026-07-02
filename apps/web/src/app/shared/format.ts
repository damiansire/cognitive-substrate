/** Strips the raw markdown checkbox prefix (`- [ ] `, `- [x] `, `- [!] `) a task line
 * carries as stored in tasks.md — the UI shows the task text, not its markdown source. */
export function stripCheckbox(taskLine: string): string {
  return taskLine.replace(/^-\s*\[[ x!]\]\s*/, '').trim();
}

const PENDING_APPROVAL_RE = / \(pending-approval:([^)]+)\)/;
const TASK_ID_RE = / \(task-id:[^)]+\)/;
// `appendTaskToRecurring` (engine/tasks.ts) prepends this to every `[recurring]` task
// line — a design-review caught it leaking to screen raw ("@every:1 monitorear...").
const CADENCE_RE = /^@every:(\d+)\s+/i;

export interface ParsedTaskLine {
  text: string;
  pendingApprovalId?: string;
  /** Present for a `[recurring]` task line — how many engine ticks between runs. Not a
   * calendar cadence (the engine doesn't have one yet); render it as such. */
  cadenceTicks?: number;
}

/** Splits a task line into its human text and the system bookkeeping markers it may
 * carry — `(pending-approval:<id>)` (`markTaskAwaitingApproval`), `(task-id:<id>)`
 * (`engine/tasks.ts`), and `@every:<n>` (`appendTaskToRecurring`) — none of which a user
 * should have to decode on screen. */
export function parseTaskLine(taskLine: string): ParsedTaskLine {
  let working = stripCheckbox(taskLine).replace(TASK_ID_RE, '');

  let cadenceTicks: number | undefined;
  const cadenceMatch = CADENCE_RE.exec(working);
  if (cadenceMatch) {
    cadenceTicks = Number(cadenceMatch[1]);
    working = working.slice(cadenceMatch[0].length);
  }

  const match = working.match(PENDING_APPROVAL_RE);
  const base = { ...(cadenceTicks !== undefined ? { cadenceTicks } : {}) };
  if (!match) return { ...base, text: working.trim() };
  return {
    ...base,
    text: (working.slice(0, match.index) + working.slice(match.index! + match[0].length)).trim(),
    pendingApprovalId: match[1],
  };
}

/** The engine records evidence paths with the host OS's separator (`\` on Windows) —
 * normalize to `/` for display so the UI doesn't leak the server's platform. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}
