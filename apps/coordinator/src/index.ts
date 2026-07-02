#!/usr/bin/env node
import * as http from 'http';
import { ClaimStore, handleCoordinationRequest } from '@cognitive-substrate/engine';

/**
 * Coordination server for MULTI-MACHINE task claiming.
 *
 * Run this once on a host all workers can reach, then point each worker's
 * `governance.json` at it:
 *   { "coordination": { "mode": "http", "endpoint": "http://<host>:4710" } }
 *
 * Workers on different machines then claim the same tasks safely. If this server is
 * down, workers fail safe (they pause rather than double-execute). Locks are in-memory
 * with a TTL, so a crashed worker's claim auto-expires.
 */

const PORT = Number(process.env['COORDINATOR_PORT'] ?? 4710);
const store = new ClaimStore();

function readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
            if (data.length > 1_000_000) req.destroy(); // basic guard
        });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch {
                resolve({});
            }
        });
        req.on('error', () => resolve({}));
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'usar POST' }));
        return;
    }
    const body = await readBody(req);
    const { status, payload } = handleCoordinationRequest(store, req.url ?? '', body, Date.now());
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
});

server.listen(PORT, () => {
    console.log(`>>> [Coordinator] Servidor de claiming multi-máquina escuchando en http://0.0.0.0:${PORT}`);
    console.log(
        `>>> Apuntá los workers con governance.json: { "coordination": { "mode": "http", "endpoint": "http://<host>:${PORT}" } }`
    );
});

process.on('SIGINT', () => {
    console.log('\n>>> [Coordinator] Apagando...');
    server.close(() => process.exit(0));
});
