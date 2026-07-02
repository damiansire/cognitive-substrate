/** A single deterministic or model-based check performed during verification. */
export interface VerificationCheck {
    name: string;
    passed: boolean;
    detail: string;
}

/** The outcome of verifying a task: did the work actually get done, with evidence why. */
export interface Verdict {
    verified: boolean;
    reason: string;
    checks: VerificationCheck[];
}

/** A complete, auditable record of one task execution + verification. */
export interface RunRecord {
    workspace: string;
    task: string;
    startedAt: string;
    finishedAt: string;
    executionSuccess: boolean;
    verdict: Verdict;
    log: string;
    learning: string;
    /** Workspace-relative path to the evidence folder for this run. */
    evidencePath: string;
    /** The `(task-id:...)` of the task line this run executed, if it had one. */
    taskId?: string;
}

/** Result of processing a single workspace in one engine tick. */
export interface WorkspaceResult {
    project: string;
    /** Number of tasks remaining in the [now] queue after this tick. */
    pendingNow: number;
    /** The run executed this tick, if any. */
    run: RunRecord | null;
    /** Total incidents recorded for this workspace so far (observability). */
    incidents: number;
    /** Human-readable one-line summary for the global action log. */
    summary: string;
}
