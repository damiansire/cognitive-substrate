import React from 'react';
import { Box, Text } from 'ink';
import type { WorkspaceSnapshot } from '../data.js';
import type { BoardTask, QueueName } from '@cognitive-substrate/engine';

const QUEUES = ['now', 'next', 'blocked', 'improve', 'recurring'] as const satisfies readonly QueueName[];

/** `(task-id:...)` is bookkeeping for drill-down, never meant to be human-visible —
 * same rule as `apps/web/src/app/shared/format.ts: parseTaskLine`. */
function stripTaskId(line: string): string {
    return line.replace(/ \(task-id:[^)]+\)/, '');
}

/** Flattens the five queues into one ordered list — what lets the board have a single
 * cursor (`boardIndex` in `App.tsx`) the same way `InboxView` does. */
export function flattenBoard(board: WorkspaceSnapshot['board']): BoardTask[] {
    return QUEUES.flatMap((q) => board[q]);
}

export function BoardView({ ws, selected }: { ws: WorkspaceSnapshot | undefined; selected: number }) {
    if (!ws) return <Text dimColor>No hay workspace seleccionado.</Text>;
    const isEmpty = QUEUES.every((q) => ws.board[q].length === 0);
    if (isEmpty) return <Text dimColor>Sin tareas todavía.</Text>;

    let flatIndex = -1;
    return (
        <Box flexDirection="column" marginY={1}>
            {QUEUES.map((q) =>
                ws.board[q].length > 0 ? (
                    <Box key={q} flexDirection="column" marginBottom={1}>
                        <Text bold>{q}</Text>
                        {ws.board[q].map((task, i) => {
                            flatIndex += 1;
                            const isSelected = flatIndex === selected;
                            return (
                                <Text key={i} inverse={isSelected}>
                                    {' '}
                                    {stripTaskId(task.line)}
                                    {task.evidencePath ? <Text dimColor> (evidencia: {task.evidencePath})</Text> : null}
                                </Text>
                            );
                        })}
                    </Box>
                ) : null
            )}
        </Box>
    );
}
