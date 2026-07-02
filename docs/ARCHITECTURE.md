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
  cli/                Wizard/mode-detection/--daemon loop, plus real subcommands
                      (status/inbox/board/session/approve/ask) in commands.ts.
  tui/                Ink-based terminal UI: Home/Inbox/Board/Session views over the
                      same engine read-model, with interactive approval actions.
  web-server/         REST backend (plain http.createServer) wrapping the same
                      read-model + approvalActions for the browser UI, plus a
                      `GET .../events` SSE stream (`events.ts`, `fs.watch`-based) that
                      pushes on real file changes — the one deliberate exception to
                      "every route is a pure request→response function" (see the
                      comment in `index.ts`). The TUI still polls the filesystem
                      directly (same process/machine as the files, push wouldn't help).
  web/                Angular (standalone + signals) browser dashboard, 10 routes:
                      Home/Inbox/Board/Session (core), Project/Departments/Portfolio
                      (KPIs derived from runs/incidents/approvals — never invented,
                      see `engine/kpis.ts`), Artifacts/Environment/Learning
                      (introspection — each says explicitly what it can't show, e.g.
                      no code diffs, no CPU/memory), plus a topbar ask bar
                      (`features/ask-bar`) wired to `engine/askRouter.ts`. `PollingClock`
                      opens an `EventSource` to `web-server`'s SSE endpoint for the
                      active project, with the 3s poll kept as a floor (no project
                      selected yet, SSE down, proxies that don't support
                      `text/event-stream`). Has its own build/typecheck (`ng build`/
                      `ng test`) — not part of the root `tsc --build` composite graph,
                      and not yet wired into `.github/workflows/ci.yml` (known gap, not
                      silent: root lint/format DO cover its `.ts` files, but there's no
                      dedicated CI step running `ng build`/`ng test` yet).
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
  (destructive fs ops, privilege escalation, network egress, push/publish) are, depending
  on `governance.json`'s `mode`, **denied by default** (`'deny'`, autonomous mode),
  **allowed** (`'allow'`, explicit opt-in), or **deferred to a human** (`'defer'`) —
  queued as a `PendingApproval` (`governance/approvals.ts`) that the CLI (`approve`) or
  TUI (Inbox view) can approve/deny/modify, once or as a standing allow/deny rule. Every
  invocation is written to an append-only `audit.log` regardless of mode. This is real
  policy + auditing, but a native shell could still, in principle, reach outside the
  workspace — so it is **not** VM-level isolation. Container isolation remains roadmap.
  **Still: don't run untrusted prompts on a machine you care about.**

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
| Human-in-the-loop approval queue (`mode: 'defer'`) | ✅ implemented | `governance/approvals.ts`, `engine/tasks.ts: markTaskAwaitingApproval` |
| Stable task identity + evidence-per-task drill-down | ✅ implemented | `engine/tasks.ts: (task-id:...)`, `evidence.ts: buildTaskEvidenceIndex` |
| Ask bar with real NLU (12 verbs, Gemini + heuristic fallback), shared CLI/web/TUI | ✅ implemented | `engine/ask.ts`, `askRouter.ts` |
| CLI real subcommands (status/inbox/board/session/approve/ask) | ✅ implemented | `apps/cli/src/commands.ts` |
| TUI (Home/Inbox/Board/Session/Ask, altitude nav incl. per-task drill-down, approval actions) | ✅ implemented (filesystem polling, no push — same process/machine as the files, push wouldn't help) | `apps/tui` |
| Web REST backend over the same read-model | ✅ implemented | `apps/web-server` |
| Live push (SSE on real file changes, 3s poll kept as floor) | ✅ implemented | `apps/web-server/events.ts`, `apps/web/.../polling-clock.ts` |
| Web UI — core (Home/Inbox/Board/Session, approve/deny/modify, per-task drill-down) | ✅ implemented (no CI step yet) | `apps/web` |
| Web UI — KPIs/rollups (Project/Departments/Portfolio), derived only from real runs/incidents/approvals | ✅ implemented (no CI step yet) | `engine/kpis.ts`, `apps/web/.../{project,departments,portfolio}` |
| Web UI — introspection (Artifacts/Environment/Learning), honest empty-states for what isn't derivable | ✅ implemented (no CI step yet) | `apps/web/.../{artifacts,environment,learning}` |
| Observability (incidents + audit trail) | ✅ implemented | `engine/incidents.ts`, `governance/audit.ts` |
| Recurring tasks (cadence in engine ticks, not calendar dates) | ✅ implemented | `engine/recurring.ts` |
| Multi-worker pull-based claiming | ✅ implemented | `engine/claims.ts` |
| Multi-MACHINE coordination (configurable) | ✅ local fs / http server | `engine/coordination.ts`, `apps/coordinator` |
| Strong sandbox (container exec) | 🟡 optional (needs Docker) | `sandbox-container` |
| Browser domain (read + JS render) | 🟡 render via optional Playwright | `sandbox-browser` |
| Interactive browser (navigate/click/type/screenshot) | ✅ wired (needs Playwright at runtime) | `sandbox-browser/session.ts` + agent loop |
| Desktop automation (GUI control) | ❌ not yet | roadmap |
| Business domain objects (contracts/leads/billing/budget-in-$/headcount/risk register) | ❌ not yet — no entity anywhere, shown as explicit empty states, never mocked | roadmap (charter Part 8) |
| CI (build+lint+format+test gate on push/PR) | ✅ implemented | `.github/workflows/ci.yml` |
| Linter / formatter | ✅ implemented | `eslint.config.mjs`, `.prettierrc.json` |

## Implementation contract

- State is **transparent files**, never hidden context. Anything the OS "knows" is on
  disk and human-editable.
- **No completion without verification + evidence.**
- Tools are **sandboxed to the workspace** (filesystem invariant is tested).
- The system must **degrade gracefully** (simulation mode) and be **bounded**
  (iteration caps, timeouts, max ticks).
- Portable: no dependency on a single proprietary runtime quirk; model access is
  isolated behind `gemini-agent-loop`.
