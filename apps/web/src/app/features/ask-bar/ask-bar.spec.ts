import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AskBar } from './ask-bar';

describe('AskBar', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AskBar],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  function createAndFlushWorkspaces(): ReturnType<typeof TestBed.createComponent<AskBar>> {
    const fixture = TestBed.createComponent(AskBar);
    fixture.detectChanges();
    http.expectOne('/api/workspaces').flush({ workspaces: [{ project: 'demo', home: {} }] });
    return fixture;
  }

  afterEach(() => http.verify());

  it('disables the input until a project is known', () => {
    const fixture = TestBed.createComponent(AskBar);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.ask-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    http.expectOne('/api/workspaces').flush({ workspaces: [] });
  });

  it('submits text to POST .../ask and renders the interpretation + message', async () => {
    const fixture = createAndFlushWorkspaces();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.ask-input') as HTMLInputElement;
    input.value = 'Arreglar el bug del login';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    const req = http.expectOne('/api/workspaces/demo/ask');
    expect(req.request.body).toEqual({ text: 'Arreglar el bug del login' });
    req.flush({
      interpretation: { verb: 'hacer', mode: 'ejecucion_unica', confidence: 0.5 },
      message: 'Tarea agregada a [now]: Arreglar el bug del login',
    });
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('.ask-result') as HTMLElement;
    // The tag shows a human label ("Tarea única"), never the raw snake_case enum
    // ("ejecucion_unica") — a design-review flagged the raw enum as debug-looking.
    expect(result.textContent).toContain('Tarea única');
    expect(result.textContent).not.toContain('ejecucion_unica');
    expect(result.textContent).toContain('Tarea agregada a [now]');
    // The input clears after a successful submit, ready for the next request.
    expect(input.value).toBe('');
  });

  it('shows an error message if the request fails', async () => {
    const fixture = createAndFlushWorkspaces();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.ask-input') as HTMLInputElement;
    input.value = 'algo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { cancelable: true }));

    http
      .expectOne('/api/workspaces/demo/ask')
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.ask-error')).toBeTruthy();
  });

  it('does not submit empty or whitespace-only text', async () => {
    const fixture = createAndFlushWorkspaces();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectNone('/api/workspaces/demo/ask');
  });
});
