import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    getHomeSummary,
    getInboxItems,
    getBoard,
    getBoardWithEvidence,
    getSessionTrace,
    getLatestRunPath,
    getWorkspaceKpis,
    getDepartmentSummaries,
    getPortfolioComparison,
    listArtifacts,
    getEnvironmentSnapshot,
    getLatestEvalReport,
    getLearningSnapshot,
    resolveWorkspaces
} from './readModel';
import { recordRun } from './evidence';
import { recordIncident } from './incidents';
import { claimTask } from './claims';
import { ApprovalStore } from '@cognitive-substrate/governance';
import type { Verdict } from './types';

let workspace: string;
beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-readmodel-'));
});
afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
});

const SAMPLE_TASKS = `# Plan de Tareas

## [now]
- [ ] Tarea A

## [next]
- [ ] Tarea B

## [blocked]
- [ ] Tarea C (pending-approval:appr-1)

## [improve]

## [recurring]
`;

describe('resolveWorkspaces', () => {
    it('treats a directory with tasks.md as a single local workspace', () => {
        fs.writeFileSync(path.join(workspace, 'tasks.md'), '# Plan\n\n## [now]\n');
        const ws = resolveWorkspaces(workspace);
        expect(ws).toHaveLength(1);
        expect(ws[0].path).toBe(workspace);
    });

    it('discovers workspaces/* in global mode', () => {
        fs.mkdirSync(path.join(workspace, 'workspaces', 'alpha'), { recursive: true });
        fs.mkdirSync(path.join(workspace, 'workspaces', 'beta'), { recursive: true });
        const ws = resolveWorkspaces(workspace);
        expect(ws.map((w) => w.project).sort()).toEqual(['alpha', 'beta']);
    });

    it('is empty for a directory with neither', () => {
        expect(resolveWorkspaces(workspace)).toEqual([]);
    });
});

describe('getHomeSummary', () => {
    it('reflects an empty, freshly-created workspace', () => {
        const summary = getHomeSummary(workspace, 'demo');
        expect(summary).toEqual({
            project: 'demo',
            pendingNow: 0,
            pendingNext: 0,
            blocked: 0,
            pendingApprovals: 0,
            incidents: 0,
            lastRun: null
        });
    });

    it('aggregates tasks, approvals and incidents from real on-disk state', () => {
        fs.writeFileSync(path.join(workspace, 'tasks.md'), SAMPLE_TASKS);
        new ApprovalStore(workspace).request({
            workspace: 'demo',
            task: '- [ ] Tarea C',
            command: 'rm -rf build',
            reason: 'peligroso',
            risk: 'dangerous'
        });
        recordIncident(workspace, { severity: 'error', task: 'Tarea X', reason: 'falló' });

        const summary = getHomeSummary(workspace, 'demo');
        expect(summary.pendingNow).toBe(1);
        expect(summary.pendingNext).toBe(1);
        expect(summary.blocked).toBe(1);
        expect(summary.pendingApprovals).toBe(1);
        expect(summary.incidents).toBe(1);
    });

    it('surfaces the most recent run', () => {
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        recordRun({
            workspacePath: workspace,
            task: '- [ ] Tarea A',
            startedAt: new Date('2026-06-30T10:00:00Z'),
            finishedAt: new Date('2026-06-30T10:00:05Z'),
            executionSuccess: true,
            verdict,
            log: 'log',
            learning: 'aprendizaje'
        });
        const summary = getHomeSummary(workspace, 'demo');
        expect(summary.lastRun?.task).toBe('- [ ] Tarea A');
    });
});

describe('getInboxItems', () => {
    it('combines pending approvals and incidents into one list', () => {
        new ApprovalStore(workspace).request({
            workspace: 'demo',
            task: '- [ ] Tarea C',
            command: 'rm -rf build',
            reason: 'peligroso',
            risk: 'dangerous'
        });
        recordIncident(workspace, { severity: 'warning', task: 'Tarea Y', reason: 'incompleta' });

        const items = getInboxItems(workspace, 'demo');
        expect(items).toHaveLength(2);
        expect(items.some((i) => i.kind === 'approval')).toBe(true);
        expect(items.some((i) => i.kind === 'incident')).toBe(true);
        expect(items.every((i) => i.project === 'demo')).toBe(true);
    });

    it('is empty for a workspace with nothing pending', () => {
        expect(getInboxItems(workspace, 'demo')).toEqual([]);
    });
});

describe('getBoard', () => {
    it('returns the five queues parsed from tasks.md', () => {
        fs.writeFileSync(path.join(workspace, 'tasks.md'), SAMPLE_TASKS);
        const board = getBoard(workspace);
        expect(board.now).toHaveLength(1);
        expect(board.blocked[0]).toContain('pending-approval:appr-1');
    });
});

describe('getBoardWithEvidence', () => {
    it('resolves the evidencePath for a task-id that has a run, null for one that has none', () => {
        const tasks = `# Plan de Tareas

## [now]
- [ ] Con evidencia (task-id:task-1)
- [ ] Sin evidencia (task-id:task-2)

## [next]

## [blocked]

## [improve]

## [recurring]
`;
        fs.writeFileSync(path.join(workspace, 'tasks.md'), tasks);
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        const record = recordRun({
            workspacePath: workspace,
            task: '- [ ] Con evidencia (task-id:task-1)',
            startedAt: new Date('2026-06-30T10:00:00Z'),
            finishedAt: new Date('2026-06-30T10:00:05Z'),
            executionSuccess: true,
            verdict,
            log: 'log',
            learning: 'a',
            taskId: 'task-1'
        });

        const board = getBoardWithEvidence(workspace);
        const withEvidence = board.now.find((t) => t.taskId === 'task-1');
        const withoutEvidence = board.now.find((t) => t.taskId === 'task-2');

        expect(withEvidence?.evidencePath).toBe(record.evidencePath);
        expect(withoutEvidence?.evidencePath).toBeNull();
    });

    it('does not explode on a legacy line with no task-id annotation', () => {
        fs.writeFileSync(workspace + '/tasks.md', '# Plan\n\n## [now]\n- [ ] Tarea vieja sin id\n');
        const board = getBoardWithEvidence(workspace);
        expect(board.now[0]).toEqual({ line: '- [ ] Tarea vieja sin id', taskId: null, evidencePath: null });
    });
});

describe('getSessionTrace / getLatestRunPath', () => {
    it('returns null evidence when no run has happened yet', () => {
        expect(getLatestRunPath(workspace)).toBeNull();
    });

    it('drills down into the most recent run record + summary', () => {
        const verdict: Verdict = { verified: false, reason: 'no ok', checks: [] };
        const record = recordRun({
            workspacePath: workspace,
            task: '- [ ] Tarea A',
            startedAt: new Date('2026-06-30T10:00:00Z'),
            finishedAt: new Date('2026-06-30T10:00:05Z'),
            executionSuccess: false,
            verdict,
            log: 'algo salió mal',
            learning: ''
        });

        const latest = getLatestRunPath(workspace);
        expect(latest).toBe(record.evidencePath);

        const trace = getSessionTrace(workspace, latest!);
        expect(trace.record?.task).toBe('- [ ] Tarea A');
        expect(trace.summaryMd).toContain('NO VERIFICADO');
    });
});

describe('getWorkspaceKpis', () => {
    it('is a thin wrapper that reflects real runs', () => {
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        recordRun({
            workspacePath: workspace,
            task: '- [ ] A',
            startedAt: new Date(),
            finishedAt: new Date(),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a'
        });
        expect(getWorkspaceKpis(workspace, 7).runsTotal).toBe(1);
    });
});

describe('getDepartmentSummaries / getPortfolioComparison', () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-dept-'));
        fs.mkdirSync(path.join(root, 'workspaces', 'alpha'), { recursive: true });
        fs.mkdirSync(path.join(root, 'workspaces', 'beta'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'workspaces', 'alpha', 'governance.json'),
            JSON.stringify({ department: 'infra' })
        );
        // beta has no governance.json -> no department configured
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('groups workspaces without a configured department under "sin-departamento", not a dead end', () => {
        const summaries = getDepartmentSummaries(root);
        const names = summaries.map((s) => s.department).sort();
        expect(names).toEqual(['infra', 'sin-departamento']);

        const infra = summaries.find((s) => s.department === 'infra')!;
        expect(infra.workspaces).toEqual(['alpha']);
        const none = summaries.find((s) => s.department === 'sin-departamento')!;
        expect(none.workspaces).toEqual(['beta']);
    });

    it('aggregates real KPIs across the workspaces in a department', () => {
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        recordRun({
            workspacePath: path.join(root, 'workspaces', 'alpha'),
            task: '- [ ] A',
            startedAt: new Date(),
            finishedAt: new Date(),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a'
        });
        const infra = getDepartmentSummaries(root).find((s) => s.department === 'infra')!;
        expect(infra.kpis.runsTotal).toBe(1);
    });

    it('getPortfolioComparison returns one row per workspace, department attached only when configured', () => {
        const rows = getPortfolioComparison(root);
        expect(rows).toHaveLength(2);
        const alpha = rows.find((r) => r.project === 'alpha')!;
        const beta = rows.find((r) => r.project === 'beta')!;
        expect(alpha.department).toBe('infra');
        expect(beta.department).toBeUndefined();
    });
});

describe('listArtifacts', () => {
    it('lists files inside runs/ as run-evidence, tagged with their evidencePath', () => {
        const verdict: Verdict = { verified: true, reason: 'ok', checks: [] };
        const record = recordRun({
            workspacePath: workspace,
            task: '- [ ] A',
            startedAt: new Date(),
            finishedAt: new Date(),
            executionSuccess: true,
            verdict,
            log: 'l',
            learning: 'a'
        });

        const artifacts = listArtifacts(workspace);
        const runFiles = artifacts.filter((a) => a.kind === 'run-evidence');
        expect(runFiles.length).toBeGreaterThanOrEqual(2); // run.json + summary.md
        expect(runFiles.every((a) => a.runEvidencePath === record.evidencePath)).toBe(true);
    });

    it('lists top-level workspace files as workspace-file, excluding runs/.claims/.git/node_modules', () => {
        fs.writeFileSync(path.join(workspace, 'tasks.md'), '# Plan\n');
        fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
        fs.writeFileSync(path.join(workspace, '.git', 'HEAD'), 'ref: refs/heads/main\n');

        const artifacts = listArtifacts(workspace);
        expect(artifacts.some((a) => a.relPath === 'tasks.md' && a.kind === 'workspace-file')).toBe(true);
        expect(artifacts.some((a) => a.relPath.includes('.git'))).toBe(false);
    });

    it('caps the result at the given limit, most recently modified first', () => {
        for (let i = 0; i < 5; i++) {
            fs.writeFileSync(path.join(workspace, `f${i}.txt`), 'x');
        }
        expect(listArtifacts(workspace, 2)).toHaveLength(2);
    });
});

describe('getEnvironmentSnapshot', () => {
    it('reflects local coordination mode with no claims by default', () => {
        const snapshot = getEnvironmentSnapshot(workspace);
        expect(snapshot.coordinationMode).toBe('local');
        expect(snapshot.claims).toEqual([]);
    });

    it('reflects http coordination mode + endpoint from governance.json', () => {
        fs.writeFileSync(
            path.join(workspace, 'governance.json'),
            JSON.stringify({ coordination: { mode: 'http', endpoint: 'http://coord:9000' } })
        );
        const snapshot = getEnvironmentSnapshot(workspace);
        expect(snapshot.coordinationMode).toBe('http');
        expect(snapshot.coordinationEndpoint).toBe('http://coord:9000');
    });

    it('lists real claims from runs/.claims/', () => {
        claimTask(workspace, '- [ ] Tarea', 'worker-A');
        const snapshot = getEnvironmentSnapshot(workspace);
        expect(snapshot.claims).toHaveLength(1);
        expect(snapshot.claims[0].workerId).toBe('worker-A');
    });
});

describe('getLatestEvalReport / getLearningSnapshot', () => {
    it('returns null when report.json does not exist', () => {
        expect(getLatestEvalReport(workspace)).toBeNull();
    });

    it('returns null for a malformed report.json instead of throwing', () => {
        fs.writeFileSync(path.join(workspace, 'report.json'), '{ not json');
        expect(getLatestEvalReport(workspace)).toBeNull();
    });

    it('reads a real report.json summary', () => {
        fs.writeFileSync(
            path.join(workspace, 'report.json'),
            JSON.stringify({
                generatedAt: '2026-07-01T00:00:00.000Z',
                simulation: true,
                total: 10,
                passed: 8,
                passRate: 0.8,
                byCategory: {},
                results: []
            })
        );
        const report = getLatestEvalReport(workspace);
        expect(report).toEqual({
            generatedAt: '2026-07-01T00:00:00.000Z',
            simulation: true,
            total: 10,
            passed: 8,
            passRate: 0.8
        });
    });

    it('getLearningSnapshot combines the improve queue, skills, and eval report', () => {
        fs.writeFileSync(
            path.join(workspace, 'tasks.md'),
            '# Plan\n\n## [now]\n\n## [next]\n\n## [blocked]\n\n## [improve]\n- [ ] Revisar X\n\n## [recurring]\n'
        );
        const snapshot = getLearningSnapshot(workspace);
        expect(snapshot.improveQueue).toEqual(['- [ ] Revisar X']);
        // Not asserting an exact list: `discoverSkills` also reads the real machine's
        // global skills root (~/.gemini/config/skills), which is outside this test's
        // control — just confirm the workspace-local scan ran without throwing.
        expect(Array.isArray(snapshot.skills)).toBe(true);
        expect(snapshot.latestEvalReport).toBeNull();
    });
});
