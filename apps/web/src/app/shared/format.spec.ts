import { stripCheckbox, parseTaskLine, normalizePath } from './format';

describe('stripCheckbox', () => {
  it('strips the checkbox prefix for each status', () => {
    expect(stripCheckbox('- [ ] Tarea')).toBe('Tarea');
    expect(stripCheckbox('- [x] Tarea')).toBe('Tarea');
    expect(stripCheckbox('- [!] Tarea')).toBe('Tarea');
  });
});

describe('parseTaskLine', () => {
  it('returns plain text for a line with no annotations', () => {
    expect(parseTaskLine('- [ ] Tarea simple')).toEqual({ text: 'Tarea simple' });
  });

  it('strips a task-id annotation and never surfaces it', () => {
    const parsed = parseTaskLine('- [ ] Tarea con id (task-id:task-123)');
    expect(parsed.text).toBe('Tarea con id');
    expect(parsed.pendingApprovalId).toBeUndefined();
  });

  it('extracts a pending-approval id and strips it from the text', () => {
    const parsed = parseTaskLine('- [ ] Tarea bloqueada (pending-approval:appr-1)');
    expect(parsed.text).toBe('Tarea bloqueada');
    expect(parsed.pendingApprovalId).toBe('appr-1');
  });

  it('strips both annotations when a task-id-annotated task gets blocked on approval', () => {
    const parsed = parseTaskLine(
      '- [ ] Tarea con ambas (task-id:task-1) (pending-approval:appr-1)',
    );
    expect(parsed.text).toBe('Tarea con ambas');
    expect(parsed.pendingApprovalId).toBe('appr-1');
  });

  it('extracts the @every:N cadence prefix of a [recurring] task and strips it from the text', () => {
    const parsed = parseTaskLine('- [ ] @every:1 monitorear el uptime del sitio (task-id:task-1)');
    expect(parsed.text).toBe('monitorear el uptime del sitio');
    expect(parsed.cadenceTicks).toBe(1);
  });

  it('has no cadenceTicks for a non-recurring line', () => {
    expect(parseTaskLine('- [ ] Tarea simple').cadenceTicks).toBeUndefined();
  });
});

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('runs\\2026-01-01\\evidence')).toBe('runs/2026-01-01/evidence');
  });
});
