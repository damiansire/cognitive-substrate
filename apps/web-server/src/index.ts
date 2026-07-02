#!/usr/bin/env node
import * as http from 'http';
import { handleApiRequest } from './router';
import { watchWorkspace } from './events';
import { resolveWorkspaces } from '@cognitive-substrate/engine';

/**
 * Small REST backend exposing the same read-model the CLI and TUI already use
 * (`@cognitive-substrate/engine`'s readModel.ts) to a browser. Reads are plain
 * request/response JSON via `handleApiRequest`; `GET .../events` is the one exception —
 * an SSE stream (see below) that tells the frontend to refetch as soon as something on
 * disk changes, instead of waiting for its next poll tick.
 *
 * Points at ONE root directory (like the CLI/TUI): `CSOS_ROOT` env var, defaulting to
 * the directory the process was started in.
 */

const PORT = Number(process.env['WEB_SERVER_PORT'] ?? 4720);
const ROOT_DIR = process.env['CSOS_ROOT'] ?? process.cwd();

/** Every open SSE connection, so `SIGINT` can close them for a clean process exit. */
const sseClients = new Set<http.ServerResponse>();
const HEARTBEAT_MS = 20_000;

/**
 * `GET /api/workspaces/:project/events` — deliberately NOT routed through
 * `handleApiRequest`: that function is a pure single request -> single response mapping
 * (testable without binding a port), while this is a long-lived stream. Returns true if
 * it handled the request (caller should not also delegate to the JSON router).
 */
function tryHandleEvents(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
    const segments = pathname.split('/').filter(Boolean);
    if (req.method !== 'GET' || segments.length !== 4 || segments[0] !== 'api' || segments[1] !== 'workspaces') {
        return false;
    }
    if (segments[3] !== 'events') return false;

    const project = segments[2];
    const ws = resolveWorkspaces(ROOT_DIR).find((w) => w.project === project);
    if (!ws) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `workspace '${project ?? ''}' no encontrado` }));
        return true;
    }

    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
    });
    res.write('retry: 2000\n\n');
    sseClients.add(res);

    const stopWatching = watchWorkspace(ws.path, () => res.write('data: change\n\n'));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    req.on('close', () => {
        clearInterval(heartbeat);
        stopWatching();
        sseClients.delete(res);
    });
    return true;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
            if (data.length > 1_000_000) req.destroy(); // basic guard
        });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : undefined);
            } catch {
                resolve(undefined);
            }
        });
        req.on('error', () => resolve(undefined));
    });
}

const server = http.createServer(async (req, res) => {
    // CORS: only the local dev servers of apps/web need this; this is not a
    // public-facing service.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (tryHandleEvents(req, res, url.pathname)) return;

    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const { status, payload } = await handleApiRequest(
        ROOT_DIR,
        req.method ?? 'GET',
        url.pathname,
        url.searchParams,
        body
    );

    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
});

server.listen(PORT, () => {
    console.log(`>>> [web-server] Escuchando en http://localhost:${PORT} (CSOS_ROOT=${ROOT_DIR})`);
});

process.on('SIGINT', () => {
    console.log('\n>>> [web-server] Apagando...');
    for (const client of sseClients) client.end();
    server.close(() => process.exit(0));
});
