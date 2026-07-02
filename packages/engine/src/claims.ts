import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Pull-based work claiming for multi-worker coordination.
 *
 * The CHARTER prefers "pull-based work claiming over brittle centralized control":
 * any number of worker processes can point at the same workspaces, and a task is only
 * worked by whoever atomically claims it first. Claims are filesystem locks with a TTL,
 * so a crashed worker's claim expires and the work becomes available again.
 */

const CLAIMS_DIR = path.join('runs', '.claims');
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface ClaimInfo {
    workerId: string;
    claimedAt: string;
    expiresAt: string;
}

/** Stable identifier for this worker process (override with CSOS_WORKER_ID). */
export function getWorkerId(): string {
    return process.env['CSOS_WORKER_ID'] || `${os.hostname()}-${process.pid}`;
}

/** Maps a task line to a safe lock filename. */
export function claimFileName(taskKey: string): string {
    const safe = taskKey
        .replace(/^-\s*\[[ x!]\]\s*/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${safe || 'task'}.json`;
}

function lockPath(workspacePath: string, taskKey: string): string {
    return path.resolve(workspacePath, CLAIMS_DIR, claimFileName(taskKey));
}

function readClaim(file: string): ClaimInfo | null {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as ClaimInfo;
    } catch {
        return null;
    }
}

/**
 * Attempts to atomically claim a task. Returns true if THIS worker now holds the claim.
 * Uses an exclusive create (`wx`) so concurrent workers can't both win. If an existing
 * claim has expired, it is taken over.
 */
export function claimTask(
    workspacePath: string,
    taskKey: string,
    workerId: string = getWorkerId(),
    ttlMs: number = DEFAULT_TTL_MS,
    now: Date = new Date()
): boolean {
    const file = lockPath(workspacePath, taskKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const info: ClaimInfo = {
        workerId,
        claimedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    };
    const payload = JSON.stringify(info);

    try {
        fs.writeFileSync(file, payload, { encoding: 'utf8', flag: 'wx' });
        return true;
    } catch (e: any) {
        if (e?.code !== 'EEXIST') throw e;
    }

    // A claim already exists — take it over only if it has expired.
    const existing = readClaim(file);
    if (existing && new Date(existing.expiresAt).getTime() > now.getTime()) {
        return existing.workerId === workerId; // re-entrant for the same worker
    }
    // Expired (or unreadable): overwrite to take ownership.
    fs.writeFileSync(file, payload, 'utf8');
    return true;
}

/** Releases a claim this worker holds (no-op if not held). */
export function releaseClaim(workspacePath: string, taskKey: string, workerId: string = getWorkerId()): void {
    const file = lockPath(workspacePath, taskKey);
    const existing = readClaim(file);
    if (existing && existing.workerId !== workerId) return; // don't release someone else's claim
    try {
        fs.rmSync(file, { force: true });
    } catch {
        /* best-effort */
    }
}

/** True if the task currently has a live (unexpired) claim by anyone. */
export function isClaimed(workspacePath: string, taskKey: string, now: Date = new Date()): boolean {
    const existing = readClaim(lockPath(workspacePath, taskKey));
    return !!existing && new Date(existing.expiresAt).getTime() > now.getTime();
}

/** One claim lock file on disk, plus whether it's still live — the "máquina/entorno"
 * view's only real data source (see `readModel.ts: getEnvironmentSnapshot`). */
export interface StoredClaimEntry extends ClaimInfo {
    /** The lock filename (`claimFileName`'s output) — the closest thing to a task
     * identifier this mechanism has; not the original task text. */
    taskKeyFile: string;
    expired: boolean;
}

/** Lists every claim lock file under `runs/.claims/`, live or expired. Malformed or
 * unreadable entries are skipped rather than failing the whole listing. */
export function listClaims(workspacePath: string, now: Date = new Date()): StoredClaimEntry[] {
    const dir = path.resolve(workspacePath, CLAIMS_DIR);
    if (!fs.existsSync(dir)) return [];
    const entries: StoredClaimEntry[] = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const info = readClaim(path.join(dir, file));
        if (!info) continue;
        entries.push({ ...info, taskKeyFile: file, expired: new Date(info.expiresAt).getTime() <= now.getTime() });
    }
    return entries.sort((a, b) => b.claimedAt.localeCompare(a.claimedAt));
}
