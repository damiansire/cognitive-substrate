import type { WorkspaceResult } from './types';

export interface DashboardInput {
    mode: 'local' | 'global';
    updatedAt: Date;
    results: WorkspaceResult[];
}

/**
 * Renders the human-facing control dashboard as markdown. Pure function: the
 * orchestrator gathers per-workspace results and this turns them into the
 * `dashboard.md` the CHARTER calls for ("show the activity to a human").
 */
export function renderDashboard(input: DashboardInput): string {
    const { mode, updatedAt, results } = input;
    const totalPending = results.reduce((acc, r) => acc + r.pendingNow, 0);
    const runsThisTick = results.filter((r) => r.run).length;
    const verified = results.filter((r) => r.run?.verdict.verified).length;
    const totalIncidents = results.reduce((acc, r) => acc + r.incidents, 0);

    const lines: string[] = [
        '# Dashboard de Control — Cognitive Substrate OS',
        '',
        `- **Modo:** ${mode === 'global' ? 'Daemon Global' : 'Agente Local'}`,
        `- **Última actualización:** ${updatedAt.toISOString()}`,
        `- **Workspaces:** ${results.length}`,
        `- **Tareas [now] pendientes:** ${totalPending}`,
        `- **Runs este tick:** ${runsThisTick} (verificados: ${verified})`,
        `- **Incidentes acumulados:** ${totalIncidents}`,
        '',
        '## Workspaces',
        ''
    ];

    if (results.length === 0) {
        lines.push('_(sin workspaces con tareas)_');
    } else {
        lines.push('| Proyecto | [now] pendientes | Incidentes | Último run | Evidencia |');
        lines.push('| --- | --- | --- | --- | --- |');
        for (const r of results) {
            const run = r.run;
            const last = run ? `${run.verdict.verified ? '✅' : '❌'} ${truncate(run.task, 50)}` : '—';
            const evidence = run ? `\`${run.evidencePath}\`` : '—';
            lines.push(`| ${r.project} | ${r.pendingNow} | ${r.incidents} | ${last} | ${evidence} |`);
        }
    }

    lines.push('', '## Últimas acciones', '');
    const actions = results.filter((r) => r.summary).map((r) => `- ${r.summary}`);
    lines.push(actions.length > 0 ? actions.join('\n') : '_(ninguna acción este tick)_');
    lines.push('');

    return lines.join('\n');
}

function truncate(text: string, max: number): string {
    const t = text.replace(/^-\s*\[[ x!]\]\s*/, '').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
