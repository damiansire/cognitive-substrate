import React from 'react';
import { Box, Text } from 'ink';
import { getSessionTrace, getLatestRunPath, type ResolvedWorkspace } from '@cognitive-substrate/engine';

/** Lowest-altitude view: the raw evidence trace for one run (command, log, verdict). */
export function SessionView({ ws, evidencePath }: { ws: ResolvedWorkspace | undefined; evidencePath: string | null }) {
    if (!ws) return <Text dimColor>No hay workspace seleccionado.</Text>;

    const target = evidencePath ?? getLatestRunPath(ws.path);
    if (!target) return <Text dimColor>Todavía no hay ninguna sesión registrada para este workspace.</Text>;

    const trace = getSessionTrace(ws.path, target);
    return (
        <Box flexDirection="column" marginY={1}>
            <Text bold>{target}</Text>
            <Text>{trace.summaryMd ?? '(sin summary.md)'}</Text>
        </Box>
    );
}
