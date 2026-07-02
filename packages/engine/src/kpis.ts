import { listRuns, readRun } from './evidence';
import { listIncidents, type Severity } from './incidents';
import { ApprovalStore } from '@cognitive-substrate/governance';
import type { RunRecord } from './types';

/**
 * Metrics derived entirely from data the engine already records — `runs/`,
 * `incidents.jsonl`, `approvals.json` — over a trailing time window. Nothing here is
 * invented: no cost-in-dollars, no contracts, no headcount. Those genuinely don't exist
 * anywhere in the system yet (see `packages/governance/src/budget.ts`, which only
 * counts LLM/tool call counts, not spend) — a UI built on top of this should show an
 * honest empty state for anything beyond what's computed here, not a mock.
 */
export interface WorkspaceKpis {
    periodDays: number;
    runsTotal: number;
    runsVerified: number;
    runsFailed: number;
    /** 0 (not NaN) when there are no runs in the window. */
    passRate: number;
    /** null when there are no runs in the window. */
    avgDurationMs: number | null;
    incidentsInPeriod: number;
    incidentsBySeverity: Record<Severity, number>;
    approvalsRequested: number;
    approvalsApproved: number;
    approvalsDenied: number;
    approvalsModified: number;
    approvalsPending: number;
}

function isWithin(iso: string, sinceMs: number): boolean {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= sinceMs;
}

/** Computes `WorkspaceKpis` over the trailing `periodDays` days from `now`. */
export function computeWorkspaceKpis(
    workspacePath: string,
    now: Date = new Date(),
    periodDays: number = 7
): WorkspaceKpis {
    const sinceMs = now.getTime() - periodDays * 24 * 60 * 60 * 1000;

    const runs: RunRecord[] = listRuns(workspacePath)
        .map((evidencePath) => readRun(workspacePath, evidencePath))
        .filter((r): r is RunRecord => r !== null)
        .filter((r) => isWithin(r.startedAt, sinceMs));

    const runsTotal = runs.length;
    const runsVerified = runs.filter((r) => r.verdict.verified).length;
    const runsFailed = runsTotal - runsVerified;
    const passRate = runsTotal > 0 ? runsVerified / runsTotal : 0;

    const durations = runs.map((r) => new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime());
    const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

    const incidents = listIncidents(workspacePath).filter((i) => isWithin(i.ts, sinceMs));
    const incidentsBySeverity: Record<Severity, number> = { warning: 0, error: 0 };
    for (const incident of incidents) incidentsBySeverity[incident.severity]++;

    const approvals = new ApprovalStore(workspacePath).listAll().filter((a) => isWithin(a.requestedAt, sinceMs));

    return {
        periodDays,
        runsTotal,
        runsVerified,
        runsFailed,
        passRate,
        avgDurationMs,
        incidentsInPeriod: incidents.length,
        incidentsBySeverity,
        approvalsRequested: approvals.length,
        approvalsApproved: approvals.filter((a) => a.status === 'approved').length,
        approvalsDenied: approvals.filter((a) => a.status === 'denied').length,
        approvalsModified: approvals.filter((a) => a.status === 'modified').length,
        approvalsPending: approvals.filter((a) => a.status === 'pending').length
    };
}
