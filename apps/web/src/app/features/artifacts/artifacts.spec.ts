import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Artifacts } from './artifacts';

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Artifacts', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Artifacts],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists real artifacts with a human-readable size and kind badge', async () => {
    const fixture = TestBed.createComponent(Artifacts);
    fixture.detectChanges();
    http.expectOne('/api/workspaces').flush({ workspaces: [{ project: 'demo', home: {} }] });
    await wait();
    fixture.detectChanges();

    http.expectOne((r) => r.url.startsWith('/api/workspaces/demo/artifacts')).flush({
      artifacts: [
        { relPath: 'runs\\2026-01-01\\run.json', sizeBytes: 2048, mtime: '2026-01-01T00:00:00.000Z', kind: 'run-evidence', runEvidencePath: 'runs\\2026-01-01' },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('runs/2026-01-01/run.json');
    expect(text).toContain('2.0 KB');
    expect(text).toContain('evidencia de run');
  });
});
