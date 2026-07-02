import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkspacesApi } from '../../api/workspaces-api';
import { WorkspaceSelection } from '../../core/workspace-selection';
import { parseTaskLine } from '../../shared/format';
import type { QueueName } from '../../api/models';

const QUEUE_ORDER: QueueName[] = ['now', 'next', 'blocked', 'improve', 'recurring'];

@Component({
  selector: 'csos-board',
  imports: [RouterLink],
  template: `
    <h1>Tablero</h1>

    @if (!project()) {
      <p class="dim">No hay ningún workspace seleccionado — entrá desde Home.</p>
    } @else {
      <p class="subtitle mono">{{ project() }}</p>

      @if (board.isLoading() && !board.hasValue()) {
        <p class="dim">Cargando…</p>
      }

      <div class="queues">
        @for (queue of queueOrder; track queue) {
          @if ((board.value()?.board?.[queue]?.length ?? 0) > 0) {
            <section>
              <h2>{{ queue }}</h2>
              <ul>
                @for (task of board.value()!.board[queue]; track $index) {
                  @let parsed = parseTaskLine(task.line);
                  <li>
                    @if (task.evidencePath) {
                      <a
                        routerLink="/session"
                        [queryParams]="{ path: task.evidencePath }"
                        class="task-link"
                        >{{ parsed.text }}</a
                      >
                    } @else {
                      {{ parsed.text }}
                    }
                    @if (parsed.pendingApprovalId) {
                      <a routerLink="/inbox" class="pending-badge">🔒 esperando tu aprobación</a>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        }
      </div>

      @if (board.hasValue() && isEmpty()) {
        <p class="dim">Sin tareas todavía.</p>
      }

      <p class="footer-link"><a routerLink="/session">Ver la sesión más reciente →</a></p>
    }
  `,
  styleUrl: './board.css',
})
export class Board {
  protected readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);
  protected readonly queueOrder = QUEUE_ORDER;
  protected readonly parseTaskLine = parseTaskLine;

  protected readonly project = computed(
    () => this.selection.selected() ?? this.api.workspaces.value()?.workspaces[0]?.project,
  );

  protected readonly board = this.api.boardFor(() => this.project());

  protected isEmpty(): boolean {
    const value = this.board.value();
    if (!value) return false;
    return this.queueOrder.every((q) => value.board[q].length === 0);
  }
}
