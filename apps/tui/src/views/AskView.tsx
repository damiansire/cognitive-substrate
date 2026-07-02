import React from 'react';
import { Box, Text } from 'ink';
import type { AskOutcome } from '@cognitive-substrate/engine';

/** Lowest-ceremony surface for the ask bar: type, Enter submits (see `App.tsx`'s
 * `useInput` handler for the `ask` view), result renders below. Shares
 * `handleAsk` with the CLI's `ask` subcommand and the web ask bar — nothing here
 * re-interprets the text itself. */
export function AskView({
    buffer,
    submitting,
    outcome
}: {
    buffer: string;
    submitting: boolean;
    outcome: AskOutcome | null;
}) {
    return (
        <Box flexDirection="column" marginY={1}>
            <Text>
                {buffer}
                <Text inverse> </Text>
            </Text>
            <Box marginTop={1}>
                <Text dimColor>Enter envía, Esc borra</Text>
            </Box>
            {submitting ? <Text dimColor>Interpretando…</Text> : null}
            {outcome ? (
                <Box flexDirection="column" marginTop={1}>
                    <Text color="cyan">
                        {outcome.interpretation.verb} / {outcome.interpretation.mode}
                    </Text>
                    <Text>{outcome.message}</Text>
                </Box>
            ) : null}
        </Box>
    );
}
