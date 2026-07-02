import { Component, computed, inject, signal } from '@angular/core';
import { WorkspacesApi } from '../../api/workspaces-api';
import { WorkspaceSelection } from '../../core/workspace-selection';
import { parseTaskLine } from '../../shared/format';
import type { InboxItem, ResolveAction, ResolveScope } from '../../api/models';

@Component({
  selector: 'csos-inbox',
  template: `
    <h1>Inbox</h1>

    @if (!project()) {
      <p class="dim">No hay ningún workspace seleccionado — entrá desde Home.</p>
    } @else {
      <p class="subtitle mono">{{ project() }}</p>

      @if (message(); as text) {
        <p class="message">{{ text }}</p>
      }

      @if (inbox.isLoading() && !inbox.hasValue()) {
        <p class="dim">Cargando…</p>
      }

      @if (inbox.hasValue() && inbox.value().items.length === 0) {
        <p class="dim">Inbox vacío. Nada esperando tu atención.</p>
      }

      <ul class="list">
        @for (item of inbox.value()?.items ?? []; track $index) {
          <li class="item" [class]="severityClass(item)">
            @if (item.kind === 'approval') {
              <div class="row">
                <svg
                  class="icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <div class="body">
                  <p class="title mono">{{ item.approval.command }}</p>
                  <p class="detail">
                    {{ item.approval.reason }} · tarea: {{ parseTaskLine(item.approval.task).text }}
                  </p>

                  @if (modifyingId() === item.approval.id) {
                    <div class="actions">
                      <input
                        class="modify-input mono"
                        [value]="modifyText()"
                        (input)="onModifyInput($event)"
                        placeholder="Comando modificado…"
                      />
                      <button
                        type="button"
                        class="btn approve"
                        [disabled]="resolving() === item.approval.id || !modifyText().trim()"
                        (click)="confirmModify(item.approval.id)"
                      >
                        Confirmar
                      </button>
                      <button type="button" class="btn ghost" (click)="cancelModify()">
                        Cancelar
                      </button>
                    </div>
                  } @else {
                    <div class="actions">
                      <button
                        type="button"
                        class="btn approve"
                        [disabled]="resolving() === item.approval.id"
                        (click)="resolve(item.approval.id, 'approve', 'once')"
                      >
                        Aprobar
                      </button>
                      <button
                        type="button"
                        class="btn ghost approve-tint"
                        title="Permite este comando exacto siempre, en este workspace — agrega una regla a governance.json"
                        [disabled]="resolving() === item.approval.id"
                        (click)="resolve(item.approval.id, 'approve', 'always')"
                      >
                        Aprobar siempre
                      </button>
                      <button
                        type="button"
                        class="btn deny"
                        [disabled]="resolving() === item.approval.id"
                        (click)="resolve(item.approval.id, 'deny', 'once')"
                      >
                        Denegar
                      </button>
                      <button
                        type="button"
                        class="btn ghost deny-tint"
                        title="Deniega este comando exacto siempre, en este workspace — agrega una regla a governance.json"
                        [disabled]="resolving() === item.approval.id"
                        (click)="resolve(item.approval.id, 'deny', 'always')"
                      >
                        Denegar siempre
                      </button>
                      <button
                        type="button"
                        class="btn ghost"
                        [disabled]="resolving() === item.approval.id"
                        (click)="startModify(item.approval.id)"
                      >
                        Modificar
                      </button>
                    </div>
                  }
                </div>
                <span class="id mono">{{ item.approval.id }}</span>
              </div>
            } @else if (item.incident.severity === 'error') {
              <div class="row">
                <svg
                  class="icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <div class="body">
                  <p class="title">{{ parseTaskLine(item.incident.task).text }}</p>
                  <p class="detail">{{ item.incident.reason }}</p>
                </div>
              </div>
            } @else {
              <div class="row">
                <svg
                  class="icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                  />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div class="body">
                  <p class="title">{{ parseTaskLine(item.incident.task).text }}</p>
                  <p class="detail">{{ item.incident.reason }}</p>
                </div>
              </div>
            }
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './inbox.css',
})
export class Inbox {
  protected readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);
  protected readonly parseTaskLine = parseTaskLine;

  protected readonly project = computed(
    () => this.selection.selected() ?? this.api.workspaces.value()?.workspaces[0]?.project,
  );

  protected readonly inbox = this.api.inboxFor(() => this.project());

  protected readonly resolving = signal<string | null>(null);
  protected readonly modifyingId = signal<string | null>(null);
  protected readonly modifyText = signal('');
  protected readonly message = signal<string | null>(null);

  /** Every severity gets its own color — an approval and an error incident are both
   * "danger", a warning incident is "warning". Nothing falls through unstyled. */
  protected severityClass(item: InboxItem): string {
    if (item.kind === 'approval') return 'item danger';
    return item.incident.severity === 'error' ? 'item danger' : 'item warning';
  }

  protected onModifyInput(event: Event): void {
    this.modifyText.set((event.target as HTMLInputElement).value);
  }

  protected startModify(approvalId: string): void {
    this.modifyingId.set(approvalId);
    this.modifyText.set('');
  }

  protected cancelModify(): void {
    this.modifyingId.set(null);
  }

  protected confirmModify(approvalId: string): void {
    this.resolve(approvalId, 'modify', 'once', this.modifyText());
  }

  protected resolve(
    approvalId: string,
    action: ResolveAction,
    scope: ResolveScope,
    modifiedCommand?: string,
  ): void {
    const project = this.project();
    if (!project) return;

    this.resolving.set(approvalId);
    this.api.resolveApproval(project, approvalId, { action, scope, modifiedCommand }).subscribe({
      next: () => {
        this.resolving.set(null);
        this.modifyingId.set(null);
        this.flash(`${this.describe(action)} (${scope === 'always' ? 'siempre' : 'una vez'}).`);
        this.inbox.reload();
      },
      error: () => {
        this.resolving.set(null);
        this.flash('No se pudo resolver la aprobación.');
      },
    });
  }

  private describe(action: ResolveAction): string {
    if (action === 'approve') return 'Aprobado';
    if (action === 'deny') return 'Denegado';
    return 'Modificado';
  }

  private flash(text: string): void {
    this.message.set(text);
    setTimeout(() => this.message.set(null), 3000);
  }
}
