/**
 * Mirrors the JSON shapes served by apps/web-server (itself a thin REST wrapper over
 * @cognitive-substrate/engine's readModel.ts). Deliberately NOT imported from the engine
 * package — that package is Node-only (fs/path), so the browser bundle only depends on
 * the REST contract, not on the server-side implementation.
 */

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Verdict {
  verified: boolean;
  reason: string;
  checks: VerificationCheck[];
}

export interface RunRecord {
  workspace: string;
  task: string;
  startedAt: string;
  finishedAt: string;
  executionSuccess: boolean;
  verdict: Verdict;
  log: string;
  learning: string;
  evidencePath: string;
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

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'modified';

export interface PendingApproval {
  id: string;
  workspace: string;
  task: string;
  command: string;
  reason: string;
  risk: string;
  requestedAt: string;
  status: ApprovalStatus;
  resolvedAt?: string;
  modifiedCommand?: string;
}

export type Severity = 'warning' | 'error';

export interface StoredIncident {
  ts: string;
  severity: Severity;
  task: string;
  reason: string;
  evidencePath?: string;
}

export type InboxItem =
  | { kind: 'approval'; project: string; approval: PendingApproval }
  | { kind: 'incident'; project: string; incident: StoredIncident };

export type QueueName = 'now' | 'next' | 'blocked' | 'improve' | 'recurring';
export type TaskQueues = Record<QueueName, string[]>;

export interface BoardTask {
  line: string;
  taskId: string | null;
  /** Most recent evidence for this exact task id, if any run has produced one yet. */
  evidencePath: string | null;
}

export type BoardWithEvidence = Record<QueueName, BoardTask[]>;

export interface SessionTrace {
  evidencePath: string;
  record: RunRecord | null;
  summaryMd: string | null;
}

export interface WorkspaceListResponse {
  workspaces: Array<{ project: string; home: HomeSummary }>;
}

export interface InboxResponse {
  items: InboxItem[];
}

export interface BoardResponse {
  board: BoardWithEvidence;
}

export type ResolveAction = 'approve' | 'deny' | 'modify';
export type ResolveScope = 'once' | 'always';

export interface ResolveApprovalRequest {
  action: ResolveAction;
  scope: ResolveScope;
  modifiedCommand?: string;
}

export interface ResolveApprovalResponse {
  approval: PendingApproval;
}

/** The 12 control verbs / 7 response modes from the charter's ask bar doctrine —
 * mirrored from `packages/engine/src/ask.ts`. */
export type AskVerb =
  | 'responder'
  | 'explicar'
  | 'hacer'
  | 'monitorear'
  | 'automatizar'
  | 'agendar'
  | 'comparar'
  | 'inspeccionar'
  | 'detener'
  | 'reintentar'
  | 'escalar'
  | 'simplificar';

export type AskMode =
  | 'respuesta'
  | 'borrador'
  | 'plan'
  | 'ejecucion_unica'
  | 'objetivo_largo_plazo'
  | 'automatizacion_recurrente'
  | 'reporte';

export interface AskInterpretation {
  verb: AskVerb;
  mode: AskMode;
  confidence: number;
}

export interface AskRequest {
  text: string;
}

export interface AskResponse {
  interpretation: AskInterpretation;
  message: string;
}

/** Metrics derived from real data (`runs/`, `incidents.jsonl`, `approvals.json`) over a
 * trailing window — mirrored from `packages/engine/src/kpis.ts`. Nothing here is
 * fabricated: no cost-in-dollars, no contracts, no headcount exist in the system today. */
export interface WorkspaceKpis {
  periodDays: number;
  runsTotal: number;
  runsVerified: number;
  runsFailed: number;
  passRate: number;
  avgDurationMs: number | null;
  incidentsInPeriod: number;
  incidentsBySeverity: Record<Severity, number>;
  approvalsRequested: number;
  approvalsApproved: number;
  approvalsDenied: number;
  approvalsModified: number;
  approvalsPending: number;
}

export interface KpisResponse {
  kpis: WorkspaceKpis;
}

export interface DepartmentSummary {
  department: string;
  workspaces: string[];
  kpis: WorkspaceKpis;
}

export interface DepartmentsResponse {
  departments: DepartmentSummary[];
}

export interface PortfolioRow {
  project: string;
  department?: string;
  kpis: WorkspaceKpis;
}

export interface PortfolioResponse {
  portfolio: PortfolioRow[];
}

export type ArtifactKind = 'run-evidence' | 'workspace-file';

export interface ArtifactEntry {
  relPath: string;
  sizeBytes: number;
  mtime: string;
  kind: ArtifactKind;
  runEvidencePath?: string;
}

export interface ArtifactsResponse {
  artifacts: ArtifactEntry[];
}

export interface ClaimInfo {
  workerId: string;
  claimedAt: string;
  expiresAt: string;
}

export interface StoredClaimEntry extends ClaimInfo {
  taskKeyFile: string;
  expired: boolean;
}

export interface EnvironmentSnapshot {
  coordinationMode: 'local' | 'http';
  coordinationEndpoint?: string;
  claims: StoredClaimEntry[];
}

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
}

export interface EvalReportSummary {
  generatedAt: string;
  simulation: boolean;
  total: number;
  passed: number;
  passRate: number;
}

export interface LearningSnapshot {
  improveQueue: string[];
  skills: SkillMetadata[];
  latestEvalReport: EvalReportSummary | null;
}
