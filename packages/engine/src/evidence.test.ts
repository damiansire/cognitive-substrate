import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { slugify, evidenceStamp, recordRun, buildTaskEvidenceIndex, findEvidenceForTask } from './evidence';
import type { Verdict } from './types';

let workspace: string;
beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-evi-'));
});
afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
});

describe('slugify', () => {
    it('produces a filesystem-safe slug', () => {
        expect(slugify('- [ ] Crear público/índice.html!')).toMatch(/^[a-z0-9-]+$/);
    });
    it('falls back to "task" for empty input', () => {
        expect(slugify('!!!')).toBe('task');
    });
});

describe('evidenceStamp', () => {
    it('removes colons and dots so it is path-safe', () => {
        const stamp = evidenceStamp(new Date('2026-06-29T22:15:16.123Z'));
        expect(stamp).not.toContain(':');
        expect(stamp).not.toContain('.');
    });
});

describe('recordRun', () => {
    it('writes run.json and summary.md and returns a workspace-relative path', () => {
        const verdict: Verdict = {
            verified: true,
            reason: 'todo ok',
            checks: [{ name: 'c1', passed: true, detail: 'd' }]
        };
        const record = recordRun({
            workspacePath: workspace,
            task: '- [ ] Hacer algo',
            startedAt: new Date('2026-06-29T22:00:00Z'),
            finishedAt: new Date('2026-06-29T22:00:05Z'),
            executionSuccess: true,
            verdict,
            log: 'hice algo',
            learning: 'aprendí algo'
        });

        expect(record.evidencePath.startsWith('runs')).toBe(true);
        const absDir = path.resolve(workspace, record.evidencePath);
        expect(fs.existsSync(path.join(absDir, 'run.json'))).toBe(true);
        expect(fs.existsSync(path.join(absDir, 'summary.md'))).toBe(true);

        const parsed = JSON.parse(fs.readFileSync(path.join(absDir, 'run.json'), 'utf8'));
        expect(parsed.verdict.verified).toBe(true);
        expect(parsed.learning).toBe('aprendí algo');
    });

    it('persists taskId in run.json when provided, and omits it when not', () => {
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        const withId = recordRun({
            workspacePath: workspace,
            task: '- [ ] Con id',
            startedAt: new Date('2026-06-29T22:00:00Z'),
            finishedAt: new Date('2026-06-29T22:00:01Z'),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a',
            taskId: 'task-1'
        });
        expect(withId.taskId).toBe('task-1');

        const withoutId = recordRun({
            workspacePath: workspace,
            task: '- [ ] Sin id',
            startedAt: new Date('2026-06-29T22:01:00Z'),
            finishedAt: new Date('2026-06-29T22:01:01Z'),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a'
        });
        expect(withoutId.taskId).toBeUndefined();
    });
});

describe('buildTaskEvidenceIndex / findEvidenceForTask', () => {
    const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };

    it('keeps the most recent evidencePath per taskId', () => {
        const older = recordRun({
            workspacePath: workspace,
            task: '- [ ] Tarea recurrente',
            startedAt: new Date('2026-06-29T22:00:00Z'),
            finishedAt: new Date('2026-06-29T22:00:01Z'),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a',
            taskId: 'task-recurring'
        });
        const newer = recordRun({
            workspacePath: workspace,
            task: '- [ ] Tarea recurrente',
            startedAt: new Date('2026-06-29T23:00:00Z'),
            finishedAt: new Date('2026-06-29T23:00:01Z'),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a',
            taskId: 'task-recurring'
        });

        const found = findEvidenceForTask(workspace, 'task-recurring');
        expect(found).toBe(newer.evidencePath);
        expect(found).not.toBe(older.evidencePath);
    });

    it('returns null for an unknown task id', () => {
        expect(findEvidenceForTask(workspace, 'nope')).toBeNull();
    });

    it('builds an index covering every taskId seen across runs', () => {
        recordRun({
            workspacePath: workspace,
            task: '- [ ] A',
            startedAt: new Date('2026-06-29T22:00:00Z'),
            finishedAt: new Date('2026-06-29T22:00:01Z'),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a',
            taskId: 'task-a'
        });
        recordRun({
            workspacePath: workspace,
            task: '- [ ] B',
            startedAt: new Date('2026-06-29T22:05:00Z'),
            finishedAt: new Date('2026-06-29T22:05:01Z'),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a',
            taskId: 'task-b'
        });

        const index = buildTaskEvidenceIndex(workspace);
        expect(index.has('task-a')).toBe(true);
        expect(index.has('task-b')).toBe(true);
    });
});
