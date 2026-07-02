import { describe, it, expect } from 'vitest';
import { htmlToText, browserTools, type FetchLike, type BrowserDriver, loadBrowserDriver } from './index';

const noDriver = async () => null;

describe('htmlToText', () => {
    it('strips tags, scripts and styles and keeps visible text', () => {
        const html = `<html><head><style>.x{}</style><script>evil()</script></head>
            <body><h1>Título</h1><p>Hola &amp; chau</p></body></html>`;
        const text = htmlToText(html);
        expect(text).toContain('Título');
        expect(text).toContain('Hola & chau');
        expect(text).not.toContain('evil()');
        expect(text).not.toContain('<');
    });
});

describe('browserTools.fetchText — raw fetch fallback (no driver)', () => {
    it('returns extracted text from a fetched page (injected fetch)', async () => {
        const fakeFetch: FetchLike = async () => ({
            ok: true,
            status: 200,
            text: async () => '<p>Contenido de prueba</p>'
        });
        const out = await browserTools.fetchText('https://example.com', fakeFetch, noDriver);
        expect(out).toContain('Contenido de prueba');
    });

    it('surfaces an HTTP error status', async () => {
        const fakeFetch: FetchLike = async () => ({ ok: false, status: 404, text: async () => '' });
        const out = await browserTools.fetchText('https://example.com/missing', fakeFetch, noDriver);
        expect(out).toContain('HTTP 404');
    });
});

describe('browserTools.fetchText — rendered path (driver present)', () => {
    it('prefers the driver and returns rendered text', async () => {
        let navigated = '';
        let closed = false;
        const fakeDriver: BrowserDriver = {
            async navigate(url) {
                navigated = url;
            },
            async readText() {
                return 'TEXTO RENDERIZADO POR JS';
            },
            async click() {},
            async type() {},
            async screenshot() {},
            async close() {
                closed = true;
            }
        };
        const neverFetch: FetchLike = async () => {
            throw new Error('no debería usar fetch');
        };
        const out = await browserTools.fetchText('https://spa.example', neverFetch, async () => fakeDriver);
        expect(out).toContain('TEXTO RENDERIZADO POR JS');
        expect(navigated).toBe('https://spa.example');
        expect(closed).toBe(true); // driver always closed
    });
});

describe('loadBrowserDriver (fail-safe)', () => {
    it('returns null when Playwright is not installed (no crash)', async () => {
        // Playwright is an optional dependency and not installed in CI.
        await expect(loadBrowserDriver()).resolves.toBeNull();
    });
});
