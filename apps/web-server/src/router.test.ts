import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleApiRequest } from './router';
import { recordRun, parseTasks } from '@cognitive-substrate/engine';
import { ApprovalStore, loadPolicy } from '@cognitive-substrate/governance';
import type { Verdict } from '@cognitive-substrate/engine';

function call(root: string, method: string, pathname: string, query: Record<string, string> = {}, body?: unknown) {
    return handleApiRequest(root, method, pathname, new URLSearchParams(query), body);
}

let root: string;
let savedKey: string | undefined;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-web-server-'));
    fs.writeFileSync(
        path.join(root, 'tasks.md'),
        '# Plan\n\n## [now]\n- [ ] Tarea A\n\n## [next]\n\n## [blocked]\n\n## [improve]\n\n## [recurring]\n'
    );
    savedKey = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY']; // deterministic heuristic mode for /ask
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (savedKey !== undefined) process.env['GEMINI_API_KEY'] = savedKey;
});

describe('GET /api/workspaces', () => {
    it('lists the local workspace with its home summary', async () => {
        const res = await call(root, 'GET', '/api/workspaces');
        expect(res.status).toBe(200);
        const payload = res.payload as { workspaces: Array<{ project: string; home: { pendingNow: number } }> };
        expect(payload.workspaces).toHaveLength(1);
        expect(payload.workspaces[0]?.home.pendingNow).toBe(1);
    });

    it('rejects non-GET on the collection route', async () => {
        expect((await call(root, 'POST', '/api/workspaces')).status).toBe(405);
    });
});

describe('GET /api/workspaces/:project/inbox and /board', () => {
    it('404s for an unknown project', async () => {
        const res = await call(root, 'GET', '/api/workspaces/nope/inbox');
        expect(res.status).toBe(404);
    });

    it('returns inbox items (approval + incident) for a real project', async () => {
        const project = path.basename(root);
        new ApprovalStore(root).request({
            workspace: project,
            task: '- [ ] Tarea A',
            command: 'rm -rf build',
            reason: 'peligroso',
            risk: 'dangerous'
        });
        const res = await call(root, 'GET', `/api/workspaces/${project}/inbox`);
        expect(res.status).toBe(200);
        const payload = res.payload as { items: unknown[] };
        expect(payload.items).toHaveLength(1);
    });

    it('returns the board grouped by queue, with evidence per task', async () => {
        const project = path.basename(root);
        const res = await call(root, 'GET', `/api/workspaces/${project}/board`);
        expect(res.status).toBe(200);
        const payload = res.payload as {
            board: { now: Array<{ line: string; taskId: string | null; evidencePath: string | null }> };
        };
        expect(payload.board.now[0]?.line).toBe('- [ ] Tarea A');
        expect(payload.board.now[0]?.evidencePath).toBeNull();
    });

    it('resolves the evidencePath of a task-id-annotated task that has a run', async () => {
        const project = path.basename(root);
        fs.writeFileSync(
            path.join(root, 'tasks.md'),
            '# Plan\n\n## [now]\n- [ ] Con evidencia (task-id:task-1)\n\n## [next]\n\n## [blocked]\n\n## [improve]\n\n## [recurring]\n'
        );
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        const record = recordRun({
            workspacePath: root,
            task: '- [ ] Con evidencia (task-id:task-1)',
            startedAt: new Date('2026-06-30T10:00:00Z'),
            finishedAt: new Date('2026-06-30T10:00:05Z'),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a',
            taskId: 'task-1'
        });

        const res = await call(root, 'GET', `/api/workspaces/${project}/board`);
        const payload = res.payload as {
            board: { now: Array<{ taskId: string | null; evidencePath: string | null }> };
        };
        expect(payload.board.now[0]?.evidencePath).toBe(record.evidencePath);
    });
});

describe('GET /api/workspaces/:project/sessions', () => {
    it('404s when there is no run yet', async () => {
        const project = path.basename(root);
        const res = await call(root, 'GET', `/api/workspaces/${project}/sessions`);
        expect(res.status).toBe(404);
    });

    it('returns the latest run by default', async () => {
        const project = path.basename(root);
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        const record = recordRun({
            workspacePath: root,
            task: '- [ ] Tarea A',
            startedAt: new Date('2026-07-01T00:00:00Z'),
            finishedAt: new Date('2026-07-01T00:00:05Z'),
            executionSuccess: true,
            verdict,
            log: 'log',
            learning: ''
        });
        const res = await call(root, 'GET', `/api/workspaces/${project}/sessions`);
        expect(res.status).toBe(200);
        const payload = res.payload as { record: { task: string } | null };
        expect(payload.record?.task).toBe('- [ ] Tarea A');
        expect(record.evidencePath).toBeTruthy();
    });

    it('rejects a traversal ?path= with 400 and never leaks a run outside the workspace', async () => {
        const project = path.basename(root);
        // Plant a genuine exfil target OUTSIDE the workspace: a sibling dir with a
        // summary.md, which pre-fix getSessionTrace would happily read via ?path=../evil.
        const evilDir = path.join(root, '..', `csos-evil-${path.basename(root)}`);
        fs.mkdirSync(evilDir, { recursive: true });
        fs.writeFileSync(path.join(evilDir, 'summary.md'), 'TOP SECRET');
        try {
            for (const evil of [
                '../../../../etc/passwd',
                `../${path.basename(evilDir)}`,
                '..\\..\\windows\\win.ini',
                '/etc/hosts',
                'goal.md' // in-workspace but not under runs/ — still rejected
            ]) {
                const res = await call(root, 'GET', `/api/workspaces/${project}/sessions`, { path: evil });
                expect(res.status).toBe(400);
                expect(JSON.stringify(res.payload)).not.toContain('TOP SECRET');
            }
        } finally {
            fs.rmSync(evilDir, { recursive: true, force: true });
        }
    });
});

describe('POST /api/workspaces/:project/ask', () => {
    it('classifies text and queues a [now] task, returning the interpretation', async () => {
        const project = path.basename(root);
        const res = await call(root, 'POST', `/api/workspaces/${project}/ask`, undefined, {
            text: 'Arreglar el bug del login'
        });
        expect(res.status).toBe(200);
        const payload = res.payload as { interpretation: { verb: string; mode: string }; message: string };
        expect(payload.interpretation.verb).toBe('hacer');
        expect(payload.message).toContain('Arreglar el bug del login');

        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.now.some((l) => l.includes('Arreglar el bug del login'))).toBe(true);
    });

    it('an "automatizar"-classified request queues [recurring], not [now]', async () => {
        const project = path.basename(root);
        const res = await call(root, 'POST', `/api/workspaces/${project}/ask`, undefined, {
            text: 'automatizá el backup semanal'
        });
        const payload = res.payload as { interpretation: { verb: string } };
        expect(payload.interpretation.verb).toBe('automatizar');

        const tasks = parseTasks(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'));
        expect(tasks.recurring.some((l) => l.includes('automatizá el backup semanal'))).toBe(true);
    });

    it('400s on a missing/empty text field', async () => {
        const project = path.basename(root);
        expect((await call(root, 'POST', `/api/workspaces/${project}/ask`, undefined, {})).status).toBe(400);
        expect((await call(root, 'POST', `/api/workspaces/${project}/ask`, undefined, { text: '   ' })).status).toBe(
            400
        );
    });

    it('404s for an unknown project', async () => {
        const res = await call(root, 'POST', '/api/workspaces/nope/ask', undefined, { text: 'algo' });
        expect(res.status).toBe(404);
    });

    it('rejects non-POST', async () => {
        const project = path.basename(root);
        expect((await call(root, 'GET', `/api/workspaces/${project}/ask`)).status).toBe(405);
    });
});

describe('POST /api/workspaces/:project/approvals/:id/resolve', () => {
    it('resolves a pending approval for real and requeues the task on approve', async () => {
        const project = path.basename(root);
        const approval = new ApprovalStore(root).request({
            workspace: project,
            task: '- [ ] Tarea A',
            command: 'rm -rf build',
            reason: 'peligroso',
            risk: 'dangerous'
        });

        const res = await call(root, 'POST', `/api/workspaces/${project}/approvals/${approval.id}/resolve`, undefined, {
            action: 'approve',
            scope: 'always'
        });
        expect(res.status).toBe(200);
        expect(loadPolicy(root).allow).toContain('rm -rf build');
    });

    it('400s on a malformed body', async () => {
        const project = path.basename(root);
        const res = await call(root, 'POST', `/api/workspaces/${project}/approvals/whatever/resolve`, undefined, {
            action: 'not-a-real-action'
        });
        expect(res.status).toBe(400);
    });

    it('404s for an unknown approval id', async () => {
        const project = path.basename(root);
        const res = await call(root, 'POST', `/api/workspaces/${project}/approvals/does-not-exist/resolve`, undefined, {
            action: 'approve',
            scope: 'once'
        });
        expect(res.status).toBe(404);
    });
});

describe('unknown routes', () => {
    it('404s for anything outside /api/workspaces', async () => {
        expect((await call(root, 'GET', '/api/other')).status).toBe(404);
        expect((await call(root, 'GET', '/')).status).toBe(404);
    });
});

describe('GET /api/workspaces/:project/kpis', () => {
    it('returns real KPIs derived from runs on disk', async () => {
        const project = path.basename(root);
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        recordRun({
            workspacePath: root,
            task: '- [ ] Tarea A',
            startedAt: new Date(),
            finishedAt: new Date(),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a'
        });
        const res = await call(root, 'GET', `/api/workspaces/${project}/kpis`);
        expect(res.status).toBe(200);
        const payload = res.payload as { kpis: { runsTotal: number; periodDays: number } };
        expect(payload.kpis.runsTotal).toBe(1);
        expect(payload.kpis.periodDays).toBe(7);
    });

    it('honors ?days= and falls back to 7 for a malformed value', async () => {
        const project = path.basename(root);
        const res = await call(root, 'GET', `/api/workspaces/${project}/kpis`, { days: '30' });
        expect((res.payload as { kpis: { periodDays: number } }).kpis.periodDays).toBe(30);

        const malformed = await call(root, 'GET', `/api/workspaces/${project}/kpis`, { days: 'nope' });
        expect((malformed.payload as { kpis: { periodDays: number } }).kpis.periodDays).toBe(7);
    });
});

describe('GET /api/departments and /api/portfolio', () => {
    it('groups the local workspace under "sin-departamento" when nothing is configured', async () => {
        const res = await call(root, 'GET', '/api/departments');
        expect(res.status).toBe(200);
        const payload = res.payload as { departments: Array<{ department: string; workspaces: string[] }> };
        expect(payload.departments).toHaveLength(1);
        expect(payload.departments[0]?.department).toBe('sin-departamento');
        expect(payload.departments[0]?.workspaces).toEqual([path.basename(root)]);
    });

    it('returns one portfolio row per workspace', async () => {
        const res = await call(root, 'GET', '/api/portfolio');
        expect(res.status).toBe(200);
        const payload = res.payload as { portfolio: Array<{ project: string }> };
        expect(payload.portfolio).toHaveLength(1);
        expect(payload.portfolio[0]?.project).toBe(path.basename(root));
    });

    it('rejects non-GET', async () => {
        expect((await call(root, 'POST', '/api/departments')).status).toBe(405);
        expect((await call(root, 'POST', '/api/portfolio')).status).toBe(405);
    });
});

describe('GET /api/workspaces/:project/artifacts', () => {
    it('lists real files, including run evidence', async () => {
        const project = path.basename(root);
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        recordRun({
            workspacePath: root,
            task: '- [ ] A',
            startedAt: new Date(),
            finishedAt: new Date(),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a'
        });
        const res = await call(root, 'GET', `/api/workspaces/${project}/artifacts`);
        expect(res.status).toBe(200);
        const payload = res.payload as { artifacts: Array<{ kind: string }> };
        expect(payload.artifacts.some((a) => a.kind === 'run-evidence')).toBe(true);
    });
});

describe('GET /api/workspaces/:project/environment', () => {
    it('reflects local coordination mode and real claims', async () => {
        const project = path.basename(root);
        const res = await call(root, 'GET', `/api/workspaces/${project}/environment`);
        expect(res.status).toBe(200);
        const payload = res.payload as { coordinationMode: string; claims: unknown[] };
        expect(payload.coordinationMode).toBe('local');
        expect(payload.claims).toEqual([]);
    });
});

describe('GET /api/workspaces/:project/learning', () => {
    it('combines the improve queue and skills, with no eval report by default', async () => {
        const project = path.basename(root);
        const res = await call(root, 'GET', `/api/workspaces/${project}/learning`);
        expect(res.status).toBe(200);
        const payload = res.payload as { improveQueue: unknown[]; latestEvalReport: unknown };
        expect(payload.improveQueue).toEqual([]);
        expect(payload.latestEvalReport).toBeNull();
    });

    it('honors CSOS_EVALS_REPORT_DIR when set', async () => {
        const project = path.basename(root);
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-evals-report-'));
        fs.writeFileSync(
            path.join(reportDir, 'report.json'),
            JSON.stringify({
                generatedAt: '2026-07-01T00:00:00.000Z',
                simulation: true,
                total: 1,
                passed: 1,
                passRate: 1
            })
        );
        const saved = process.env['CSOS_EVALS_REPORT_DIR'];
        process.env['CSOS_EVALS_REPORT_DIR'] = reportDir;
        try {
            const res = await call(root, 'GET', `/api/workspaces/${project}/learning`);
            const payload = res.payload as { latestEvalReport: { total: number } | null };
            expect(payload.latestEvalReport?.total).toBe(1);
        } finally {
            if (saved === undefined) delete process.env['CSOS_EVALS_REPORT_DIR'];
            else process.env['CSOS_EVALS_REPORT_DIR'] = saved;
            fs.rmSync(reportDir, { recursive: true, force: true });
        }
    });
});
