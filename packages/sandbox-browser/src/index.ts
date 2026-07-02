/**
 * Browser-domain adapter (read-only web access).
 *
 * Implements the most useful, dependency-free browser primitive: fetch a page and
 * extract its visible text. Interactive automation (click/type/screenshot) is defined
 * by the `BrowserDriver` interface so a Playwright-backed driver can be plugged in
 * later without touching callers. Network egress is the caller's responsibility to
 * gate (see governance `decideUrl`) — this adapter just performs the fetch it's given.
 */

export const MAX_TEXT_BYTES = 20_000;
const FETCH_TIMEOUT_MS = 15_000;

/** Minimal fetch signature so tests can inject a fake without DOM/network. */
export type FetchLike = (
    url: string,
    init?: { signal?: AbortSignal }
) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
}>;

/**
 * Converts an HTML document into readable plain text: drops script/style, strips tags,
 * decodes a few common entities, and collapses whitespace. Pure and unit-tested.
 */
export function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*/g, '\n\n')
        .trim();
}

export * from './driver';
export * from './session';
import { type BrowserDriver, loadBrowserDriver } from './driver';

function truncate(text: string): string {
    return text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) + '\n…[truncado]' : text;
}

export const browserTools = {
    /**
     * Fetches a URL and returns its visible text (truncated).
     *
     * Render-capable: if a Playwright driver is available it renders the page (JS
     * included) and reads the rendered text; otherwise it falls back to a raw HTTP fetch
     * + HTML-to-text. `fetchImpl`/`driverFactory` are injectable for testing. The caller
     * must already have authorized the URL via the governance egress gate.
     */
    async fetchText(
        url: string,
        fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
        driverFactory: () => Promise<BrowserDriver | null> = loadBrowserDriver
    ): Promise<string> {
        const driver = await driverFactory();
        if (driver) {
            try {
                await driver.navigate(url);
                return truncate(await driver.readText());
            } catch (e: any) {
                return `Error al renderizar la página: ${e?.message ?? String(e)}`;
            } finally {
                await driver.close();
            }
        }

        if (typeof fetchImpl !== 'function') {
            return 'Error: fetch no está disponible en este runtime.';
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetchImpl(url, { signal: controller.signal });
            if (!res.ok) return `Error: la página respondió HTTP ${res.status}.`;
            return truncate(htmlToText(await res.text()));
        } catch (e: any) {
            return `Error al obtener la página: ${e?.message ?? String(e)}`;
        } finally {
            clearTimeout(timer);
        }
    }
};
