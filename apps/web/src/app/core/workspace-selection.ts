import { Injectable, signal } from '@angular/core';

/** Which workspace's Inbox/Board/Session views are showing — shared across routes. */
@Injectable({ providedIn: 'root' })
export class WorkspaceSelection {
  readonly selected = signal<string | null>(null);

  select(project: string): void {
    this.selected.set(project);
  }
}
