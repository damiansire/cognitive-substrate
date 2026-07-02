import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import axe from 'axe-core';
import { App } from './app';

/**
 * The repo's own standard (apps/web/.claude/CLAUDE.md) mandates AXE + WCAG AA. This is the
 * gate that enforces it: render the app shell (topbar, nav, ask bar) and fail on any axe
 * violation. Color-contrast can't be computed under jsdom, so axe skips it — the
 * structural rules (labels, ARIA, roles, region names) DO run, which is exactly what the
 * audit found missing.
 */
describe('App — accessibility (axe)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('has no axe violations on the app shell', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/workspaces').flush({ workspaces: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    // axe needs the node attached to the document to evaluate it.
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    try {
      const results = await axe.run(host, {
        // These require real layout/paint that jsdom doesn't provide; the DOM-structure
        // rules we care about (labels, aria, region names) still run.
        rules: { 'color-contrast': { enabled: false } },
      });
      const summary = results.violations
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
        .join('\n');
      expect(results.violations, `axe violations:\n${summary}`).toEqual([]);
    } finally {
      host.remove();
      http.verify();
    }
  });
});
