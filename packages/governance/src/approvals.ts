import * as fs from 'fs';
import * as path from 'path';

/**
 * The queue of dangerous commands deferred to a human when `Policy.mode === 'defer'`.
 * This is the domain object the interface layer (CLI/TUI) needs to exist before any
 * approval UX can show something real instead of an automatic allow/deny.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'modified';

export interface PendingApproval {
    id: string;
    /** Display label for the workspace this approval belongs to (basename of its root dir). */
    workspace: string;
    /** The exact task line that triggered the dangerous command. */
    task: string;
    /** The exact command that was flagged. */
    command: string;
    /** Why it was flagged (classification reason from `classifyCommand`). */
    reason: string;
    risk: string;
    requestedAt: string;
    status: ApprovalStatus;
    resolvedAt?: string;
    /** Present only when the human chose to modify rather than approve/deny as-is. */
    modifiedCommand?: string;
}

export interface ResolveInput {
    action: 'approve' | 'deny' | 'modify';
    /** 'always' persists an allow/deny rule to governance.json; ignored for 'modify'. */
    scope: 'once' | 'always';
    modifiedCommand?: string;
}

const APPROVALS_FILE = 'approvals.json';

function approvalsPath(rootDir: string): string {
    return path.resolve(rootDir, APPROVALS_FILE);
}

function readAll(rootDir: string): PendingApproval[] {
    const file = approvalsPath(rootDir);
    if (!fs.existsSync(file)) return [];
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

function writeAll(rootDir: string, entries: PendingApproval[]): void {
    fs.writeFileSync(approvalsPath(rootDir), JSON.stringify(entries, null, 2), 'utf8');
}

let sequence = 0;

/** Monotonic-enough id for a single process: timestamp + in-process counter. */
function generateId(now: Date): string {
    sequence = (sequence + 1) % 1_000_000;
    return `appr-${now.getTime()}-${sequence}`;
}

/**
 * File-backed queue of pending approvals for one workspace (`<rootDir>/approvals.json`).
 * Read-modify-write, same fail-safe-on-malformed-json pattern as `loadPolicy`. Persisted
 * (not in-memory) because a human resolves these from a *separate* CLI/TUI invocation,
 * potentially long after the tick that requested them.
 */
export class ApprovalStore {
    constructor(private readonly rootDir: string) {}

    listAll(): PendingApproval[] {
        return readAll(this.rootDir);
    }

    listPending(): PendingApproval[] {
        return this.listAll().filter((a) => a.status === 'pending');
    }

    /** Finds any approval (any status) already requested for this exact task+command. */
    findMatch(task: string, command: string): PendingApproval | undefined {
        return this.listAll().find((a) => a.task === task && a.command === command);
    }

    /**
     * Requests approval for a command, or returns the existing entry if one was already
     * requested for this task+command (idempotent — a retried tool call shouldn't spam
     * duplicate pending entries).
     */
    request(
        input: { workspace: string; task: string; command: string; reason: string; risk: string },
        now: Date = new Date()
    ): PendingApproval {
        const existing = this.findMatch(input.task, input.command);
        if (existing) return existing;

        const entry: PendingApproval = {
            id: generateId(now),
            ...input,
            requestedAt: now.toISOString(),
            status: 'pending'
        };
        const entries = this.listAll();
        entries.push(entry);
        writeAll(this.rootDir, entries);
        return entry;
    }

    /** Resolves a pending approval. Returns null if `id` doesn't exist. */
    resolve(id: string, resolution: ResolveInput, now: Date = new Date()): PendingApproval | null {
        const entries = this.listAll();
        const idx = entries.findIndex((a) => a.id === id);
        const existing = entries[idx];
        if (idx === -1 || !existing) return null;

        const status: ApprovalStatus =
            resolution.action === 'approve' ? 'approved' : resolution.action === 'deny' ? 'denied' : 'modified';

        const updated: PendingApproval = {
            ...existing,
            status,
            resolvedAt: now.toISOString(),
            ...(resolution.modifiedCommand ? { modifiedCommand: resolution.modifiedCommand } : {})
        };
        entries[idx] = updated;
        writeAll(this.rootDir, entries);
        return updated;
    }
}
