import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Environment } from './environment';

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Environment', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Environment],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the coordination mode and an honest "not available" note for unmeasured things', async () => {
    const fixture = TestBed.createComponent(Environment);
    fixture.detectChanges();
    http.expectOne('/api/workspaces').flush({ workspaces: [{ project: 'demo', home: {} }] });
    await wait();
    fixture.detectChanges();

    http
      .expectOne((r) => r.url.startsWith('/api/workspaces/demo/environment'))
      .flush({
        coordinationMode: 'local',
        claims: [],
      });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('local');
    expect(text).toContain('Sin tareas reclamadas ahora');
    expect(text).toContain('No disponible: CPU/memoria');
  });

  it('marks an expired claim distinctly from a live one', async () => {
    const fixture = TestBed.createComponent(Environment);
    fixture.detectChanges();
    http.expectOne('/api/workspaces').flush({ workspaces: [{ project: 'demo', home: {} }] });
    await wait();
    fixture.detectChanges();

    http
      .expectOne((r) => r.url.startsWith('/api/workspaces/demo/environment'))
      .flush({
        coordinationMode: 'local',
        claims: [
          {
            workerId: 'host-1',
            claimedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-01-01T00:05:00.000Z',
            taskKeyFile: 'a.json',
            expired: true,
          },
        ],
      });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('host-1');
    expect(text).toContain('expirado');
  });
});
