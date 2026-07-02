import { Component, computed, inject, signal } from '@angular/core';
import { WorkspacesApi } from '../../api/workspaces-api';
import { WorkspaceSelection } from '../../core/workspace-selection';
import type { AskMode, AskResponse } from '../../api/models';

/** `AskMode` is an internal `snake_case` enum (see `packages/engine/src/ask.ts`) — never
 * shown raw, a design-review caught it reading like debug output. */
const MODE_LABELS: Record<AskMode, string> = {
  respuesta: 'Respuesta',
  borrador: 'Borrador',
  plan: 'Plan',
  ejecucion_unica: 'Tarea única',
  objetivo_largo_plazo: 'Objetivo',
  automatizacion_recurrente: 'Se repite',
  reporte: 'Reporte',
};

/**
 * The ask bar: free-form text in, an inferred verb/mode + result message out. Delegates
 * classification to `POST .../ask` (`@cognitive-substrate/engine`'s `handleAsk`) — the
 * same function the CLI's `ask` subcommand and the TUI's ask view call, so the
 * interpretation is never reimplemented here. Mounted once in the topbar (`app.ts`), so
 * it's reachable from every route.
 */
@Component({
  selector: 'csos-ask-bar',
  template: `
    <form class="ask-bar" (submit)="onSubmit($event)">
      <input
        class="ask-input mono"
        type="text"
        [value]="text()"
        (input)="onInput($event)"
        [placeholder]="project() ? 'Pedile algo al OS…' : 'Elegí un workspace desde Home primero'"
        [disabled]="!project() || submitting()"
      />
      <button
        type="submit"
        class="ask-submit"
        [disabled]="!project() || !text().trim() || submitting()"
      >
        {{ submitting() ? '…' : 'Enviar' }}
      </button>
    </form>

    @if (result(); as r) {
      <p class="ask-result">
        <span class="ask-tag">{{ modeLabel(r.interpretation.mode) }}</span>
        {{ r.message }}
      </p>
    }
    @if (error()) {
      <p class="ask-result ask-error">No se pudo interpretar el pedido — intentá de nuevo.</p>
    }
  `,
  styleUrl: './ask-bar.css',
})
export class AskBar {
  private readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);

  protected readonly project = computed(
    () => this.selection.selected() ?? this.api.workspaces.value()?.workspaces[0]?.project,
  );

  protected readonly text = signal('');
  protected readonly submitting = signal(false);
  protected readonly result = signal<AskResponse | null>(null);
  protected readonly error = signal(false);

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
  }

  protected modeLabel(mode: AskMode): string {
    return MODE_LABELS[mode];
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const project = this.project();
    const text = this.text().trim();
    if (!project || !text) return;

    this.submitting.set(true);
    this.error.set(false);
    this.api.ask(project, text).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.result.set(res);
        this.text.set('');
      },
      error: () => {
        this.submitting.set(false);
        this.error.set(true);
      },
    });
  }
}
