import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Learning } from './learning';

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Learning', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Learning],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows an honest empty state when there is no eval report', async () => {
    const fixture = TestBed.createComponent(Learning);
    fixture.detectChanges();
    http.expectOne('/api/workspaces').flush({ workspaces: [{ project: 'demo', home: {} }] });
    await wait();
    fixture.detectChanges();

    http
      .expectOne((r) => r.url.startsWith('/api/workspaces/demo/learning'))
      .flush({
        improveQueue: ['- [ ] Revisar X'],
        skills: [{ name: 'foo', description: 'hace foo', path: '/skills/foo/SKILL.md' }],
        latestEvalReport: null,
      });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Revisar X');
    expect(text).toContain('foo');
    expect(text).toContain('No se encontró una corrida de evals');
  });

  it('shows the real eval report summary when present, without a trend chart', async () => {
    const fixture = TestBed.createComponent(Learning);
    fixture.detectChanges();
    http.expectOne('/api/workspaces').flush({ workspaces: [{ project: 'demo', home: {} }] });
    await wait();
    fixture.detectChanges();

    http
      .expectOne((r) => r.url.startsWith('/api/workspaces/demo/learning'))
      .flush({
        improveQueue: [],
        skills: [],
        latestEvalReport: {
          generatedAt: '2026-07-01T00:00:00.000Z',
          simulation: true,
          total: 10,
          passed: 8,
          passRate: 0.8,
        },
      });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('8/10');
    expect(text).toContain('modo simulación');
    expect(text).toContain('no una tendencia');
  });
});
