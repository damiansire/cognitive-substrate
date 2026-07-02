import { Component, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { WorkspacesApi } from './api/workspaces-api';
import { WorkspaceSelection } from './core/workspace-selection';
import { PollingClock } from './core/polling-clock';
import { AskBar } from './features/ask-bar/ask-bar';

@Component({
  selector: 'csos-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AskBar],
  template: `
    <header class="topbar">
      <span class="brand">Cognitive Substrate OS</span>
      <nav>
        <span class="nav-group">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
            >Home</a
          >
          <a routerLink="/inbox" routerLinkActive="active">Inbox</a>
          <a routerLink="/board" routerLinkActive="active">Board</a>
          <a routerLink="/session" routerLinkActive="active">Sesión</a>
        </span>
        <span class="nav-group">
          <a routerLink="/project" routerLinkActive="active">Proyecto</a>
          <a routerLink="/departments" routerLinkActive="active">Empresa</a>
          <a routerLink="/portfolio" routerLinkActive="active">Portfolio</a>
        </span>
        <span class="nav-group">
          <a routerLink="/artifacts" routerLinkActive="active">Artefactos</a>
          <a routerLink="/environment" routerLinkActive="active">Entorno</a>
          <a routerLink="/learning" routerLinkActive="active">Aprendizaje</a>
        </span>
      </nav>
      <csos-ask-bar />
    </header>
    <main>
      <router-outlet />
    </main>
  `,
  styleUrl: './app.css',
})
export class App {
  private readonly api = inject(WorkspacesApi);
  private readonly selection = inject(WorkspaceSelection);
  private readonly clock = inject(PollingClock);

  constructor() {
    // Single place that resolves "the effective project" (explicit selection, or the
    // first known workspace) into the SSE connection — same fallback formula each
    // feature view (Board/Inbox/Session) already uses for its own template bindings.
    // Guarded to skip falsy reads: `workspaces` is itself a `PollingClock`-driven
    // resource, so it goes briefly empty on every background refetch — without this
    // guard the SSE connection would flap closed/reopen every ~3s in lockstep with it.
    effect(() => {
      const project =
        this.selection.selected() ?? this.api.workspaces.value()?.workspaces[0]?.project;
      if (project) this.clock.setActiveProject(project);
    });
  }
}
