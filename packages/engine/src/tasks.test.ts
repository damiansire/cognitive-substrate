import { describe, it, expect } from 'vitest';
import {
    parseTasks,
    markTaskDone,
    markTaskFailed,
    addImproveTask,
    appendTasksToNow,
    buildTasksScaffold,
    markTaskAwaitingApproval,
    requeueApprovedTask,
    generateTaskId,
    extractTaskId,
    humanTaskText,
    appendTaskToRecurring
} from './tasks';

const SAMPLE = `# Plan de Tareas

## [now]
- [ ] Tarea activa A
- [x] Tarea ya completada
- [!] Tarea fallida

## [next]
- [ ] Tarea futura B

## [improve] - Auto-Mejora y Correcciones

## [recurring]
- [ ] Rutina E
`;

describe('parseTasks', () => {
    it('routes only pending items into queues', () => {
        const q = parseTasks(SAMPLE);
        expect(q.now).toHaveLength(1);
        expect(q.now[0]).toContain('Tarea activa A');
        expect(q.next[0]).toContain('Tarea futura B');
        expect(q.recurring[0]).toContain('Rutina E');
    });

    it('ignores [x] and [!] items', () => {
        const all = Object.values(parseTasks(SAMPLE)).flat().join('\n');
        expect(all).not.toContain('completada');
        expect(all).not.toContain('fallida');
    });
});

describe('task mutations', () => {
    it('marks a task done', () => {
        const out = markTaskDone(SAMPLE, '- [ ] Tarea activa A');
        expect(out).toContain('- [x] Tarea activa A');
    });

    it('marks a task failed', () => {
        const out = markTaskFailed(SAMPLE, '- [ ] Tarea activa A');
        expect(out).toContain('- [!] Tarea activa A');
    });

    it('adds an improve task under the existing improve header', () => {
        const out = addImproveTask(SAMPLE, 'Revisar X');
        expect(out).toContain('## [improve]');
        expect(out).toContain('- [ ] Revisar X');
    });

    it('creates the improve section when missing', () => {
        const out = addImproveTask('# Plan\n\n## [now]\n', 'Revisar Y');
        expect(out).toContain('## [improve]');
        expect(out).toContain('- [ ] Revisar Y');
    });

    it('appends decomposed subtasks under [now]', () => {
        const out = appendTasksToNow('# Plan\n\n## [now]\n', ['Sub 1', 'Sub 2']);
        const now = parseTasks(out).now;
        expect(now).toHaveLength(2);
        expect(now[0]).toContain('Sub 1');
    });
});

describe('markTaskAwaitingApproval / requeueApprovedTask (approval-gate defer cycle)', () => {
    it('moves the task out of [now] into [blocked], annotated with the approval id', () => {
        const out = markTaskAwaitingApproval(SAMPLE, '- [ ] Tarea activa A', 'appr-1');
        expect(parseTasks(out).now).toHaveLength(0);
        expect(out).toContain('## [blocked]');
        expect(out).toContain('- [ ] Tarea activa A (pending-approval:appr-1)');
    });

    it('creates the [blocked] section when missing', () => {
        const out = markTaskAwaitingApproval('# Plan\n\n## [now]\n- [ ] Solo\n', '- [ ] Solo', 'appr-2');
        expect(out).toContain('## [blocked]');
        expect(out).toContain('- [ ] Solo (pending-approval:appr-2)');
    });

    it('requeues a blocked task back into [now], stripping the annotation', () => {
        const blocked = markTaskAwaitingApproval(SAMPLE, '- [ ] Tarea activa A', 'appr-1');
        const requeued = requeueApprovedTask(blocked, 'appr-1');

        const q = parseTasks(requeued);
        expect(q.now).toContain('- [ ] Tarea activa A');
        expect(q.blocked.some((l) => l.includes('pending-approval'))).toBe(false);
    });

    it('is a no-op when no blocked task references the approval id', () => {
        expect(requeueApprovedTask(SAMPLE, 'appr-unknown')).toBe(SAMPLE);
    });

    it('round-trips through the full defer -> block -> approve -> requeue cycle', () => {
        let content = SAMPLE;
        content = markTaskAwaitingApproval(content, '- [ ] Tarea activa A', 'appr-3');
        expect(parseTasks(content).now).toHaveLength(0);

        content = requeueApprovedTask(content, 'appr-3');
        expect(parseTasks(content).now).toContain('- [ ] Tarea activa A');
    });
});

describe('appendTaskToRecurring', () => {
    it('adds the task under [recurring] with a default @every:1 cadence and a task-id', () => {
        const out = appendTaskToRecurring(SAMPLE, 'Reportar estado');
        const q = parseTasks(out);
        expect(q.recurring.some((l) => l.includes('Reportar estado'))).toBe(true);
        const line = q.recurring.find((l) => l.includes('Reportar estado'))!;
        expect(line).toContain('@every:1');
        expect(extractTaskId(line)).not.toBeNull();
    });

    it('creates the [recurring] section when missing', () => {
        const out = appendTaskToRecurring('# Plan\n\n## [now]\n', 'Monitorear X');
        expect(out).toContain('## [recurring]');
        expect(parseTasks(out).recurring.some((l) => l.includes('Monitorear X'))).toBe(true);
    });
});

describe('humanTaskText', () => {
    it('strips checkbox, task-id, and pending-approval annotations', () => {
        expect(humanTaskText('- [ ] Tarea con id (task-id:task-1)')).toBe('Tarea con id');
        expect(humanTaskText('- [ ] Tarea bloqueada (pending-approval:appr-1)')).toBe('Tarea bloqueada');
        expect(humanTaskText('- [ ] Tarea con ambas (task-id:task-1) (pending-approval:appr-1)')).toBe(
            'Tarea con ambas'
        );
    });

    it('is a no-op on already-plain text', () => {
        expect(humanTaskText('- [ ] Tarea simple')).toBe('Tarea simple');
    });
});

describe('buildTasksScaffold', () => {
    it('produces a parseable scaffold with the seed task in [now]', () => {
        const q = parseTasks(buildTasksScaffold('Hacer algo'));
        expect(q.now[0]).toContain('Hacer algo');
    });

    it('embeds a task-id in the seed task', () => {
        const q = parseTasks(buildTasksScaffold('Hacer algo'));
        expect(extractTaskId(q.now[0]!)).not.toBeNull();
    });
});

describe('generateTaskId / extractTaskId', () => {
    it('produces unique ids across calls', () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const a = generateTaskId(now);
        const b = generateTaskId(now);
        expect(a).not.toBe(b);
    });

    it('round-trips through appendTasksToNow', () => {
        const out = appendTasksToNow('# Plan\n\n## [now]\n', ['Sub 1', 'Sub 2']);
        const now = parseTasks(out).now;
        expect(extractTaskId(now[0]!)).not.toBeNull();
        expect(extractTaskId(now[1]!)).not.toBeNull();
        expect(extractTaskId(now[0]!)).not.toBe(extractTaskId(now[1]!));
    });

    it('returns null for a legacy line with no annotation', () => {
        expect(extractTaskId('- [ ] Tarea vieja sin id')).toBeNull();
    });

    it('is still readable after a task-id-annotated task gets blocked on approval', () => {
        const withId = appendTasksToNow('# Plan\n\n## [now]\n', ['Tarea con id']);
        const taskLine = parseTasks(withId).now[0]!;
        const id = extractTaskId(taskLine);

        const blocked = markTaskAwaitingApproval(withId, taskLine, 'appr-1');
        const blockedLine = parseTasks(blocked).blocked[0]!;
        expect(extractTaskId(blockedLine)).toBe(id);
    });
});
