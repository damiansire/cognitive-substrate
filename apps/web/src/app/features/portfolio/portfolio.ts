import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { WorkspacesApi } from '../../api/workspaces-api';
import type { PortfolioRow } from '../../api/models';

/**
 * Portfolio altitude (charter vista 9): one row per workspace, sorted worst-pass-rate
 * first — a workspace with a low pass rate and high incident count is a genuine
 * bottleneck signal, not a fabricated one. Deliberately does NOT build: staffing/machine
 * allocation, capital/budget allocation, or a portfolio risk map — none of those have
 * any entity (personnel, money, risk register) anywhere in the engine today.
 */
@Component({
  selector: 'csos-portfolio',
  imports: [DecimalPipe],
  template: `
    <h1>Portfolio</h1>

    @if (portfolio.isLoading() && !portfolio.hasValue()) {
      <p class="dim">Cargando…</p>
    }

    @if (portfolio.hasValue() && portfolio.value()!.portfolio.length === 0) {
      <p class="dim">No hay workspaces todavía.</p>
    }

    @if (rows().length > 0) {
      <table>
        <thead>
          <tr>
            <th>Proyecto</th>
            <th>Departamento</th>
            <th>Pass rate</th>
            <th>Runs</th>
            <th>Incidentes</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.project) {
            <tr [class.attention]="row.kpis.runsTotal > 0 && row.kpis.passRate < 0.5">
              <td class="mono">{{ row.project }}</td>
              <td class="dim">{{ row.department ?? '—' }}</td>
              <td [class.warn]="row.kpis.runsTotal > 0 && row.kpis.passRate < 0.5">
                {{
                  row.kpis.runsTotal > 0 ? (row.kpis.passRate * 100 | number: '1.0-0') + '%' : '—'
                }}
              </td>
              <td>{{ row.kpis.runsTotal }}</td>
              <td [class.warn]="row.kpis.incidentsInPeriod > 0">
                {{ row.kpis.incidentsInPeriod }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    }

    <p class="unavailable dim">
      No disponible todavía: asignación de personal o máquinas, asignación de capital o presupuesto,
      mapa de riesgo del portfolio — ninguna de esas entidades existe en el sistema hoy.
    </p>
  `,
  styleUrl: './portfolio.css',
})
export class Portfolio {
  protected readonly api = inject(WorkspacesApi);
  protected readonly portfolio = this.api.portfolio();

  protected readonly rows = computed<PortfolioRow[]>(() => {
    const list = this.portfolio.value()?.portfolio ?? [];
    // Worst pass-rate first — the row someone should look at first. Workspaces with no
    // runs yet (passRate 0 but runsTotal 0 too) sort after ones with a real bad rate.
    return [...list].sort((a, b) => {
      const aScore = a.kpis.runsTotal > 0 ? a.kpis.passRate : 1;
      const bScore = b.kpis.runsTotal > 0 ? b.kpis.passRate : 1;
      return aScore - bScore;
    });
  });
}
