import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeWorkspaceKpis } from './kpis';
import { recordRun } from './evidence';
import { recordIncident } from './incidents';
import { ApprovalStore } from '@cognitive-substrate/governance';
import type { Verdict } from './types';

let workspace: string;
beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csos-kpis-'));
});
afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
});

const NOW = new Date('2026-07-01T12:00:00Z');
const okVerdict: Verdict = { verified: true, reason: 'ok', checks: [] };
const failVerdict: Verdict = { verified: false, reason: 'no ok', checks: [] };

describe('computeWorkspaceKpis', () => {
    it('reports zeros (not NaN/null crashes) for an empty workspace', () => {
        const kpis = computeWorkspaceKpis(workspace, NOW, 7);
        expect(kpis).toEqual({
            periodDays: 7,
            runsTotal: 0,
            runsVerified: 0,
            runsFailed: 0,
            passRate: 0,
            avgDurationMs: null,
            incidentsInPeriod: 0,
            incidentsBySeverity: { warning: 0, error: 0 },
            approvalsRequested: 0,
            approvalsApproved: 0,
            approvalsDenied: 0,
            approvalsModified: 0,
            approvalsPending: 0
        });
    });

    it('computes pass rate and average duration from real runs', () => {
        recordRun({
            workspacePath: workspace,
            task: '- [ ] A',
            startedAt: new Date('2026-06-30T10:00:00Z'),
            finishedAt: new Date('2026-06-30T10:00:10Z'), // 10s
            executionSuccess: true,
            verdict: okVerdict,
            log: 'l',
            learning: 'a'
        });
        recordRun({
            workspacePath: workspace,
            task: '- [ ] B',
            startedAt: new Date('2026-06-30T11:00:00Z'),
            finishedAt: new Date('2026-06-30T11:00:30Z'), // 30s
            executionSuccess: false,
            verdict: failVerdict,
            log: 'l',
            learning: 'a'
        });

        const kpis = computeWorkspaceKpis(workspace, NOW, 7);
        expect(kpis.runsTotal).toBe(2);
        expect(kpis.runsVerified).toBe(1);
        expect(kpis.runsFailed).toBe(1);
        expect(kpis.passRate).toBe(0.5);
        expect(kpis.avgDurationMs).toBe(20_000); // (10s + 30s) / 2
    });

    it('excludes runs outside the trailing period window', () => {
        recordRun({
            workspacePath: workspace,
            task: '- [ ] Vieja',
            startedAt: new Date('2026-06-01T00:00:00Z'), // 30 days before NOW
            finishedAt: new Date('2026-06-01T00:00:05Z'),
            executionSuccess: true,
            verdict: okVerdict,
            log: 'l',
            learning: 'a'
        });

        const kpis = computeWorkspaceKpis(workspace, NOW, 7);
        expect(kpis.runsTotal).toBe(0);
    });

    it('counts incidents by severity within the window', () => {
        recordIncident(workspace, { severity: 'error', task: 'X', reason: 'r' }, new Date('2026-06-30T00:00:00Z'));
        recordIncident(workspace, { severity: 'warning', task: 'Y', reason: 'r' }, new Date('2026-06-30T00:00:00Z'));
        recordIncident(workspace, { severity: 'error', task: 'Z', reason: 'r' }, new Date('2026-06-01T00:00:00Z')); // out of window

        const kpis = computeWorkspaceKpis(workspace, NOW, 7);
        expect(kpis.incidentsInPeriod).toBe(2);
        expect(kpis.incidentsBySeverity).toEqual({ warning: 1, error: 1 });
    });

    it('breaks down approvals by status within the window', () => {
        const store = new ApprovalStore(workspace);
        const a = store.request(
            { workspace: 'demo', task: 'T', command: 'cmd1', reason: 'r', risk: 'medium' },
            new Date('2026-06-30T00:00:00Z')
        );
        store.resolve(a.id, { action: 'approve', scope: 'once' }, new Date('2026-06-30T01:00:00Z'));
        store.request(
            { workspace: 'demo', task: 'T2', command: 'cmd2', reason: 'r', risk: 'medium' },
            new Date('2026-06-30T00:00:00Z')
        );

        const kpis = computeWorkspaceKpis(workspace, NOW, 7);
        expect(kpis.approvalsRequested).toBe(2);
        expect(kpis.approvalsApproved).toBe(1);
        expect(kpis.approvalsPending).toBe(1);
        expect(kpis.approvalsDenied).toBe(0);
        expect(kpis.approvalsModified).toBe(0);
    });
});
