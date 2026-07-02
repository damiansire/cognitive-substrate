import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Project } from './project';

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Project', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Project],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows a real pass rate, incidents count, and recurring tasks once loaded', async () => {
    const fixture = TestBed.createComponent(Project);
    fixture.detectChanges();
    http.expectOne('/api/workspaces').flush({ workspaces: [{ project: 'demo', home: {} }] });
    // A real (short) wait, not whenStable: whenStable would block forever waiting on
    // the kpis/board requests this flush is about to trigger, which aren't flushed yet
    // — the resource scheduler needs a tick to notice `project()` changed and issue them.
    await wait();
    fixture.detectChanges();

    http
      .expectOne((r) => r.url.startsWith('/api/workspaces/demo/kpis'))
      .flush({
        kpis: {
          periodDays: 7,
          runsTotal: 4,
          runsVerified: 3,
          runsFailed: 1,
          passRate: 0.75,
          avgDurationMs: 2500,
          incidentsInPeriod: 1,
          incidentsBySeverity: { warning: 0, error: 1 },
          approvalsRequested: 2,
          approvalsApproved: 1,
          approvalsDenied: 0,
          approvalsModified: 0,
          approvalsPending: 1,
        },
      });
    http
      .expectOne((r) => r.url.startsWith('/api/workspaces/demo/board'))
      .flush({
        board: {
          now: [],
          next: [],
          blocked: [],
          improve: [],
          recurring: [{ line: '- [ ] Chequeo', taskId: null, evidencePath: null }],
        },
      });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('75%');
    expect(text).toContain('Chequeo');
    expect(text).toContain('Contratos');
    expect(text).toContain('Sin datos');
  });
});
