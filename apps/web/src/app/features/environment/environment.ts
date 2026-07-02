import { Component, computed, inject } from '@angular/core';
import { WorkspacesApi } from '../../api/workspaces-api';
import { WorkspaceSelection } from '../../core/workspace-selection';

/**
 * Vista 6 (máquina/entorno): the only real data this OS has about "environment" today —
 * coordination mode + active/expired task claims
 * (`packages/engine/src/readModel.ts: getEnvironmentSnapshot`). No CPU/memory/terminal
 * gauges — zero instrumentation exists for those anywhere in the codebase, so this view
 * says so explicitly instead of faking a dashboard.
 */
@Component({
  selector: 'csos-environment',
  template: `
    <h1>Entorno</h1>

    @if (!project()) {
      <p class="dim">No hay ningún workspace seleccionado — entrá desde Home.</p>
    } @else {
      <p class="subtitle mono">{{ project() }}</p>

      @if (env.isLoading() && !env.hasValue()) {
        <p class="dim">Cargando…</p>
      }

      @if (env.hasValue()) {
        @let e = env.value()!;
        <p class="mode">
          Modo de coordinación:
          <strong>{{ e.coordinationMode === 'local' ? 'local' : 'http (multi-máquina)' }}</strong>
          @if (e.coordinationEndpoint) {
            <span class="dim mono"> — {{ e.coordinationEndpoint }}</span>
          }
        </p>

        <section>
          <h2>Claims</h2>
          @if (e.claims.length === 0) {
            <p class="dim">Sin tareas reclamadas ahora.</p>
          }
          <ul>
            @for (c of e.claims; track c.taskKeyFile) {
              <li>
                <span class="worker mono">{{ c.workerId }}</span>
                <span class="status-badge" [class.expired]="c.expired">
                  {{ c.expired ? 'expirado' : 'activo' }}
                </span>
                <span class="dim">reclamado {{ c.claimedAt }}</span>
              </li>
            }
          </ul>
        </section>

        <p class="unavailable dim">
          No disponible: CPU/memoria, terminales, escritorios, sesiones de browser — sin fuente de
          datos hoy.
          @if (e.coordinationMode === 'http') {
            Tampoco se expone qué máquina remota sostiene cada claim — la API del coordinator no lo
            da todavía.
          }
        </p>
      }
    }
  `,
  styleUrl: './environment.css',
})
export class Environment {
  protected readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);

  protected readonly project = computed(
    () => this.selection.selected() ?? this.api.workspaces.value()?.workspaces[0]?.project,
  );

  protected readonly env = this.api.environmentFor(() => this.project());
}
