import { Component, computed, inject } from '@angular/core';
import { WorkspacesApi } from '../../api/workspaces-api';
import { WorkspaceSelection } from '../../core/workspace-selection';
import { normalizePath } from '../../shared/format';

/**
 * Vista 5 (artefactos): real files on disk — everything inside each `runs/<...>/`
 * (evidence) plus a shallow scan of the rest of the workspace
 * (`packages/engine/src/readModel.ts: listArtifacts`). No before/after diffs — the
 * engine doesn't snapshot file contents anywhere, so that comparison genuinely isn't
 * derivable; said explicitly instead of pretending otherwise.
 */
@Component({
  selector: 'csos-artifacts',
  template: `
    <h1>Artefactos</h1>

    @if (!project()) {
      <p class="dim">No hay ningún workspace seleccionado — entrá desde Home.</p>
    } @else {
      <p class="subtitle mono">{{ project() }}</p>

      @if (artifacts.isLoading() && !artifacts.hasValue()) {
        <p class="dim">Cargando…</p>
      }

      @if (artifacts.hasValue() && artifacts.value()!.artifacts.length === 0) {
        <p class="dim">Sin artefactos todavía.</p>
      }

      <ul class="list">
        @for (a of artifacts.value()?.artifacts ?? []; track a.relPath) {
          <li>
            <span class="path mono">{{ normalizePath(a.relPath) }}</span>
            <span class="kind-badge" [class.evidence]="a.kind === 'run-evidence'">
              {{ a.kind === 'run-evidence' ? 'evidencia de run' : 'archivo' }}
            </span>
            <span class="meta dim">{{ formatSize(a.sizeBytes) }}</span>
          </li>
        }
      </ul>

      <p class="note dim">
        Lista archivos y evidencia de runs — no captura diffs antes/después de código; esa
        comparación no existe en el sistema hoy.
      </p>
    }
  `,
  styleUrl: './artifacts.css',
})
export class Artifacts {
  protected readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);
  protected readonly normalizePath = normalizePath;

  protected readonly project = computed(
    () => this.selection.selected() ?? this.api.workspaces.value()?.workspaces[0]?.project,
  );

  protected readonly artifacts = this.api.artifactsFor(() => this.project());

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
