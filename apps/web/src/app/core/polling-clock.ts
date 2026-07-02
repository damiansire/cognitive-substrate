import { Injectable, signal, effect } from '@angular/core';

/**
 * Shared "tick" every `httpResource` in the app reads to know when to refetch.
 *
 * Backed by an SSE connection (`GET /api/workspaces/:project/events`, see
 * `apps/web-server/src/events.ts`) to the currently active project — the server pushes
 * as soon as `tasks.md`/`approvals.json`/`incidents.jsonl`/`runs/` change on disk, so
 * most of the time the UI updates faster than the 3s floor below.
 *
 * The `setInterval(3000)` is NOT removed: it's the fallback for when there's no active
 * project yet, when the SSE connection is down, or for proxies/environments that don't
 * support `text/event-stream` — the UI must never depend on push alone. The TUI is
 * unaffected by any of this: it polls the filesystem directly, in the same
 * process/machine as the files it reads, which push doesn't improve.
 */
@Injectable({ providedIn: 'root' })
export class PollingClock {
  readonly tick = signal(0);
  private readonly activeProject = signal<string | undefined>(undefined);
  private eventSource: EventSource | null = null;

  constructor() {
    setInterval(() => this.tick.update((value) => value + 1), 3000);
    effect(() => this.reconnect(this.activeProject()));
  }

  /** Called once, application-wide (see `apps/web/src/app/app.ts`), whenever the
   * effective project (explicit selection, or the fallback-to-first-workspace every
   * feature view already computes) changes. */
  setActiveProject(project: string | undefined): void {
    this.activeProject.set(project);
  }

  private reconnect(project: string | undefined): void {
    this.eventSource?.close();
    this.eventSource = null;
    if (!project) return;

    const source = new EventSource(`/api/workspaces/${encodeURIComponent(project)}/events`);
    source.onmessage = () => this.tick.update((value) => value + 1);
    // No explicit onerror handling: EventSource auto-reconnects on its own, and the
    // 3s poll above keeps the UI fresh regardless while it does.
    this.eventSource = source;
  }
}
