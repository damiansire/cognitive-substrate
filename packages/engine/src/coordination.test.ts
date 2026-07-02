import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ClaimStore,
    handleCoordinationRequest,
    LocalClaimBackend,
    HttpClaimBackend,
    createClaimBackend,
    type FetchLike
} from './coordination';

describe('ClaimStore (server-side locks)', () => {
    it('lets one worker hold a claim and expires it after TTL', () => {
        const store = new ClaimStore();
        expect(store.claim('ns', 'task', 'A', 1000, 0)).toBe(true);
        expect(store.claim('ns', 'task', 'B', 1000, 500)).toBe(false); // still held
        expect(store.claim('ns', 'task', 'B', 1000, 2000)).toBe(true); // A expired
    });
    it('namespaces tasks (same task, different namespace = independent)', () => {
        const store = new ClaimStore();
        expect(store.claim('ws1', 't', 'A', 1000, 0)).toBe(true);
        expect(store.claim('ws2', 't', 'B', 1000, 0)).toBe(true);
    });
    it('release frees the task', () => {
        const store = new ClaimStore();
        store.claim('ns', 't', 'A', 1000, 0);
        store.release('ns', 't', 'A');
        expect(store.isClaimed('ns', 't', 1)).toBe(false);
    });
});

describe('handleCoordinationRequest', () => {
    it('routes /claim, /status and /release', () => {
        const store = new ClaimStore();
        expect(
            handleCoordinationRequest(store, '/claim', { namespace: 'n', taskKey: 't', workerId: 'A', ttlMs: 1000 }, 0)
        ).toEqual({ status: 200, payload: { claimed: true } });
        expect(handleCoordinationRequest(store, '/status', { namespace: 'n', taskKey: 't' }, 1)).toEqual({
            status: 200,
            payload: { claimed: true }
        });
        handleCoordinationRequest(store, '/release', { namespace: 'n', taskKey: 't', workerId: 'A' }, 2);
        expect(handleCoordinationRequest(store, '/status', { namespace: 'n', taskKey: 't' }, 3)).toEqual({
            status: 200,
            payload: { claimed: false }
        });
    });
    it('rejects missing fields', () => {
        const store = new ClaimStore();
        expect(handleCoordinationRequest(store, '/claim', {}, 0).status).toBe(400);
    });
});

describe('LocalClaimBackend', () => {
    let ws: string;
    beforeEach(() => {
        ws = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-coord-'));
    });
    afterEach(() => {
        fs.rmSync(ws, { recursive: true, force: true });
    });
    it('delegates to filesystem locks', async () => {
        const a = new LocalClaimBackend(ws);
        expect(await a.claim('- [ ] T', 'A')).toBe(true);
        expect(await a.claim('- [ ] T', 'B')).toBe(false);
        await a.release('- [ ] T', 'A');
        expect(await a.claim('- [ ] T', 'B')).toBe(true);
    });
});

describe('HttpClaimBackend', () => {
    it('claims via the server and is fail-safe when unreachable', async () => {
        const store = new ClaimStore();
        // Fake fetch backed by the in-memory store (simulates the coordinator server).
        const okFetch: FetchLike = async (url, init) => {
            const pathname = new URL(url).pathname;
            const body = JSON.parse(init?.body ?? '{}');
            const { status, payload } = handleCoordinationRequest(store, pathname, body, 0);
            return { ok: status < 400, status, json: async () => payload };
        };
        const a = new HttpClaimBackend('http://coord.test', 'ws', okFetch);
        expect(await a.claim('t', 'A')).toBe(true);

        const b = new HttpClaimBackend('http://coord.test', 'ws', okFetch);
        expect(await b.claim('t', 'B')).toBe(false); // already claimed on the server

        // Server unreachable -> fail-safe: do NOT claim.
        const downFetch: FetchLike = async () => {
            throw new Error('ECONNREFUSED');
        };
        const c = new HttpClaimBackend('http://coord.test', 'ws', downFetch);
        expect(await c.claim('z', 'C')).toBe(false);
    });
});

describe('createClaimBackend (selection)', () => {
    it('returns local by default and http when configured', () => {
        expect(createClaimBackend('/ws', { mode: 'local' })).toBeInstanceOf(LocalClaimBackend);
        expect(createClaimBackend('/ws', { mode: 'http', endpoint: 'http://x' })).toBeInstanceOf(HttpClaimBackend);
        // http without endpoint falls back to local (fail-safe).
        expect(createClaimBackend('/ws', { mode: 'http' })).toBeInstanceOf(LocalClaimBackend);
    });
});
