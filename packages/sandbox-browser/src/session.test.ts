import { describe, it, expect } from 'vitest';
import { BrowserSession } from './session';
import type { BrowserDriver } from './driver';

function fakeDriver() {
    const calls: string[] = [];
    let closed = false;
    const driver: BrowserDriver = {
        async navigate(url) {
            calls.push(`navigate:${url}`);
        },
        async readText() {
            calls.push('readText');
            return 'contenido de la página';
        },
        async click(sel) {
            calls.push(`click:${sel}`);
        },
        async type(sel, text) {
            calls.push(`type:${sel}=${text}`);
        },
        async screenshot(p) {
            calls.push(`shot:${p}`);
        },
        async close() {
            closed = true;
        }
    };
    return { driver, calls, isClosed: () => closed };
}

describe('BrowserSession (with driver)', () => {
    it('keeps one driver across calls and closes it once', async () => {
        const fake = fakeDriver();
        const session = new BrowserSession(async () => fake.driver);

        expect(await session.navigate('https://x.test')).toContain('OK');
        expect(await session.readText()).toContain('contenido');
        expect(await session.click('#btn')).toContain('OK');
        expect(await session.type('#in', 'hola')).toContain('OK');
        await session.close();

        expect(fake.calls).toEqual(['navigate:https://x.test', 'readText', 'click:#btn', 'type:#in=hola']);
        expect(fake.isClosed()).toBe(true);
    });
});

describe('BrowserSession (no driver — fail-safe)', () => {
    it('returns an explanatory message for every action instead of throwing', async () => {
        const session = new BrowserSession(async () => null);
        expect(await session.isAvailable()).toBe(false);
        expect(await session.navigate('https://x.test')).toContain('Playwright');
        expect(await session.readText()).toContain('Playwright');
        expect(await session.click('#x')).toContain('Playwright');
        await session.close(); // safe no-op
    });
});
