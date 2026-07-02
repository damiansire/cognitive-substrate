import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Departments } from './departments';

const ZERO_KPIS = {
  periodDays: 7,
  runsTotal: 0,
  runsVerified: 0,
  runsFailed: 0,
  passRate: 0,
  avgDurationMs: null,
  incidentsInPeriod: 0,
  incidentsBySeverity: { warning: 0, error: 0 },
  approvalsRequested: 0,
  approvalsApproved: 0,
  approvalsDenied: 0,
  approvalsModified: 0,
  approvalsPending: 0,
};

describe('Departments', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Departments],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the "no departments configured" banner when everything is unconfigured', async () => {
    const fixture = TestBed.createComponent(Departments);
    fixture.detectChanges();
    // WorkspacesApi eagerly fires GET /api/workspaces in its constructor (a plain
    // `httpResource` field initializer) even though Departments never reads `.workspaces`.
    http.expectOne('/api/workspaces').flush({ workspaces: [] });
    http
      .expectOne((r) => r.url.startsWith('/api/departments'))
      .flush({
        departments: [{ department: 'sin-departamento', workspaces: ['demo'], kpis: ZERO_KPIS }],
      });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No hay departamentos configurados');
    expect(text).toContain('Sin departamento');
    expect(text).toContain('demo');
  });

  it('does not show the banner once at least one real department exists', async () => {
    const fixture = TestBed.createComponent(Departments);
    fixture.detectChanges();
    http.expectOne('/api/workspaces').flush({ workspaces: [] });
    http
      .expectOne((r) => r.url.startsWith('/api/departments'))
      .flush({
        departments: [
          { department: 'infra', workspaces: ['alpha'], kpis: ZERO_KPIS },
          { department: 'sin-departamento', workspaces: ['beta'], kpis: ZERO_KPIS },
        ],
      });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('No hay departamentos configurados');
    expect(text).toContain('infra');
  });
});
