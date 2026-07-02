import * as fs from 'fs';
import * as path from 'path';

/**
 * What to do with a command classified as dangerous:
 *  - `deny` (safe default): blocked, no human in the loop.
 *  - `allow`: explicit opt-in, runs unattended.
 *  - `defer`: queued as a `PendingApproval` (see `approvals.ts`) for a human to
 *    approve/deny/modify via the CLI or TUI, instead of being auto-decided.
 */
export type GovernanceMode = 'deny' | 'allow' | 'defer';

/** Where shell commands run: the host shell (`native`) or an isolated container. */
export type TerminalMode = 'native' | 'container';

/**
 * How task claiming is coordinated:
 *  - `local`: filesystem locks (single machine / shared volume). Default.
 *  - `http`: a shared coordination server, so workers on DIFFERENT machines coordinate.
 */
export interface CoordinationConfig {
    mode: 'local' | 'http';
    /** Base URL of the coordination server when mode is 'http'. */
    endpoint?: string;
}

export interface Policy {
    /** Default disposition for dangerous commands without human approval. */
    mode: GovernanceMode;
    /** Execution surface for shell commands. */
    terminal: TerminalMode;
    /** Substrings that are always allowed (override dangerous classification). */
    allow: string[];
    /** Substrings that are always denied (override everything). */
    deny: string[];
    /** Hard cap on model round-trips per task (bounded autonomy). */
    maxLlmCallsPerTask: number;
    /** Hard cap on tool invocations per task. */
    maxToolCallsPerTask: number;
    /** Domains the browser may fetch (egress allowlist). Empty = deny all (fail-safe). */
    browserAllowDomains: string[];
    /** Multi-machine coordination backend selection. */
    coordination: CoordinationConfig;
    /** Organizational metadata — NOT a security rule. Lives here anyway to reuse the
     * one per-workspace config file/loader rather than introduce a second one; if this
     * file ever accumulates more non-security fields, splitting to a dedicated
     * `workspace.json` is the right move (with a real use case, per project policy). */
    department?: string;
    displayName?: string;
}

export const defaultPolicy: Policy = {
    mode: 'deny',
    terminal: 'native',
    allow: [],
    deny: [],
    maxLlmCallsPerTask: 30,
    maxToolCallsPerTask: 50,
    browserAllowDomains: [],
    coordination: { mode: 'local' }
};

const POLICY_FILE = 'governance.json';

/**
 * Loads `<rootDir>/governance.json` if present and merges it over the safe defaults.
 * Missing or malformed files fall back to `defaultPolicy` (fail-safe, not fail-open).
 */
export function loadPolicy(rootDir: string): Policy {
    const file = path.resolve(rootDir, POLICY_FILE);
    if (!fs.existsSync(file)) return { ...defaultPolicy };
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Policy>;
        return {
            mode: raw.mode === 'allow' || raw.mode === 'defer' ? raw.mode : 'deny',
            terminal: raw.terminal === 'container' ? 'container' : 'native',
            allow: Array.isArray(raw.allow) ? raw.allow.map(String) : [],
            deny: Array.isArray(raw.deny) ? raw.deny.map(String) : [],
            maxLlmCallsPerTask:
                typeof raw.maxLlmCallsPerTask === 'number' ? raw.maxLlmCallsPerTask : defaultPolicy.maxLlmCallsPerTask,
            maxToolCallsPerTask:
                typeof raw.maxToolCallsPerTask === 'number'
                    ? raw.maxToolCallsPerTask
                    : defaultPolicy.maxToolCallsPerTask,
            browserAllowDomains: Array.isArray(raw.browserAllowDomains) ? raw.browserAllowDomains.map(String) : [],
            coordination:
                raw.coordination && raw.coordination.mode === 'http'
                    ? { mode: 'http', endpoint: String(raw.coordination.endpoint ?? '') }
                    : { mode: 'local' },
            ...(typeof raw.department === 'string' && raw.department.trim() ? { department: raw.department } : {}),
            ...(typeof raw.displayName === 'string' && raw.displayName.trim() ? { displayName: raw.displayName } : {})
        };
    } catch {
        return { ...defaultPolicy };
    }
}

/**
 * Persists an "always allow" / "always deny" rule from a resolved approval into
 * `governance.json`, reusing the existing substring allow/deny mechanism — this is
 * what the approval UX's "permitir siempre" / "denegar siempre" scope actually does.
 * Fail-safe: if the file is malformed, rebuilds it from the safe defaults rather than
 * throwing (a stray write failure here must never crash the caller).
 */
export function savePolicyAlwaysRule(rootDir: string, list: 'allow' | 'deny', pattern: string): void {
    const current = loadPolicy(rootDir);
    const updated: Policy = {
        ...current,
        [list]: current[list].includes(pattern) ? current[list] : [...current[list], pattern]
    };
    fs.writeFileSync(path.resolve(rootDir, POLICY_FILE), JSON.stringify(updated, null, 2), 'utf8');
}
