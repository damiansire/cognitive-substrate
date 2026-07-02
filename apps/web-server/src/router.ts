import * as path from 'path';
import {
    resolveWorkspaces,
    getHomeSummary,
    getInboxItems,
    getBoardWithEvidence,
    getSessionTrace,
    getLatestRunPath,
    getWorkspaceKpis,
    getDepartmentSummaries,
    getPortfolioComparison,
    listArtifacts,
    getEnvironmentSnapshot,
    getLearningSnapshot,
    resolveApprovalAction,
    handleAsk
} from '@cognitive-substrate/engine';
import type { ResolveInput } from '@cognitive-substrate/governance';

/**
 * Pure request router for the web backend — same pattern as
 * `engine/coordination.ts: handleCoordinationRequest`, testable without binding a port.
 * Every read goes through the SAME `readModel.ts` the CLI and TUI already use; there is
 * no separate parsing of tasks.md/approvals.json/incidents.jsonl here.
 */

export interface ApiResponse {
    status: number;
    payload: unknown;
}

const VALID_ACTIONS = new Set(['approve', 'deny', 'modify']);
const VALID_SCOPES = new Set(['once', 'always']);

function isResolveInput(body: unknown): body is ResolveInput {
    if (!body || typeof body !== 'object') return false;
    const b = body as Record<string, unknown>;
    return VALID_ACTIONS.has(b['action'] as string) && VALID_SCOPES.has(b['scope'] as string);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** `?days=` on any KPI-bearing route: a positive integer, defaulting to 7. Never lets a
 * malformed/negative value reach `computeWorkspaceKpis` and produce a bogus window. */
function parsePeriodDays(query: URLSearchParams): number {
    const raw = query.get('days');
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

/**
 * Handles one API request. `pathname` is already URL-decoded and has no query string;
 * `query` carries the parsed query params; `body` is the already-JSON-parsed request
 * body (or `undefined` for GET). Returns an HTTP status + JSON-serializable payload.
 * Async since `POST .../ask` classifies through `handleAsk` (real LLM call when an API
 * key is configured) — every other route stays synchronous under the hood.
 */
export async function handleApiRequest(
    rootDir: string,
    method: string,
    pathname: string,
    query: URLSearchParams,
    body: unknown
): Promise<ApiResponse> {
    const segments = pathname.split('/').filter(Boolean);

    if (segments[0] === 'api' && segments.length === 2 && segments[1] === 'departments') {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        return {
            status: 200,
            payload: { departments: getDepartmentSummaries(rootDir, parsePeriodDays(query)) }
        };
    }

    if (segments[0] === 'api' && segments.length === 2 && segments[1] === 'portfolio') {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        return {
            status: 200,
            payload: { portfolio: getPortfolioComparison(rootDir, parsePeriodDays(query)) }
        };
    }

    if (segments[0] !== 'api' || segments[1] !== 'workspaces') {
        return { status: 404, payload: { error: 'ruta desconocida' } };
    }

    if (segments.length === 2) {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        const workspaces = resolveWorkspaces(rootDir).map((ws) => ({
            project: ws.project,
            home: getHomeSummary(ws.path, ws.project)
        }));
        return { status: 200, payload: { workspaces } };
    }

    const project = segments[2];
    const ws = resolveWorkspaces(rootDir).find((w) => w.project === project);
    if (!ws) {
        return { status: 404, payload: { error: `workspace '${project ?? ''}' no encontrado` } };
    }

    if (segments.length === 4 && segments[3] === 'inbox') {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        return { status: 200, payload: { items: getInboxItems(ws.path, ws.project) } };
    }

    if (segments.length === 4 && segments[3] === 'board') {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        return { status: 200, payload: { board: getBoardWithEvidence(ws.path) } };
    }

    if (segments.length === 4 && segments[3] === 'sessions') {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        const requested = query.get('path');
        const evidencePath = !requested || requested === 'latest' ? getLatestRunPath(ws.path) : requested;
        if (!evidencePath) {
            return { status: 404, payload: { error: 'no hay sesiones registradas todavía' } };
        }
        return { status: 200, payload: getSessionTrace(ws.path, evidencePath) };
    }

    if (segments.length === 4 && segments[3] === 'kpis') {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        return { status: 200, payload: { kpis: getWorkspaceKpis(ws.path, parsePeriodDays(query)) } };
    }

    if (segments.length === 4 && segments[3] === 'artifacts') {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        return { status: 200, payload: { artifacts: listArtifacts(ws.path) } };
    }

    if (segments.length === 4 && segments[3] === 'environment') {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        return { status: 200, payload: getEnvironmentSnapshot(ws.path) };
    }

    if (segments.length === 4 && segments[3] === 'learning') {
        if (method !== 'GET') return { status: 405, payload: { error: 'método no soportado' } };
        const evalsReportDir = process.env['CSOS_EVALS_REPORT_DIR'] ?? path.join(rootDir, 'evals-report');
        return { status: 200, payload: getLearningSnapshot(ws.path, evalsReportDir) };
    }

    if (segments.length === 4 && segments[3] === 'ask') {
        if (method !== 'POST') return { status: 405, payload: { error: 'método no soportado' } };
        const text = (body as { text?: unknown } | undefined)?.text;
        if (!isNonEmptyString(text)) {
            return { status: 400, payload: { error: "body inválido: se requiere 'text' no vacío" } };
        }
        const outcome = await handleAsk(ws.path, text);
        return { status: 200, payload: outcome };
    }

    if (segments.length === 6 && segments[3] === 'approvals' && segments[5] === 'resolve') {
        if (method !== 'POST') return { status: 405, payload: { error: 'método no soportado' } };
        const approvalId = segments[4];
        if (!approvalId) return { status: 400, payload: { error: 'falta el id de la aprobación' } };
        if (!isResolveInput(body)) {
            return { status: 400, payload: { error: "body inválido: se requiere 'action' y 'scope' válidos" } };
        }
        const resolved = resolveApprovalAction(ws.path, approvalId, body);
        if (!resolved) {
            return { status: 404, payload: { error: `aprobación '${approvalId}' no encontrada` } };
        }
        return { status: 200, payload: { approval: resolved } };
    }

    return { status: 404, payload: { error: 'ruta desconocida' } };
}
