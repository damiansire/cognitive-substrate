import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { WorkspacesApi } from '../../api/workspaces-api';
import { WorkspaceSelection } from '../../core/workspace-selection';
import { parseTaskLine } from '../../shared/format';

@Component({
  selector: 'csos-home',
  template: `
    <h1>Home</h1>

    @if (api.workspaces.isLoading() && !api.workspaces.hasValue()) {
      <p class="dim">Cargando workspaces…</p>
    }

    @if (api.workspaces.error()) {
      <p class="error">No se pudo conectar con el backend ({{ api.workspaces.error() }}).</p>
    }

    @if (api.workspaces.hasValue() && api.workspaces.value().workspaces.length === 0) {
      <p class="dim">No hay workspaces todavía en este directorio.</p>
    }

    <div class="grid">
      @for (entry of api.workspaces.value()?.workspaces ?? []; track entry.project) {
        <button type="button" class="card" (click)="openInbox(entry.project)">
          <div class="card-header">
            <span class="project">{{ entry.project }}</span>
            @if (entry.home.pendingApprovals > 0) {
              <span class="badge danger">
                {{ entry.home.pendingApprovals }}
                {{ entry.home.pendingApprovals === 1 ? 'aprobación' : 'aprobaciones' }}
              </span>
            }
          </div>
          <dl>
            <div>
              <dt>now</dt>
              <dd>{{ entry.home.pendingNow }}</dd>
            </div>
            <div>
              <dt>next</dt>
              <dd>{{ entry.home.pendingNext }}</dd>
            </div>
            <div>
              <dt>blocked</dt>
              <dd>{{ entry.home.blocked }}</dd>
            </div>
            <div>
              <dt>incidentes</dt>
              <dd [class.warn]="entry.home.incidents > 0">{{ entry.home.incidents }}</dd>
            </div>
          </dl>
          @if (entry.home.lastRun; as run) {
            <p
              class="last-run"
              [class.ok]="run.verdict.verified"
              [class.fail]="!run.verdict.verified"
            >
              @if (run.verdict.verified) {
                <svg
                  class="run-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              } @else {
                <svg
                  class="run-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              }
              {{ parseTaskLine(run.task).text }}
            </p>
          } @else {
            <p class="last-run dim">Sin runs todavía</p>
          }
        </button>
      }
    </div>
  `,
  styleUrl: './home.css',
})
export class Home {
  protected readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);
  private readonly router = inject(Router);
  protected readonly parseTaskLine = parseTaskLine;

  protected openInbox(project: string): void {
    this.selection.select(project);
    void this.router.navigate(['/inbox']);
  }
}
