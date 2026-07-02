import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { WorkspacesApi } from '../../api/workspaces-api';

/**
 * Empresa/departamentos altitude (charter vista 8): groups workspaces by the optional
 * `governance.json: department` field (`Policy.department`), aggregating real KPIs per
 * group. Deliberately does NOT build: billing/cost trends, OKRs, or a single "health"
 * score — none of those have any real data behind them today (see
 * `packages/engine/src/kpis.ts`). Building placeholders for them would just be an
 * invitation to fill them with mocks later.
 */
@Component({
  selector: 'csos-departments',
  imports: [DecimalPipe],
  template: `
    <h1>Empresa</h1>

    @if (departments.isLoading() && !departments.hasValue()) {
      <p class="dim">Cargando…</p>
    }

    @if (onlyUnconfigured()) {
      <p class="banner">
        No hay departamentos configurados — agregá <code>"department": "nombre"</code> a
        <code>governance.json</code> de un workspace para agruparlo. Mientras tanto, todos los
        workspaces aparecen bajo "Sin departamento".
      </p>
    }

    <div class="grid">
      @for (dept of departments.value()?.departments ?? []; track dept.department) {
        <div class="dept-card">
          <h2>
            {{ dept.department === 'sin-departamento' ? 'Sin departamento' : dept.department }}
          </h2>
          <p class="workspaces dim">{{ dept.workspaces.join(', ') }}</p>
          <dl>
            <div>
              <dt>Pass rate</dt>
              <dd [class.warn]="dept.kpis.runsTotal > 0 && dept.kpis.passRate < 0.5">
                {{
                  dept.kpis.runsTotal > 0 ? (dept.kpis.passRate * 100 | number: '1.0-0') + '%' : '—'
                }}
              </dd>
            </div>
            <div>
              <dt>Runs</dt>
              <dd>{{ dept.kpis.runsTotal }}</dd>
            </div>
            <div>
              <dt>Incidentes</dt>
              <dd [class.warn]="dept.kpis.incidentsInPeriod > 0">
                {{ dept.kpis.incidentsInPeriod }}
              </dd>
            </div>
            <div>
              <dt>Aprobaciones</dt>
              <dd>{{ dept.kpis.approvalsRequested }}</dd>
            </div>
          </dl>
        </div>
      }
    </div>

    <p class="unavailable dim">
      No disponible todavía: tendencias de facturación/costo, objetivos (OKRs), score de "salud" —
      ninguno tiene datos reales detrás en este sistema.
    </p>
  `,
  styleUrl: './departments.css',
})
export class Departments {
  protected readonly api = inject(WorkspacesApi);
  protected readonly departments = this.api.departments();

  protected readonly onlyUnconfigured = computed(() => {
    const list = this.departments.value()?.departments ?? [];
    return list.length === 1 && list[0]?.department === 'sin-departamento';
  });
}
