import { classifyCommand } from './classify';
import type { Policy } from './policy';
import type { ApprovalStore } from './approvals';

export interface Decision {
    allowed: boolean;
    reason: string;
    /**
     * Richer outcome than `allowed`. `allowed` is `false` for BOTH 'denied' and
     * 'deferred' — in both cases the command must not run yet — so existing callers
     * that only check `allowed` keep working unchanged. New callers (engine/CLI/TUI)
     * read `status`/`approvalId` to distinguish "denied" from "awaiting a human".
     */
    status?: 'allowed' | 'denied' | 'deferred';
    approvalId?: string;
}

/** Context needed to defer a dangerous command to a human instead of auto-denying it. */
export interface DeferContext {
    approvals: ApprovalStore;
    workspace: string;
    task: string;
}

function matchesAny(command: string, patterns: string[]): string | undefined {
    const lowered = command.toLowerCase();
    return patterns.find((p) => p && lowered.includes(p.toLowerCase()));
}

/**
 * The approval gate. Decides whether a shell command may run, given a policy:
 *   1. explicit deny-list  → denied (always wins)
 *   2. explicit allow-list → allowed (overrides dangerous classification)
 *   3. dangerous + mode 'allow' → allowed
 *   4. dangerous + mode 'defer' → looks up (or creates) a `PendingApproval`; allowed
 *      only if a human already resolved it with 'approve'
 *   5. dangerous + mode 'deny' (or 'defer' without a `DeferContext`) → denied
 *   6. otherwise → allowed
 *
 * Fail-safe: when in doubt about a dangerous command, deny.
 */
export function decideCommand(command: string, policy: Policy, defer?: DeferContext): Decision {
    const denyHit = matchesAny(command, policy.deny);
    if (denyHit) {
        return { allowed: false, status: 'denied', reason: `denegado por la denylist de la política ("${denyHit}")` };
    }

    const allowHit = matchesAny(command, policy.allow);
    if (allowHit) {
        return {
            allowed: true,
            status: 'allowed',
            reason: `permitido por la allowlist de la política ("${allowHit}")`
        };
    }

    const classification = classifyCommand(command);
    if (classification.risk === 'dangerous') {
        if (policy.mode === 'allow') {
            return {
                allowed: true,
                status: 'allowed',
                reason: `comando peligroso (${classification.matched}) permitido por mode='allow'`
            };
        }

        if (policy.mode === 'defer' && defer) {
            const existing = defer.approvals.findMatch(defer.task, command);
            if (existing?.status === 'approved') {
                return { allowed: true, status: 'allowed', reason: `aprobado por humano (id: ${existing.id})` };
            }
            if (existing && existing.status !== 'pending') {
                // 'denied' or 'modified': the human did not approve this exact command as-is.
                return {
                    allowed: false,
                    status: 'denied',
                    reason: `resuelto por humano: ${existing.status} (id: ${existing.id})`
                };
            }
            const entry = defer.approvals.request({
                workspace: defer.workspace,
                task: defer.task,
                command,
                reason: `comando peligroso (${classification.matched})`,
                risk: classification.risk
            });
            return {
                allowed: false,
                status: 'deferred',
                approvalId: entry.id,
                reason: `comando peligroso (${classification.matched}) diferido para aprobación humana (id: ${entry.id})`
            };
        }

        return {
            allowed: false,
            status: 'denied',
            reason: `comando peligroso (${classification.matched}) requiere aprobación humana; bloqueado en modo autónomo (mode='${policy.mode}')`
        };
    }

    return { allowed: true, status: 'allowed', reason: 'comando seguro' };
}

/** Extracts the hostname from a URL, or null if it isn't a valid http(s) URL. */
export function urlDomain(url: string): string | null {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return u.hostname.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * The egress gate for browser fetches. A URL is allowed only if its domain matches the
 * policy's `browserAllowDomains` (suffix match, so `example.com` covers `www.example.com`).
 * Empty allowlist → deny all (fail-safe: no silent network egress).
 */
export function decideUrl(url: string, policy: Policy): Decision {
    const domain = urlDomain(url);
    if (!domain) {
        return { allowed: false, reason: 'URL inválida o esquema no http(s)' };
    }
    const allowed = policy.browserAllowDomains.some(
        (d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`)
    );
    return allowed
        ? { allowed: true, reason: `dominio ${domain} permitido` }
        : { allowed: false, reason: `dominio ${domain} no está en browserAllowDomains (egress denegado)` };
}
