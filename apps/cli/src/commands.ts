import {
    resolveWorkspaces,
    getHomeSummary,
    getInboxItems,
    getBoard,
    getSessionTrace,
    getLatestRunPath,
    handleAsk,
    type AskInterpretation,
    resolveApprovalAction
} from '@cognitive-substrate/engine';
import { ApprovalStore, type ResolveInput } from '@cognitive-substrate/governance';

/**
 * Real subcommands over the same read-model the TUI (apps/tui) uses, replacing the old
 * fixed 2-question wizard as the CLI's day-2 surface. `resolveWorkspaces` itself lives
 * in `@cognitive-substrate/engine` so neither interface re-implements it.
 */

export function cmdStatus(rootDir: string): void {
    const workspaces = resolveWorkspaces(rootDir);
    if (workspaces.length === 0) {
        console.log('No hay workspaces todavía. Corré el CLI sin argumentos para inicializar uno.');
        return;
    }
    console.log('\n=== Estado ===\n');
    for (const ws of workspaces) {
        const s = getHomeSummary(ws.path, ws.project);
        console.log(
            `[${s.project}] now=${s.pendingNow} next=${s.pendingNext} blocked=${s.blocked} ` +
                `aprobaciones=${s.pendingApprovals} incidentes=${s.incidents}`
        );
        if (s.lastRun) {
            const mark = s.lastRun.verdict.verified ? '✅' : '❌';
            console.log(`   último run: ${mark} ${s.lastRun.task.trim()} (${s.lastRun.evidencePath})`);
        }
    }
    console.log('');
}

export function cmdInbox(rootDir: string): void {
    const workspaces = resolveWorkspaces(rootDir);
    const items = workspaces.flatMap((ws) => getInboxItems(ws.path, ws.project));
    if (items.length === 0) {
        console.log('\nInbox vacío. Nada esperando tu atención.\n');
        return;
    }
    console.log('\n=== Inbox ===\n');
    for (const item of items) {
        if (item.kind === 'approval') {
            console.log(`[${item.project}] 🔒 APROBACIÓN (${item.approval.id}): ${item.approval.command}`);
            console.log(`   razón: ${item.approval.reason} | tarea: ${item.approval.task.trim()}`);
        } else {
            const icon = item.incident.severity === 'error' ? '❌' : '⚠️';
            console.log(`[${item.project}] ${icon} ${item.incident.task}: ${item.incident.reason}`);
        }
    }
    console.log('\nUsá `approve <id>` para resolver una aprobación pendiente.\n');
}

const QUEUE_ORDER = ['now', 'next', 'blocked', 'improve', 'recurring'] as const;

export function cmdBoard(rootDir: string): void {
    const workspaces = resolveWorkspaces(rootDir);
    console.log('\n=== Tablero ===\n');
    for (const ws of workspaces) {
        const board = getBoard(ws.path);
        console.log(`[${ws.project}]`);
        for (const queue of QUEUE_ORDER) {
            if (board[queue].length === 0) continue;
            console.log(`  ${queue}:`);
            for (const line of board[queue]) console.log(`    ${line}`);
        }
    }
    console.log('');
}

export function cmdSession(rootDir: string, idOrLatest: string | undefined): void {
    const workspaces = resolveWorkspaces(rootDir);
    for (const ws of workspaces) {
        const evidencePath = idOrLatest && idOrLatest !== 'latest' ? idOrLatest : getLatestRunPath(ws.path);
        if (!evidencePath) continue;
        const trace = getSessionTrace(ws.path, evidencePath);
        if (!trace.record) continue;
        console.log(`\n=== Sesión: ${ws.project} / ${evidencePath} ===\n`);
        console.log(trace.summaryMd ?? '(sin summary.md)');
        return;
    }
    console.log('No se encontró ninguna sesión todavía.');
}

/** Lists pending approvals across all workspaces (no id), or resolves one by id. */
export async function cmdApprove(
    rootDir: string,
    id: string | undefined,
    prompt: (question: string) => Promise<string>
): Promise<void> {
    const workspaces = resolveWorkspaces(rootDir);

    if (!id) {
        const pending = workspaces.flatMap((ws) =>
            new ApprovalStore(ws.path).listPending().map((approval) => ({ ws, approval }))
        );
        if (pending.length === 0) {
            console.log('\nNo hay aprobaciones pendientes.\n');
            return;
        }
        console.log('\n=== Aprobaciones pendientes ===\n');
        for (const { ws, approval } of pending) {
            console.log(`[${ws.project}] ${approval.id}: ${approval.command}`);
            console.log(`   razón: ${approval.reason} | tarea: ${approval.task.trim()}`);
        }
        console.log('\nUsá `approve <id>` para resolver una.\n');
        return;
    }

    const found = workspaces.flatMap((ws) => {
        const approval = new ApprovalStore(ws.path).listAll().find((a) => a.id === id);
        return approval ? [{ ws, approval }] : [];
    })[0];

    if (!found) {
        console.log(`No se encontró la aprobación ${id}.`);
        return;
    }
    const { ws, approval } = found;

    console.log(`\n[${ws.project}] ${approval.command}`);
    console.log(`razón: ${approval.reason}\ntarea: ${approval.task.trim()}\n`);

    const actionRaw = (await prompt('Acción: [a]probar / [d]enegar / [m]odificar > ')).trim().toLowerCase();
    const action: ResolveInput['action'] | null = actionRaw.startsWith('a')
        ? 'approve'
        : actionRaw.startsWith('d')
          ? 'deny'
          : actionRaw.startsWith('m')
            ? 'modify'
            : null;
    if (!action) {
        console.log('Acción no reconocida, cancelado.');
        return;
    }

    let modifiedCommand: string | undefined;
    if (action === 'modify') {
        modifiedCommand = (await prompt('Comando modificado (queda registrado, no se re-ejecuta solo): ')).trim();
    }

    let scope: ResolveInput['scope'] = 'once';
    if (action !== 'modify') {
        const scopeRaw = (await prompt('Alcance: [o]nce / [s]iempre > ')).trim().toLowerCase();
        scope = scopeRaw.startsWith('s') ? 'always' : 'once';
    }

    resolveApprovalAction(ws.path, approval.id, { action, scope, modifiedCommand });
    if (action === 'approve') {
        console.log('✅ Aprobado. La tarea vuelve a [now] y se retoma en el próximo tick.');
    } else {
        console.log(`Resuelto: ${action}.`);
    }
}

export interface AskResult {
    action: 'control' | 'intake';
    message: string;
    /** The inferred verb/mode — undefined only for the local `aprobar`/`denegar`/
     * `estado` shortcuts below, which never reach the classifier. */
    interpretation?: AskInterpretation;
}

/**
 * Ask-bar entry point. `aprobar`/`denegar`/`estado` stay local regex shortcuts — they're
 * precise commands with concrete side effects (point at `approve <id>`, or run
 * `status`), not fuzzy intent to classify. Everything else goes through
 * `@cognitive-substrate/engine`'s `handleAsk` (real NLU via Gemini when an API key is
 * configured, a 12-verb heuristic fallback otherwise), shared verbatim with the web ask
 * bar and the TUI so the classification isn't reimplemented three times.
 */
export async function cmdAsk(rootDir: string, text: string): Promise<AskResult> {
    const lowered = text.toLowerCase();

    if (/\b(aprobar|apruebo)\b/.test(lowered)) {
        return { action: 'control', message: 'Usá `approve <id>` para aprobar (hace falta el id — mirá `inbox`).' };
    }
    if (/\b(denegar|deniego|rechazar)\b/.test(lowered)) {
        return { action: 'control', message: 'Usá `approve <id>` para denegar (hace falta el id — mirá `inbox`).' };
    }
    if (/\b(estado|status)\b/.test(lowered)) {
        cmdStatus(rootDir);
        return { action: 'control', message: '' };
    }

    const workspaces = resolveWorkspaces(rootDir);
    const target = workspaces[0];
    const outcome = await handleAsk(target ? target.path : rootDir, text);
    const action: AskResult['action'] = outcome.interpretation.verb === 'detener' ? 'control' : 'intake';
    return { action, message: outcome.message, interpretation: outcome.interpretation };
}
