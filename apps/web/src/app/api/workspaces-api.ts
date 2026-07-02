import { Injectable, inject } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { PollingClock } from '../core/polling-clock';
import type {
  WorkspaceListResponse,
  InboxResponse,
  BoardResponse,
  SessionTrace,
  ResolveApprovalRequest,
  ResolveApprovalResponse,
  AskRequest,
  AskResponse,
  KpisResponse,
  DepartmentsResponse,
  PortfolioResponse,
  ArtifactsResponse,
  EnvironmentSnapshot,
  LearningSnapshot,
} from './models';

/**
 * All reads go through `httpResource`, keyed on `PollingClock.tick` so they refetch on
 * the same ~3s cadence the TUI polls the filesystem with. Writes (approve/deny/modify)
 * are plain `HttpClient` calls — a resource models a value you read, not an action you
 * trigger.
 */
@Injectable({ providedIn: 'root' })
export class WorkspacesApi {
  private readonly clock = inject(PollingClock);
  private readonly http = inject(HttpClient);

  readonly workspaces = httpResource<WorkspaceListResponse>(() => {
    this.clock.tick();
    return '/api/workspaces';
  });

  inboxFor(project: () => string | undefined) {
    return httpResource<InboxResponse>(() => {
      this.clock.tick();
      const p = project();
      return p ? `/api/workspaces/${encodeURIComponent(p)}/inbox` : undefined;
    });
  }

  boardFor(project: () => string | undefined) {
    return httpResource<BoardResponse>(() => {
      this.clock.tick();
      const p = project();
      return p ? `/api/workspaces/${encodeURIComponent(p)}/board` : undefined;
    });
  }

  sessionFor(project: () => string | undefined, evidencePath: () => string | undefined) {
    return httpResource<SessionTrace>(() => {
      this.clock.tick();
      const p = project();
      if (!p) return undefined;
      const path = evidencePath();
      const query = path ? `?path=${encodeURIComponent(path)}` : '';
      return `/api/workspaces/${encodeURIComponent(p)}/sessions${query}`;
    });
  }

  resolveApproval(project: string, approvalId: string, body: ResolveApprovalRequest) {
    return this.http.post<ResolveApprovalResponse>(
      `/api/workspaces/${encodeURIComponent(project)}/approvals/${encodeURIComponent(approvalId)}/resolve`,
      body,
    );
  }

  ask(project: string, text: string) {
    return this.http.post<AskResponse>(`/api/workspaces/${encodeURIComponent(project)}/ask`, {
      text,
    } satisfies AskRequest);
  }

  kpisFor(project: () => string | undefined, days: () => number = () => 7) {
    return httpResource<KpisResponse>(() => {
      this.clock.tick();
      const p = project();
      return p ? `/api/workspaces/${encodeURIComponent(p)}/kpis?days=${days()}` : undefined;
    });
  }

  departments(days: () => number = () => 7) {
    return httpResource<DepartmentsResponse>(() => {
      this.clock.tick();
      return `/api/departments?days=${days()}`;
    });
  }

  portfolio(days: () => number = () => 7) {
    return httpResource<PortfolioResponse>(() => {
      this.clock.tick();
      return `/api/portfolio?days=${days()}`;
    });
  }

  artifactsFor(project: () => string | undefined) {
    return httpResource<ArtifactsResponse>(() => {
      this.clock.tick();
      const p = project();
      return p ? `/api/workspaces/${encodeURIComponent(p)}/artifacts` : undefined;
    });
  }

  environmentFor(project: () => string | undefined) {
    return httpResource<EnvironmentSnapshot>(() => {
      this.clock.tick();
      const p = project();
      return p ? `/api/workspaces/${encodeURIComponent(p)}/environment` : undefined;
    });
  }

  learningFor(project: () => string | undefined) {
    return httpResource<LearningSnapshot>(() => {
      this.clock.tick();
      const p = project();
      return p ? `/api/workspaces/${encodeURIComponent(p)}/learning` : undefined;
    });
  }
}
