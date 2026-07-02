import React from 'react';
import { Box, Text } from 'ink';
import type { WorkspaceSnapshot } from '../data.js';

export function HomeView({ workspaces, selected }: { workspaces: WorkspaceSnapshot[]; selected: number }) {
    if (workspaces.length === 0) {
        return <Text dimColor>No hay workspaces todavía. Corré el CLI para inicializar uno.</Text>;
    }
    return (
        <Box flexDirection="column" marginY={1}>
            {workspaces.map((w, i) => (
                <Text key={w.ws.path} color={i === selected ? 'cyan' : undefined} bold={i === selected}>
                    {i === selected ? '› ' : '  '}
                    {w.ws.project}: now={w.home.pendingNow} next={w.home.pendingNext} blocked={w.home.blocked}{' '}
                    aprobaciones={w.home.pendingApprovals} incidentes={w.home.incidents}
                    {w.home.lastRun
                        ? ` — último: ${w.home.lastRun.verdict.verified ? '✅' : '❌'} ${w.home.lastRun.task.trim()}`
                        : ''}
                </Text>
            ))}
        </Box>
    );
}
