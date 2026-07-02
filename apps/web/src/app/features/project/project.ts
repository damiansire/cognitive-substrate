import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { WorkspacesApi } from '../../api/workspaces-api';
import { WorkspaceSelection } from '../../core/workspace-selection';
import { parseTaskLine } from '../../shared/format';

/**
 * Workspace/proyecto altitude (charter vista 7): real KPIs derived from `runs/`,
 * `incidents.jsonl`, `approvals.json` (`packages/engine/src/kpis.ts`) + the plan's
 * `[recurring]` queue (already exposed by `/board`, reused here rather than a second
 * endpoint). "Contratos" has no backing entity anywhere in the engine — shown as an
 * explicit empty state, not invented.
 */
@Component({
  selector: 'csos-project',
  imports: [RouterLink, DecimalPipe],
  template: `
    <h1>Proyecto</h1>

    @if (!project()) {
      <p class="dim">No hay ningún workspace seleccionado — entrá desde Home.</p>
    } @else {
      <p class="subtitle mono">{{ project() }}</p>

      @if (kpis.isLoading() && !kpis.hasValue()) {
        <p class="dim">Cargando…</p>
      }

      @if (kpis.hasValue()) {
        @let k = kpis.value()!.kpis;
        <p class="period dim">Últimos {{ k.periodDays }} días</p>

        <div class="grid">
          <div class="stat-card">
            <span class="label">Pass rate</span>
            <span class="value" [class.warn]="k.runsTotal > 0 && k.passRate < 0.5">
              {{ k.runsTotal > 0 ? (k.passRate * 100 | number: '1.0-0') + '%' : '—' }}
            </span>
            <span class="sub dim">{{ k.runsVerified }}/{{ k.runsTotal }} runs verificados</span>
          </div>

          <div class="stat-card">
            <span class="label">Duración promedio</span>
            <span class="value">{{
              k.avgDurationMs !== null ? formatMs(k.avgDurationMs) : '—'
            }}</span>
            <span class="sub dim">por run</span>
          </div>

          <div class="stat-card">
            <span class="label">Incidentes</span>
            <span class="value" [class.warn]="k.incidentsInPeriod > 0">{{
              k.incidentsInPeriod
            }}</span>
            <span class="sub dim"
              >{{ k.incidentsBySeverity.error }} error ·
              {{ k.incidentsBySeverity.warning }} warning</span
            >
          </div>

          <div class="stat-card">
            <span class="label">Aprobaciones</span>
            <span class="value">{{ k.approvalsRequested }}</span>
            <span class="sub dim">
              {{ k.approvalsApproved }} aprobadas · {{ k.approvalsDenied }} denegadas ·
              {{ k.approvalsPending }} pendientes
            </span>
          </div>
        </div>
      }

      <section class="recurring">
        <h2>Recurrentes</h2>
        @if (board.hasValue() && (board.value()!.board.recurring.length ?? 0) === 0) {
          <p class="dim">Sin tareas recurrentes en este workspace.</p>
        }
        <ul>
          @for (task of board.value()?.board?.recurring ?? []; track $index) {
            @let parsed = parseTaskLine(task.line);
            <li>
              @if (parsed.cadenceTicks) {
                <span class="cadence-badge"
                  >cada {{ parsed.cadenceTicks }}
                  {{ parsed.cadenceTicks === 1 ? 'ciclo' : 'ciclos' }}</span
                >
              }
              {{ parsed.text }}
            </li>
          }
        </ul>
      </section>

      <section class="unavailable">
        <h2>Contratos</h2>
        <p class="dim">
          Sin datos — no existe ninguna entidad de "contrato" en el sistema hoy. Esta sección queda
          vacía a propósito en vez de mostrar información inventada.
        </p>
      </section>

      <p class="footer-link"><a routerLink="/board">Ver el tablero completo →</a></p>
    }
  `,
  styleUrl: './project.css',
})
export class Project {
  protected readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);
  protected readonly parseTaskLine = parseTaskLine;

  protected readonly project = computed(
    () => this.selection.selected() ?? this.api.workspaces.value()?.workspaces[0]?.project,
  );

  protected readonly kpis = this.api.kpisFor(() => this.project());
  protected readonly board = this.api.boardFor(() => this.project());

  protected formatMs(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
}
