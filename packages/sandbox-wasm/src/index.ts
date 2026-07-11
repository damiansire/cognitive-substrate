import { getQuickJS, type QuickJSContext } from 'quickjs-emscripten';

/**
 * WASM execution adapter: runs untrusted JavaScript inside a QuickJS interpreter
 * compiled to WebAssembly (quickjs-emscripten).
 *
 * This is a REAL isolation primitive — not manual TypeScript validation — for one
 * concrete, bounded use case: evaluating a JS snippet. The guest code executes in a
 * separate WASM linear memory with its own interpreter loop; it has NO access to
 * Node's `require`, `process`, `fs`, `fetch`, globals, or the host event loop unless a
 * function is explicitly bridged in via `newFunction`/`setProp` (this adapter bridges
 * none). CPU time is bounded by an interrupt handler evaluated on every VM opcode
 * batch, and heap growth is bounded by `setMemoryLimit` — both enforced by the
 * runtime itself, not by application logic that could have a bug.
 *
 * Unlike `sandbox-container` (which isolates arbitrary SHELL commands via Docker and
 * fails safe when Docker is absent), this adapter only covers JS *expression/snippet*
 * execution. It does not run shell commands, read files, or open sockets — those
 * capabilities simply do not exist inside the guest, by construction. It is offered
 * as an additional execution surface (`runJs`), not a replacement for `runCommand`.
 */

export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024; // 32 MiB
const MAX_OUTPUT_LENGTH = 64 * 1024;

export interface WasmJsOptions {
    timeoutMs?: number;
    memoryLimitBytes?: number;
}

export interface WasmJsResult {
    ok: boolean;
    output: string;
}

function truncate(value: string): string {
    return value.length > MAX_OUTPUT_LENGTH ? value.slice(0, MAX_OUTPUT_LENGTH) + '\n[...truncado]' : value;
}

/** Wires a minimal `console.log`/`console.error` into the guest that only stringifies
 * arguments and appends to an in-host buffer — no other host capability is exposed. */
function bridgeConsole(vm: QuickJSContext, sink: string[]): void {
    const consoleHandle = vm.newObject();
    for (const level of ['log', 'error', 'warn', 'info']) {
        const fn = vm.newFunction(level, (...args) => {
            const rendered = args.map((a) => {
                try {
                    return vm.dump(a);
                } catch {
                    return String(a);
                }
            });
            sink.push(rendered.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join(' '));
        });
        vm.setProp(consoleHandle, level, fn);
        fn.dispose();
    }
    vm.setProp(vm.global, 'console', consoleHandle);
    consoleHandle.dispose();
}

/**
 * Evaluates `code` inside an isolated QuickJS-WASM runtime and returns the
 * stringified result (or thrown error), plus any console output.
 *
 * Every call gets its own fresh runtime/context (not the shared singleton module's
 * default runtime) so that one guest's interrupt/memory state can never leak into or
 * be confused with another's, and so disposal is unambiguous.
 */
export async function runJs(code: string, opts: WasmJsOptions = {}): Promise<WasmJsResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const memoryLimitBytes = opts.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES;

    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    const deadline = Date.now() + timeoutMs;
    let interrupted = false;
    runtime.setInterruptHandler(() => {
        if (Date.now() > deadline) {
            interrupted = true;
            return true;
        }
        return false;
    });
    runtime.setMemoryLimit(memoryLimitBytes);
    // Bound the native call stack too (guards deep-recursion abuse independent of the
    // opcode-count-based interrupt handler above).
    runtime.setMaxStackSize(1024 * 1024);

    const vm = runtime.newContext();
    const consoleOutput: string[] = [];
    try {
        bridgeConsole(vm, consoleOutput);

        const result = vm.evalCode(code);
        let text: string;
        let ok: boolean;
        if (result.error) {
            ok = false;
            const errDump = vm.dump(result.error);
            result.error.dispose();
            text = interrupted
                ? 'Error: ejecución abortada por límite de tiempo/CPU (interrupt handler).'
                : `Error: ${typeof errDump === 'string' ? errDump : JSON.stringify(errDump)}`;
        } else {
            ok = true;
            const dumped = vm.dump(result.value);
            result.value.dispose();
            text = typeof dumped === 'string' ? dumped : JSON.stringify(dumped);
        }
        const combined = [...consoleOutput, text].filter((s) => s !== undefined && s !== '').join('\n');
        return { ok, output: truncate(combined || (ok ? 'undefined' : text)) };
    } catch (e: any) {
        // setMemoryLimit / setMaxStackSize violations surface as thrown WASM errors,
        // not as an evalCode error result — catch them here so callers always get a
        // structured result instead of an unhandled rejection.
        return {
            ok: false,
            output: `Error: límite de memoria/stack excedido en el sandbox WASM (${e?.message ?? e}).`
        };
    } finally {
        vm.dispose();
        runtime.dispose();
    }
}

export const wasmTools = {
    /** Tool-shaped entrypoint matching the other sandbox packages' `runCommand`
     * convention, for wiring into the agent loop's tool dispatcher. */
    async runJs(args: { code: string }, opts: WasmJsOptions = {}): Promise<string> {
        const code = args?.code ?? '';
        if (!code.trim()) return 'Error: código vacío.';
        const { output } = await runJs(code, opts);
        return output;
    }
};
