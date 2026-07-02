import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendLearning, readKnowledge, distillLearning } from './memory';
import type { Verdict } from './types';

let root: string;
let savedKey: string | undefined;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-memory-'));
    savedKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
});

describe('appendLearning / readKnowledge', () => {
    it('round-trips a timestamped learning into knowledge.md', () => {
        appendLearning(root, 'Aprendí algo', new Date('2026-01-01T00:00:00Z'));
        expect(readKnowledge(root)).toContain('Aprendí algo');
    });

    it('is a no-op for empty learning text', () => {
        appendLearning(root, '   ', new Date());
        expect(readKnowledge(root)).toBe('');
    });
});

describe('distillLearning (simulation)', () => {
    const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };

    it('quotes the human-readable task text in the fallback', async () => {
        const lesson = await distillLearning('- [ ] Crear x.txt', verdict, 'log');
        expect(lesson).toContain('Crear x.txt');
    });

    it('never leaks the (task-id:...) bookkeeping annotation into the fallback', async () => {
        const lesson = await distillLearning('- [ ] Crear x.txt (task-id:task-123)', verdict, 'log');
        expect(lesson).toContain('Crear x.txt');
        expect(lesson).not.toContain('task-id');
    });
});
