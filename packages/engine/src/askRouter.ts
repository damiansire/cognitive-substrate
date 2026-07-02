import * as fs from 'fs';
import * as path from 'path';
import { interpretAsk, type AskInterpretation } from './ask';
import { appendTasksToNow, appendTaskToRecurring, buildTasksScaffold } from './tasks';

const TASKS_FILE = 'tasks.md';

const EMPTY_SCAFFOLD = [
    '# Plan de Tareas',
    '',
    '## [now]',
    '',
    '## [next]',
    '',
    '## [blocked]',
    '',
    '## [improve] - Auto-Mejora y Correcciones',
    '',
    '## [recurring]',
    ''
].join('\n');

export interface AskOutcome {
    interpretation: AskInterpretation;
    message: string;
}

/** Verbs with no existing execution surface to route to today (no "answer without
 * touching tasks.md" mode exists yet) fall back to `[now]` intake, same as the
 * original heuristic-only ask bar — but now carrying the inferred mode so the caller
 * can show it instead of presenting everything as generic intake. */
const RECURRING_VERBS = new Set(['monitorear', 'automatizar', 'agendar']);

/**
 * Interprets free-form ask-bar text and routes it: `detener` is informational only;
 * `monitorear`/`automatizar`/`agendar` queue a `[recurring]` task; everything else
 * queues a `[now]` task. Single implementation shared by the CLI, the web ask bar, and
 * the TUI — `apps/cli/src/commands.ts: cmdAsk` delegates here for anything past its own
 * local `aprobar`/`denegar`/`estado` shortcuts.
 */
export async function handleAsk(workspacePath: string, text: string, now: Date = new Date()): Promise<AskOutcome> {
    const trimmed = text.trim();
    const interpretation = await interpretAsk(trimmed);

    if (interpretation.verb === 'detener') {
        return {
            interpretation,
            message: 'Para detener el daemon: Ctrl-C en la terminal donde corre --daemon.'
        };
    }

    const tasksPath = path.resolve(workspacePath, TASKS_FILE);
    const existing = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf8') : null;

    if (RECURRING_VERBS.has(interpretation.verb)) {
        const content = appendTaskToRecurring(existing ?? EMPTY_SCAFFOLD, trimmed, now);
        fs.writeFileSync(tasksPath, content, 'utf8');
        // The cadence is actually "every engine cycle" (`appendTaskToRecurring`'s
        // `@every:1`), not a calendar schedule — a real limitation, but it's an
        // implementation detail, not something to put in front of a user asking for
        // something to repeat. Keep it out of the message; it's documented instead on
        // `appendTaskToRecurring` (tasks.ts) and in the plan for whoever picks up real
        // calendar cadences later.
        return {
            interpretation,
            message: `Tarea agregada a [recurring], se repite automáticamente: ${trimmed}`
        };
    }

    const content = existing ? appendTasksToNow(existing, [trimmed], now) : buildTasksScaffold(trimmed, now);
    fs.writeFileSync(tasksPath, content, 'utf8');
    return { interpretation, message: `Tarea agregada a [now]: ${trimmed}` };
}
