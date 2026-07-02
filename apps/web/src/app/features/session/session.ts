import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { WorkspacesApi } from '../../api/workspaces-api';
import { WorkspaceSelection } from '../../core/workspace-selection';
import { parseTaskLine, normalizePath } from '../../shared/format';

@Component({
  selector: 'csos-session',
  template: `
    <h1>Sesión</h1>

    @if (!project()) {
      <p class="dim">No hay ningún workspace seleccionado — entrá desde Home.</p>
    } @else {
      <p class="subtitle mono">{{ project() }}</p>

      @if (session.isLoading() && !session.hasValue()) {
        <p class="dim">Cargando…</p>
      }

      @if (session.error()) {
        <p class="dim">Todavía no hay ninguna sesión registrada para este workspace.</p>
      }

      @if (session.value(); as trace) {
        <p class="evidence-path mono">{{ normalizePath(trace.evidencePath) }}</p>

        @if (trace.record; as run) {
          <p class="task">{{ parseTaskLine(run.task).text }}</p>

          <div
            class="verdict"
            [class.ok]="run.verdict.verified"
            [class.fail]="!run.verdict.verified"
          >
            @if (run.verdict.verified) {
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Verificado</span>
            } @else {
              <svg
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
              <span>No verificado</span>
            }
          </div>
          <p class="reason">{{ run.verdict.reason }}</p>

          @if (run.verdict.checks.length > 0) {
            <section>
              <h2>Checks</h2>
              <ul class="checks">
                @for (check of run.verdict.checks; track check.name) {
                  <li [class.ok]="check.passed" [class.fail]="!check.passed">
                    <span class="mark">{{ check.passed ? '✓' : '✗' }}</span>
                    <span class="check-name mono">{{ check.name }}</span>
                    <span class="check-detail">{{ check.detail }}</span>
                  </li>
                }
              </ul>
            </section>
          }

          @if (run.learning) {
            <section>
              <h2>Aprendizaje</h2>
              <p class="learning">{{ run.learning }}</p>
            </section>
          }

          <section>
            <h2>Log de ejecución</h2>
            <pre class="log">{{ run.log.trim() || '(vacío)' }}</pre>
          </section>
        } @else {
          <pre class="log">{{ trace.summaryMd ?? '(sin summary.md)' }}</pre>
        }
      }
    }
  `,
  styleUrl: './session.css',
})
export class Session {
  protected readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);
  private readonly route = inject(ActivatedRoute);
  protected readonly parseTaskLine = parseTaskLine;
  protected readonly normalizePath = normalizePath;

  private readonly evidencePath = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('path') ?? undefined)),
    {
      initialValue: undefined,
    },
  );

  protected readonly project = computed(
    () => this.selection.selected() ?? this.api.workspaces.value()?.workspaces[0]?.project,
  );

  protected readonly session = this.api.sessionFor(
    () => this.project(),
    () => this.evidencePath(),
  );
}
