import { describe, it, expect } from 'vitest';
import { runJs, wasmTools, DEFAULT_TIMEOUT_MS } from './index';

// These tests exercise the REAL quickjs-emscripten WASM runtime (no mocks) — Docker
// is not available in this environment, so this is the one execution surface where
// we can verify genuine OS/runtime-level isolation end to end on this machine.

describe('runJs (real WASM execution)', () => {
    it('evaluates a simple expression and returns the real result', async () => {
        const { ok, output } = await runJs('1 + 2 * 3');
        expect(ok).toBe(true);
        expect(output).toBe('7');
    });

    it('captures console.log output from the guest', async () => {
        const { ok, output } = await runJs("console.log('hola'); 42");
        expect(ok).toBe(true);
        expect(output).toContain('hola');
        expect(output).toContain('42');
    });

    it('surfaces a thrown guest error without crashing the host', async () => {
        const { ok, output } = await runJs("throw new Error('boom')");
        expect(ok).toBe(false);
        expect(output).toContain('boom');
    });

    it('has NO access to Node ambient globals (require/process/fs) — real isolation, not a policy', async () => {
        const { ok, output } = await runJs('typeof require');
        expect(ok).toBe(true);
        expect(output).toBe('undefined');

        const proc = await runJs('typeof process');
        expect(proc.output).toBe('undefined');

        const fsAccess = await runJs(
            'typeof require === "function" ? require("fs").readFileSync("/etc/passwd") : "no-fs"'
        );
        expect(fsAccess.output).toBe('no-fs');
    });

    it('cannot reach the host filesystem or network at all — no bridged capability exists', async () => {
        const { output } = await runJs('typeof fetch === "undefined" && typeof XMLHttpRequest === "undefined"');
        expect(output).toBe('true');
    });

    it('aborts a real infinite loop via the interrupt handler within the timeout, instead of hanging', async () => {
        const start = Date.now();
        const { ok, output } = await runJs('while (true) {}', { timeoutMs: 300 });
        const elapsed = Date.now() - start;
        expect(ok).toBe(false);
        expect(output).toContain('límite de tiempo');
        // Bounded well under the default timeout — proves the loop was actually killed,
        // not that the whole call happened to finish fast.
        expect(elapsed).toBeLessThan(DEFAULT_TIMEOUT_MS);
    }, 10_000);

    it('stops unbounded memory growth via the real WASM heap limit instead of exhausting host memory', async () => {
        const { ok, output } = await runJs(
            `
            var chunks = [];
            var block = new Array(1000).join('x'); // ~1KB, built once
            for (var i = 0; i < 1000000; i++) {
                chunks.push(block + i);
            }
            'never reached'
            `,
            { memoryLimitBytes: 2 * 1024 * 1024, timeoutMs: 2_000 }
        );
        expect(ok).toBe(false);
        expect(output).not.toContain('never reached');
    }, 10_000);

    it('one guest crashing (OOM/interrupt) does not corrupt a subsequent, independent run', async () => {
        await runJs('while (true) {}', { timeoutMs: 200 });
        const { ok, output } = await runJs('2 + 2');
        expect(ok).toBe(true);
        expect(output).toBe('4');
    }, 10_000);
});

describe('wasmTools.runJs (tool-shaped entrypoint)', () => {
    it('rejects empty code without touching the WASM runtime', async () => {
        const out = await wasmTools.runJs({ code: '' });
        expect(out).toContain('vacío');
    });

    it('returns the stringified real result for a normal snippet', async () => {
        const out = await wasmTools.runJs({ code: "'hello-' + (2+2)" });
        expect(out).toBe('hello-4');
    });
});
