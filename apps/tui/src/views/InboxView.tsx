import React from 'react';
import { Box, Text } from 'ink';
import type { InboxItem } from '@cognitive-substrate/engine';

export interface TypingState {
    approvalId: string;
    buffer: string;
}

export function InboxView({
    items,
    selected,
    typing
}: {
    items: InboxItem[];
    selected: number;
    typing: TypingState | null;
}) {
    if (items.length === 0) return <Text dimColor>Inbox vacío. Nada esperando tu atención.</Text>;
    return (
        <Box flexDirection="column" marginY={1}>
            {items.map((item, i) => {
                const isSelected = i === selected;
                const label =
                    item.kind === 'approval'
                        ? `🔒 ${item.approval.command} (${item.approval.id})`
                        : `${item.incident.severity === 'error' ? '❌' : '⚠️'} ${item.incident.task}: ${item.incident.reason}`;
                return (
                    <Text key={i} color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                        {isSelected ? '› ' : '  '}
                        {label}
                    </Text>
                );
            })}
            <Box marginTop={1}>
                <Text dimColor>a aprobar · A aprobar siempre · d denegar · D denegar siempre · m modificar</Text>
            </Box>
            {typing ? (
                <Box>
                    <Text>
                        Comando modificado (Enter confirma, Esc cancela): {typing.buffer}
                        <Text inverse> </Text>
                    </Text>
                </Box>
            ) : null}
        </Box>
    );
}
