import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Portfolio } from './portfolio';

function kpis(passRate: number, runsTotal: number) {
  return {
    periodDays: 7,
    runsTotal,
    runsVerified: Math.round(passRate * runsTotal),
    runsFailed: runsTotal - Math.round(passRate * runsTotal),
    passRate,
    avgDurationMs: null,
    incidentsInPeriod: 0,
    incidentsBySeverity: { warning: 0, error: 0 },
    approvalsRequested: 0,
    approvalsApproved: 0,
    approvalsDenied: 0,
    approvalsModified: 0,
    approvalsPending: 0,
  };
}

describe('Portfolio', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Portfolio],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sorts rows with a real bad pass-rate first', async () => {
    const fixture = TestBed.createComponent(Portfolio);
    fixture.detectChanges();
    // WorkspacesApi eagerly fires GET /api/workspaces in its constructor (a plain
    // `httpResource` field initializer) even though Portfolio never reads `.workspaces`.
    http.expectOne('/api/workspaces').flush({ workspaces: [] });
    http
      .expectOne((r) => r.url.startsWith('/api/portfolio'))
      .flush({
        portfolio: [
          { project: 'good', kpis: kpis(0.9, 10) },
          { project: 'bad', kpis: kpis(0.2, 10) },
          { project: 'no-runs-yet', kpis: kpis(0, 0) },
        ],
      });
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('bad');
    expect(rows[1].textContent).toContain('good');
    expect(rows[2].textContent).toContain('no-runs-yet');
  });

  it('shows an empty state with no workspaces', async () => {
    const fixture = TestBed.createComponent(Portfolio);
    fixture.detectChanges();
    http.expectOne('/api/workspaces').flush({ workspaces: [] });
    http.expectOne((r) => r.url.startsWith('/api/portfolio')).flush({ portfolio: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No hay workspaces todavía',
    );
  });
});
