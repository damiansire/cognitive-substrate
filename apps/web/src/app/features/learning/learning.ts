import { Component, computed, inject } from '@angular/core';
import { WorkspacesApi } from '../../api/workspaces-api';
import { WorkspaceSelection } from '../../core/workspace-selection';
import { parseTaskLine } from '../../shared/format';

/**
 * Vista 10 (aprendizaje/eval): reuses the `[improve]` queue (already exposed by
 * `getBoard`, no new backend work) and real discovered skills, plus a single "most
 * recent" evals snapshot if reachable
 * (`packages/engine/src/readModel.ts: getLearningSnapshot`). Deliberately no
 * trend/regression chart — `writeReport` overwrites `report.json` every run, so there's
 * no history to chart; faking one with a single data point would be misleading.
 */
@Component({
  selector: 'csos-learning',
  template: `
    <h1>Aprendizaje</h1>

    @if (!project()) {
      <p class="dim">No hay ningún workspace seleccionado — entrá desde Home.</p>
    } @else {
      <p class="subtitle mono">{{ project() }}</p>

      @if (learning.isLoading() && !learning.hasValue()) {
        <p class="dim">Cargando…</p>
      }

      @if (learning.hasValue()) {
        @let l = learning.value()!;

        <section>
          <h2>Cola de mejoras</h2>
          @if (l.improveQueue.length === 0) {
            <p class="dim">Sin mejoras pendientes en este workspace.</p>
          }
          <ul>
            @for (line of l.improveQueue; track $index) {
              <li>{{ parseTaskLine(line).text }}</li>
            }
          </ul>
        </section>

        <section>
          <h2>Última corrida de evals</h2>
          @if (l.latestEvalReport; as report) {
            <p class="eval-summary">
              <strong>{{ report.passed }}/{{ report.total }}</strong> pass@1 ·
              {{ report.simulation ? 'modo simulación (sin API key)' : 'en vivo' }} ·
              <span class="dim">{{ report.generatedAt }}</span>
            </p>
            <p class="note dim">
              Última corrida, no una tendencia — el sistema no guarda historial de corridas
              anteriores todavía.
            </p>
          } @else {
            <p class="dim">
              No se encontró una corrida de evals — corré <code>npm run eval</code> y (si el reporte
              no está en el cwd por defecto) configurá <code>CSOS_EVALS_REPORT_DIR</code>
              para verla acá.
            </p>
          }
        </section>

        <section class="skills">
          <h2>Skills disponibles</h2>
          @if (l.skills.length === 0) {
            <p class="dim">No se encontraron skills (globales ni locales).</p>
          }
          <ul>
            @for (skill of l.skills; track skill.path) {
              <li>
                <span class="skill-name mono">{{ skill.name }}</span>
                <span class="dim">{{ skill.description }}</span>
              </li>
            }
          </ul>
        </section>
      }
    }
  `,
  styleUrl: './learning.css',
})
export class Learning {
  protected readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);
  protected readonly parseTaskLine = parseTaskLine;

  protected readonly project = computed(
    () => this.selection.selected() ?? this.api.workspaces.value()?.workspaces[0]?.project,
  );

  protected readonly learning = this.api.learningFor(() => this.project());
}
