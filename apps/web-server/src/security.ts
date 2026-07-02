/**
 * Security edge for the web backend, kept as pure functions so it is testable without
 * binding a port (same discipline as `router.ts`). The backend is a LOCAL, single-user
 * tool — the design here reflects that:
 *
 *  - Bind to loopback by default (`resolveHost`) so it is never reachable from the LAN.
 *  - No CORS `*`: only echo `Access-Control-Allow-Origin` for an explicit allowlist of
 *    dev origins (`resolveAllowedOrigins` / `corsHeaders`). Note the real app talks to
 *    the backend through Angular's dev proxy (`/api` → :4720), so it is same-origin and
 *    does not need CORS at all; the allowlist only covers a directly-served dev origin.
 *  - Optional local token on state-changing POSTs (`requireTokenAuth` / `isAuthorizedPost`):
 *    off by default (loopback binding already excludes remote callers), but a single env
 *    var turns it into a hard lock for shared-volume / multi-user deployments.
 */

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:4200', 'http://127.0.0.1:4200'];

type Env = Record<string, string | undefined>;

/** Interface the server binds to. Defaults to loopback; override with `WEB_SERVER_HOST`
 * (e.g. `0.0.0.0`) only when you deliberately want LAN exposure behind your own auth. */
export function resolveHost(env: Env = process.env): string {
    const raw = env['WEB_SERVER_HOST']?.trim();
    return raw && raw.length > 0 ? raw : DEFAULT_HOST;
}

/** Allowed CORS origins: `WEB_SERVER_ALLOWED_ORIGINS` (comma-separated) or the Angular
 * dev-server defaults. Never `*`. */
export function resolveAllowedOrigins(env: Env = process.env): string[] {
    const raw = env['WEB_SERVER_ALLOWED_ORIGINS'];
    if (!raw) return [...DEFAULT_ALLOWED_ORIGINS];
    return raw
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
}

/** CORS response headers for one request `Origin`. Only reflects the origin when it is on
 * the allowlist — otherwise no `Access-Control-Allow-Origin` is sent, so the browser
 * blocks a cross-origin read. `Vary: Origin` keeps caches from mixing responses. */
export function corsHeaders(origin: string | undefined, allowed: string[]): Record<string, string> {
    const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, x-csos-token',
        Vary: 'Origin'
    };
    if (origin && allowed.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

/** The local token, if configured. When set, state-changing POSTs must present it. */
export function requireTokenAuth(env: Env = process.env): string | null {
    const raw = env['WEB_SERVER_TOKEN']?.trim();
    return raw && raw.length > 0 ? raw : null;
}

/**
 * Whether a state-changing request is authorized. When no token is configured, auth is
 * disabled (loopback binding is the boundary) and everything passes. When a token is set,
 * the request must carry it in the `x-csos-token` header. Non-mutating methods (GET,
 * OPTIONS) are always allowed.
 */
export function isAuthorizedPost(
    method: string,
    header: string | string[] | undefined,
    token: string | null
): boolean {
    if (method !== 'POST') return true;
    if (!token) return true;
    const presented = Array.isArray(header) ? header[0] : header;
    return presented === token;
}
