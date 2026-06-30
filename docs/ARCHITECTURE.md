# Architecture — what actually exists today

This document describes the system **as implemented**, not the aspiration. The
aspiration lives in [`vision/`](./vision/README.md) (the charter, split into readable
parts). When the two disagree, this file wins for describing reality. For an honest read
on where the project stands and what's pending, see
[`ESTADO-Y-PENDIENTES.md`](./ESTADO-Y-PENDIENTES.md).

## One-paragraph summary

Cognitive Substrate OS is a small, local, **filesystem-first agentic task runner**.
A workspace is just a directory holding plain-markdown state (`goal.md`, `tasks.md`,
`knowledge.md`). The engine takes a goal, decomposes it into tasks, delegates each
task to a Gemini-powered agent loop that can read/write files and run shell commands
**inside a sandboxed workspace**, then **verifies the result and records evidence to
disk** before marking anything done. Multiple workspaces are processed concurrently.

## Monorepo layout (npm workspaces)

```
packages/
  sandbox-fs/         File tools confined to a workspace (path-containment invariant).
  sandbox-terminal/   Async shell execution with a hard wall-time timeout.
  skills-parser/      Discovers/reads SKILL.md files from known skill roots only.
  gemini-agent-loop/  The tool-calling loop against @google/genai + a JSON client.
  engine/             The OS kernel: the end-to-end milestone loop (see below).
apps/
  cli/                Thin entrypoint: wizard, mode detection, --daemon loop.
docs/                 vision/ (charter, split into parts) + this file.
```

Dependency direction is one-way: `apps/cli → engine → {gemini-agent-loop, sandbox-*}`.
Domain logic (queues, verification, evidence) lives in `engine`, never in the app.

## The core loop (FIRST MILESTONE)

Implemented in `packages/engine`, one tick per workspace:

1. **Goal intake** (`orchestrator.intakeGoal`) — if `goal.md` exists and hasn't been
   decomposed, `decomposition.decomposeGoal` splits it into subtasks seeded into the
   `[now]` queue. Idempotent via a marker appended to `goal.md`.
2. **Pick task** (`tasks.parseTasks`) — the next unchecked `[now]` item.
3. **Execute** (`gemini-agent-loop.executeTaskWithLLM`) — a bounded tool-calling loop
   (max 15 steps, exponential backoff on 429/503). Tool results are returned to the
   model as proper `functionResponse` parts.
4. **Verify** (`verification.verifyTask`) — deterministic checks (execution succeeded,
   log non-empty, any referenced files exist), **plus a behavioral check**
   (`verification.behavioralCheck`) that actually *runs* a command — an explicit
   `@verify: <command>` annotation on the task, or `npm test` when the workspace
   declares one — and requires exit code 0, **plus** a skeptical LLM verifier when a
   key is present. A task is verified only if all of these agree. Without a verify
   command resolved (no annotation, no `package.json` test script), this check is
   skipped entirely — file/log checks behave exactly as before.
5. **Record evidence** (`evidence.recordRun`) — writes `runs/<ts>-<slug>/run.json` and
   `summary.md`. **Nothing is marked `[x]` without an evidence record.**
6. **Learn** (`memory.distillLearning` + `appendLearning`) — one distilled lesson per
   run is appended to `knowledge.md` (archival memory).
7. **Update queues** — verified → `[x]`; failed → `[!]`, an `[improve]` follow-up is
   queued, and a `FAILURE.md` entry is written.
8. **Show human** (`dashboard.renderDashboard`) — `dashboard.md` reflects queues, last
   runs, and evidence paths.

`runOnce` runs step 1–8 for every workspace **concurrently**; `runDaemon` repeats it on
an interval with graceful `AbortSignal`/SIGINT shutdown.

## Security model (be precise about this)

- **Filesystem (`sandbox-fs`): enforced.** Every path is resolved and checked with
  `path.relative` containment (plus symlink resolution). Escapes (`..`, absolute paths,
  the classic `startsWith` prefix bypass) are denied. Covered by tests.
- **Skills (`skills-parser`): enforced.** `readSkill` only serves `SKILL.md` files
  inside known skill roots — it cannot read arbitrary absolute paths.
- **Terminal (`sandbox-terminal`): cwd-confined + governed, not VM-isolated.** `cwd` is
  set to the workspace with a hard timeout. Every command now passes through the
  **governance approval gate** (`packages/governance`): commands classified as dangerous
  (destructive fs ops, privilege escalation, network egress, push/publish) are **denied
  by default in autonomous mode** and every invocation is written to an append-only
  `audit.log`. This is real policy + auditing, but a native shell could still, in
  principle, reach outside the workspace — so it is **not** VM-level isolation.
  Container isolation remains roadmap. **Still: don't run untrusted prompts on a machine
  you care about.**

- **Bounded autonomy (`governance`): enforced.** Per-task budgets cap model round-trips
  and tool calls; a `governance.json` in the workspace can tune mode/allow/deny/budgets
  (fail-safe defaults if absent or malformed).

- **Strong sandbox (`sandbox-container`): optional, opt-in.** Set `"terminal":"container"`
  in `governance.json` to run shell commands inside a throwaway Docker container
  (workspace bind-mounted, `--network none` by default) — a real isolation boundary. If
  Docker is unavailable it **fails safe** (refuses to run) rather than dropping back to
  the host shell. This is the honest answer to the terminal's limitation above.

## Simulation mode

Without a `GEMINI_API_KEY`, LLM-backed steps degrade to deterministic fallbacks
(decomposition → the goal as one task; verification → deterministic checks only). This
keeps the whole loop runnable offline and is what the test suite exercises.

## Runtime capability matrix

| Capability | Status | Where |
| --- | --- | --- |
| Goal intake & decomposition | ✅ implemented | `engine/decomposition.ts` |
| Task queues (now/next/blocked/improve/recurring) | ✅ implemented | `engine/tasks.ts` |
| Tool-calling agent (fs + terminal) | ✅ implemented | `gemini-agent-loop` |
| Workspace filesystem sandbox | ✅ enforced | `sandbox-fs` |
| Verification + evidence on disk | ✅ implemented | `engine/verification.ts`, `evidence.ts` |
| Behavioral verification (runs `@verify:`/`npm test`, requires exit 0) | ✅ implemented | `engine/verification.ts: behavioralCheck` |
| Archival memory (knowledge.md) | ✅ implemented | `engine/memory.ts` |
| Concurrent multi-workspace daemon | ✅ implemented | `engine/orchestrator.ts`, `daemon.ts` |
| Dynamic skills (SKILL.md discovery) | ✅ implemented | `skills-parser` |
| Dashboard / human visibility | ✅ implemented | `engine/dashboard.ts` |
| Eval harness (capability/regression/adversarial) | ✅ implemented | `packages/evals` |
| Self-improvement loop | ✅ implemented | `engine/improve.ts`, orchestrator |
| Budgets / approval gate / audit | ✅ implemented | `packages/governance` |
| Observability (incidents + audit trail) | ✅ implemented | `engine/incidents.ts`, `governance/audit.ts` |
| Recurring tasks (cadence) | ✅ implemented | `engine/recurring.ts` |
| Multi-worker pull-based claiming | ✅ implemented | `engine/claims.ts` |
| Multi-MACHINE coordination (configurable) | ✅ local fs / http server | `engine/coordination.ts`, `apps/coordinator` |
| Strong sandbox (container exec) | 🟡 optional (needs Docker) | `sandbox-container` |
| Browser domain (read + JS render) | 🟡 render via optional Playwright | `sandbox-browser` |
| Interactive browser (navigate/click/type/screenshot) | ✅ wired (needs Playwright at runtime) | `sandbox-browser/session.ts` + agent loop |
| Desktop automation (GUI control) | ❌ not yet | roadmap |

## Implementation contract

- State is **transparent files**, never hidden context. Anything the OS "knows" is on
  disk and human-editable.
- **No completion without verification + evidence.**
- Tools are **sandboxed to the workspace** (filesystem invariant is tested).
- The system must **degrade gracefully** (simulation mode) and be **bounded**
  (iteration caps, timeouts, max ticks).
- Portable: no dependency on a single proprietary runtime quirk; model access is
  isolated behind `gemini-agent-loop`.
