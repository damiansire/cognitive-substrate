import * as fs from 'fs';
import * as path from 'path';
import { parseTasks, extractTaskId, type TaskQueues, type QueueName } from './tasks';
import { listIncidents, type StoredIncident } from './incidents';
import { listRuns, readRun, buildTaskEvidenceIndex } from './evidence';
import { discoverWorkspaces } from './orchestrator';
import { computeWorkspaceKpis, type WorkspaceKpis } from './kpis';
import { listClaims, type StoredClaimEntry } from './claims';
import type { RunRecord } from './types';
import { ApprovalStore, loadPolicy, type PendingApproval } from '@cognitive-substrate/governance';
import { discoverSkills, type SkillMetadata } from '@cognitive-substrate/skills-parser';

/**
 * Read-only projections over a workspace's on-disk state (tasks.md, approvals.json,
 * incidents.jsonl, runs/) — the single source of truth for both the CLI and the TUI, so
 * neither re-implements its own parsing of the same files.
 */

const TASKS_FILE = 'tasks.md';
const GOAL_FILE = 'goal.md';

export interface ResolvedWorkspace {
    path: string;
    project: string;
}

/**
 * Resolves the workspace(s) a CLI/TUI invocation should operate over: a directory with
 * `tasks.md`/`goal.md` is a single local workspace; otherwise `workspaces/*` (global
 * daemon mode) is discovered. Shared by both interface surfaces so "what counts as a
 * workspace" is defined once.
 */
export function resolveWorkspaces(rootDir: string): ResolvedWorkspace[] {
    const isLocal = fs.existsSync(path.resolve(rootDir, TASKS_FILE)) || fs.existsSync(path.resolve(rootDir, GOAL_FILE));
    if (isLocal) {
        return [{ path: rootDir, project: path.basename(rootDir) || 'local' }];
    }
    const workspacesDir = path.resolve(rootDir, 'workspaces');
    return discoverWorkspaces(workspacesDir).map((name) => ({
        path: path.join(workspacesDir, name),
        project: name
    }));
}

function readQueues(workspacePath: string): TaskQueues {
    const tasksPath = path.resolve(workspacePath, TASKS_FILE);
    if (!fs.existsSync(tasksPath)) return { now: [], next: [], blocked: [], improve: [], recurring: [] };
    return parseTasks(fs.readFileSync(tasksPath, 'utf8'));
}

export interface HomeSummary {
    project: string;
    pendingNow: number;
    pendingNext: number;
    blocked: number;
    pendingApprovals: number;
    incidents: number;
    lastRun: RunRecord | null;
}

/** High-altitude, one-workspace-at-a-glance summary — the "home" view. */
export function getHomeSummary(workspacePath: string, project: string): HomeSummary {
    const queues = readQueues(workspacePath);
    const runs = listRuns(workspacePath);
    const lastRun = runs.length > 0 && runs[0] ? readRun(workspacePath, runs[0]) : null;
    return {
        project,
        pendingNow: queues.now.length,
        pendingNext: queues.next.length,
        blocked: queues.blocked.length,
        pendingApprovals: new ApprovalStore(workspacePath).listPending().length,
        incidents: listIncidents(workspacePath).length,
        lastRun
    };
}

export interface InboxApprovalItem {
    kind: 'approval';
    project: string;
    approval: PendingApproval;
}

export interface InboxIncidentItem {
    kind: 'incident';
    project: string;
    incident: StoredIncident;
}

export type InboxItem = InboxApprovalItem | InboxIncidentItem;

/** Everything that needs a human's attention: pending approvals + recorded incidents. */
export function getInboxItems(workspacePath: string, project: string): InboxItem[] {
    const approvals: InboxItem[] = new ApprovalStore(workspacePath)
        .listPending()
        .map((approval) => ({ kind: 'approval', project, approval }));
    const incidents: InboxItem[] = listIncidents(workspacePath).map((incident) => ({
        kind: 'incident',
        project,
        incident
    }));
    return [...approvals, ...incidents];
}

/** Tasks grouped by queue — the board view. Thin, named wrapper over `parseTasks`. */
export function getBoard(workspacePath: string): TaskQueues {
    return readQueues(workspacePath);
}

export interface BoardTask {
    line: string;
    taskId: string | null;
    /** Most recent evidence for this exact task id, if any run has produced one yet. */
    evidencePath: string | null;
}

export type BoardWithEvidence = Record<QueueName, BoardTask[]>;

/**
 * Same queues as `getBoard`, but each task carries its `(task-id:...)` (if annotated)
 * and the evidencePath of the run that most recently executed it — this is what lets
 * the UI drill down from a specific task to ITS session, instead of only "the most
 * recent run in the workspace" (which is wrong for e.g. `[recurring]` tasks once more
 * than one task is in flight).
 */
export function getBoardWithEvidence(workspacePath: string): BoardWithEvidence {
    const queues = readQueues(workspacePath);
    const index = buildTaskEvidenceIndex(workspacePath);
    const withEvidence = (lines: string[]): BoardTask[] =>
        lines.map((line) => {
            const taskId = extractTaskId(line);
            return { line, taskId, evidencePath: taskId ? (index.get(taskId) ?? null) : null };
        });

    return {
        now: withEvidence(queues.now),
        next: withEvidence(queues.next),
        blocked: withEvidence(queues.blocked),
        improve: withEvidence(queues.improve),
        recurring: withEvidence(queues.recurring)
    };
}

export interface SessionTrace {
    evidencePath: string;
    record: RunRecord | null;
    summaryMd: string | null;
}

/** Drill-down into one run: the raw record plus its human-readable summary.md. */
export function getSessionTrace(workspacePath: string, evidencePath: string): SessionTrace {
    const record = readRun(workspacePath, evidencePath);
    const summaryPath = path.resolve(workspacePath, evidencePath, 'summary.md');
    const summaryMd = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : null;
    return { evidencePath, record, summaryMd };
}

/** Most recent run's evidence path (workspace-relative), or null if none yet. */
export function getLatestRunPath(workspacePath: string): string | null {
    const runs = listRuns(workspacePath);
    return runs[0] ?? null;
}

/** One workspace's KPIs over a trailing window — see `kpis.ts` for what's real vs. not. */
export function getWorkspaceKpis(workspacePath: string, periodDays = 7, now: Date = new Date()): WorkspaceKpis {
    return computeWorkspaceKpis(workspacePath, now, periodDays);
}

/** Sums/weighted-averages a set of `WorkspaceKpis` into one — the aggregation a
 * department or portfolio-wide rollup needs. Not exported: only meaningful paired with
 * the `project`/`department` labels `getDepartmentSummaries` attaches to it. */
function aggregateKpis(periodDays: number, kpisList: WorkspaceKpis[]): WorkspaceKpis {
    const sum = (pick: (k: WorkspaceKpis) => number): number => kpisList.reduce((acc, k) => acc + pick(k), 0);

    const runsTotal = sum((k) => k.runsTotal);
    const runsVerified = sum((k) => k.runsVerified);
    const totalDurationMs = kpisList.reduce((acc, k) => acc + (k.avgDurationMs ?? 0) * k.runsTotal, 0);

    return {
        periodDays,
        runsTotal,
        runsVerified,
        runsFailed: runsTotal - runsVerified,
        passRate: runsTotal > 0 ? runsVerified / runsTotal : 0,
        avgDurationMs: runsTotal > 0 ? totalDurationMs / runsTotal : null,
        incidentsInPeriod: sum((k) => k.incidentsInPeriod),
        incidentsBySeverity: {
            warning: sum((k) => k.incidentsBySeverity.warning),
            error: sum((k) => k.incidentsBySeverity.error)
        },
        approvalsRequested: sum((k) => k.approvalsRequested),
        approvalsApproved: sum((k) => k.approvalsApproved),
        approvalsDenied: sum((k) => k.approvalsDenied),
        approvalsModified: sum((k) => k.approvalsModified),
        approvalsPending: sum((k) => k.approvalsPending)
    };
}

const NO_DEPARTMENT = 'sin-departamento';

export interface DepartmentSummary {
    department: string;
    workspaces: string[];
    kpis: WorkspaceKpis;
}

/**
 * Groups every workspace under `rootDir` by its configured `governance.json:department`
 * (falling back to a single `"sin-departamento"` bucket for the rest — never a dead
 * end), aggregating real KPIs per group. No department data ⇒ one bucket with
 * everything, not an empty screen.
 */
export function getDepartmentSummaries(rootDir: string, periodDays = 7, now: Date = new Date()): DepartmentSummary[] {
    const groups = new Map<string, { workspaces: string[]; kpis: WorkspaceKpis[] }>();
    for (const ws of resolveWorkspaces(rootDir)) {
        const department = loadPolicy(ws.path).department ?? NO_DEPARTMENT;
        const group = groups.get(department) ?? { workspaces: [], kpis: [] };
        group.workspaces.push(ws.project);
        group.kpis.push(computeWorkspaceKpis(ws.path, now, periodDays));
        groups.set(department, group);
    }
    return [...groups.entries()]
        .map(([department, { workspaces, kpis }]) => ({
            department,
            workspaces,
            kpis: aggregateKpis(periodDays, kpis)
        }))
        .sort((a, b) => a.department.localeCompare(b.department));
}

export interface PortfolioRow {
    project: string;
    department?: string;
    kpis: WorkspaceKpis;
}

/** One row per workspace, for a portfolio-wide comparison (which project has the
 * lowest pass-rate / most incidents — a real signal, not a fabricated risk score). */
export function getPortfolioComparison(rootDir: string, periodDays = 7, now: Date = new Date()): PortfolioRow[] {
    return resolveWorkspaces(rootDir).map((ws) => {
        const policy = loadPolicy(ws.path);
        return {
            project: ws.project,
            ...(policy.department ? { department: policy.department } : {}),
            kpis: computeWorkspaceKpis(ws.path, now, periodDays)
        };
    });
}

// ---------------------------------------------------------------------------------
// Vista 5 — Artefactos
// ---------------------------------------------------------------------------------

export interface ArtifactEntry {
    /** Workspace-relative path. */
    relPath: string;
    sizeBytes: number;
    mtime: string;
    kind: 'run-evidence' | 'workspace-file';
    /** Set only for kind === 'run-evidence': which run produced this file. */
    runEvidencePath?: string;
}

const ARTIFACT_EXCLUDED_DIRS = new Set(['runs', '.claims', '.git', 'node_modules']);
const ARTIFACT_WALK_MAX_DEPTH = 2;

/**
 * Lists real files: every file inside each `runs/<...>/` (run evidence — `run.json`,
 * `summary.md`, and anything a task wrote there) plus a shallow (depth-limited) walk of
 * the rest of the workspace. Sorted most-recently-modified first, capped at `limit` so a
 * large workspace doesn't return an unbounded tree. No diffs (before/after) — the engine
 * doesn't snapshot file contents anywhere, so that's not something this can show.
 */
export function listArtifacts(workspacePath: string, limit = 200): ArtifactEntry[] {
    const entries: ArtifactEntry[] = [];

    for (const evidencePath of listRuns(workspacePath)) {
        const absDir = path.resolve(workspacePath, evidencePath);
        let files: string[];
        try {
            files = fs.readdirSync(absDir);
        } catch {
            continue;
        }
        for (const file of files) {
            const abs = path.join(absDir, file);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(abs);
            } catch {
                continue;
            }
            if (!stat.isFile()) continue;
            entries.push({
                relPath: path.join(evidencePath, file),
                sizeBytes: stat.size,
                mtime: stat.mtime.toISOString(),
                kind: 'run-evidence',
                runEvidencePath: evidencePath
            });
        }
    }

    function walk(dir: string, relBase: string, depth: number): void {
        if (depth > ARTIFACT_WALK_MAX_DEPTH) return;
        let items: fs.Dirent[];
        try {
            items = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const item of items) {
            if (item.name.startsWith('.') || ARTIFACT_EXCLUDED_DIRS.has(item.name)) continue;
            const abs = path.join(dir, item.name);
            const rel = path.join(relBase, item.name);
            if (item.isDirectory()) {
                walk(abs, rel, depth + 1);
                continue;
            }
            if (!item.isFile()) continue;
            let stat: fs.Stats;
            try {
                stat = fs.statSync(abs);
            } catch {
                continue;
            }
            entries.push({
                relPath: rel,
                sizeBytes: stat.size,
                mtime: stat.mtime.toISOString(),
                kind: 'workspace-file'
            });
        }
    }
    walk(workspacePath, '', 0);

    return entries.sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, limit);
}

// ---------------------------------------------------------------------------------
// Vista 6 — Máquina y entorno
// ---------------------------------------------------------------------------------

export interface EnvironmentSnapshot {
    coordinationMode: 'local' | 'http';
    coordinationEndpoint?: string;
    claims: StoredClaimEntry[];
}

/**
 * The only real data this OS has about "machine/environment" today: the coordination
 * mode a workspace is configured for, and its active/expired task claims
 * (`runs/.claims/*.json`). CPU/memory/terminals/desktops have no instrumentation
 * anywhere in the codebase — deliberately not fabricated here. In `http` coordination
 * mode, which remote machine holds which claim isn't exposed by the coordinator's API
 * either (it only answers claim/release/status for one `taskKey` at a time) — the UI
 * layer says so explicitly rather than pretending to know.
 */
export function getEnvironmentSnapshot(workspacePath: string, now: Date = new Date()): EnvironmentSnapshot {
    const policy = loadPolicy(workspacePath);
    return {
        coordinationMode: policy.coordination.mode,
        ...(policy.coordination.mode === 'http' && policy.coordination.endpoint
            ? { coordinationEndpoint: policy.coordination.endpoint }
            : {}),
        claims: listClaims(workspacePath, now)
    };
}

// ---------------------------------------------------------------------------------
// Vista 10 — Aprendizaje
// ---------------------------------------------------------------------------------

export interface EvalReportSummary {
    generatedAt: string;
    simulation: boolean;
    total: number;
    passed: number;
    passRate: number;
}

/**
 * Reads `<evalsReportDir>/report.json`'s summary fields, if the file exists and matches
 * the expected shape. Deliberately duck-typed instead of importing
 * `@cognitive-substrate/evals`'s `EvalReport` type — that package depends on `engine`,
 * so the reverse import would be circular. A single snapshot, not a trend: there's no
 * history file (`writeReport` overwrites `report.json` every run), so "regressions" or
 * "confidence over time" aren't derivable yet.
 */
export function getLatestEvalReport(evalsReportDir: string): EvalReportSummary | null {
    const file = path.resolve(evalsReportDir, 'report.json');
    if (!fs.existsSync(file)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (
            typeof raw['generatedAt'] !== 'string' ||
            typeof raw['simulation'] !== 'boolean' ||
            typeof raw['total'] !== 'number' ||
            typeof raw['passed'] !== 'number' ||
            typeof raw['passRate'] !== 'number'
        ) {
            return null;
        }
        return {
            generatedAt: raw['generatedAt'],
            simulation: raw['simulation'],
            total: raw['total'],
            passed: raw['passed'],
            passRate: raw['passRate']
        };
    } catch {
        return null;
    }
}

export interface LearningSnapshot {
    /** Raw `[improve]` queue lines — already exposed by `getBoard`, reused here rather
     * than re-parsing tasks.md a second way. */
    improveQueue: string[];
    skills: SkillMetadata[];
    latestEvalReport: EvalReportSummary | null;
}

/** `evalsReportDir` is optional and separate from `workspacePath` on purpose: the evals
 * report is a property of the cognitive-substrate-os checkout itself (evals run in their
 * own temp workspaces), not of any one user workspace — assuming they're the same
 * directory would be wrong in the general case. */
export function getLearningSnapshot(workspacePath: string, evalsReportDir?: string): LearningSnapshot {
    return {
        improveQueue: readQueues(workspacePath).improve,
        skills: discoverSkills(workspacePath),
        latestEvalReport: evalsReportDir ? getLatestEvalReport(evalsReportDir) : null
    };
}
