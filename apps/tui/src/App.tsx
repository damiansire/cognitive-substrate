import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { resolveApprovalAction, handleAsk, type AskOutcome } from '@cognitive-substrate/engine';
import type { ResolveInput } from '@cognitive-substrate/governance';
import { useWorkspaceData } from './data.js';
import { HomeView } from './views/HomeView.js';
import { InboxView, type TypingState } from './views/InboxView.js';
import { BoardView, flattenBoard } from './views/BoardView.js';
import { SessionView } from './views/SessionView.js';
import { AskView } from './views/AskView.js';

type View = 'home' | 'inbox' | 'board' | 'session' | 'ask';

export function App({ rootDir }: { rootDir: string }) {
    const { exit } = useApp();
    const { snapshot, refresh } = useWorkspaceData(rootDir);
    const [view, setView] = useState<View>('home');
    const [projectIndex, setProjectIndex] = useState(0);
    const [inboxIndex, setInboxIndex] = useState(0);
    const [boardIndex, setBoardIndex] = useState(0);
    const [selectedEvidence, setSelectedEvidence] = useState<string | null>(null);
    const [typing, setTyping] = useState<TypingState | null>(null);
    const [message, setMessage] = useState('');
    const [askBuffer, setAskBuffer] = useState('');
    const [askSubmitting, setAskSubmitting] = useState(false);
    const [askOutcome, setAskOutcome] = useState<AskOutcome | null>(null);

    const workspaces = snapshot.workspaces;
    const currentWs = workspaces[projectIndex]?.ws;

    function resolveApproval(
        workspacePath: string,
        approvalId: string,
        action: ResolveInput['action'],
        scope: ResolveInput['scope'],
        modifiedCommand?: string
    ): void {
        const resolved = resolveApprovalAction(workspacePath, approvalId, { action, scope, modifiedCommand });
        if (!resolved) return;
        setMessage(`Aprobación ${approvalId}: ${action} (${scope})`);
        refresh();
    }

    function submitAsk(): void {
        const text = askBuffer.trim();
        if (!text || !currentWs || askSubmitting) return;
        setAskSubmitting(true);
        handleAsk(currentWs.path, text)
            .then((outcome) => {
                setAskOutcome(outcome);
                setAskBuffer('');
                refresh();
            })
            .finally(() => setAskSubmitting(false));
    }

    useInput((input, key) => {
        if (typing) {
            if (key.escape) {
                setTyping(null);
                return;
            }
            if (key.return) {
                if (currentWs) resolveApproval(currentWs.path, typing.approvalId, 'modify', 'once', typing.buffer);
                setTyping(null);
                return;
            }
            if (key.backspace || key.delete) {
                setTyping({ ...typing, buffer: typing.buffer.slice(0, -1) });
                return;
            }
            if (input) setTyping({ ...typing, buffer: typing.buffer + input });
            return;
        }

        // Same priority as `typing` above: while composing ask-bar text, every
        // keystroke is buffer input, not a view-switch shortcut (mirrors the
        // approval-modify flow's own text capture).
        if (view === 'ask') {
            if (key.escape) {
                if (askBuffer) setAskBuffer('');
                else setView('home');
                return;
            }
            if (key.return) {
                submitAsk();
                return;
            }
            if (key.backspace || key.delete) {
                setAskBuffer((b) => b.slice(0, -1));
                return;
            }
            if (key.ctrl && input === 'c') {
                exit();
                return;
            }
            if (input) setAskBuffer((b) => b + input);
            return;
        }

        if (input === 'q' || (key.ctrl && input === 'c')) {
            exit();
            return;
        }
        if (input === '1') return setView('home');
        if (input === '2') return setView('inbox');
        if (input === '3') return setView('board');
        if (input === '4') return setView('session');
        if (input === '5') {
            setAskOutcome(null);
            return setView('ask');
        }
        if (input === 'r') return refresh();

        if (view === 'home') {
            if (key.downArrow) setProjectIndex((i) => Math.min(i + 1, Math.max(workspaces.length - 1, 0)));
            if (key.upArrow) setProjectIndex((i) => Math.max(i - 1, 0));
            if (key.return && workspaces.length > 0) setView('board');
        } else if (view === 'inbox') {
            const items = workspaces[projectIndex]?.inbox ?? [];
            if (key.downArrow) setInboxIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
            if (key.upArrow) setInboxIndex((i) => Math.max(i - 1, 0));
            const selectedItem = items[inboxIndex];
            if (selectedItem?.kind === 'approval' && currentWs) {
                const approvalId = selectedItem.approval.id;
                if (input === 'a') resolveApproval(currentWs.path, approvalId, 'approve', 'once');
                if (input === 'A') resolveApproval(currentWs.path, approvalId, 'approve', 'always');
                if (input === 'd') resolveApproval(currentWs.path, approvalId, 'deny', 'once');
                if (input === 'D') resolveApproval(currentWs.path, approvalId, 'deny', 'always');
                if (input === 'm') setTyping({ approvalId, buffer: '' });
            }
        } else if (view === 'board') {
            const flat = flattenBoard(
                workspaces[projectIndex]?.board ?? { now: [], next: [], blocked: [], improve: [], recurring: [] }
            );
            if (key.downArrow) setBoardIndex((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
            if (key.upArrow) setBoardIndex((i) => Math.max(i - 1, 0));
            if (key.return && workspaces.length > 0) {
                setSelectedEvidence(flat[boardIndex]?.evidencePath ?? null);
                setView('session');
            }
        }
    });

    return (
        <Box flexDirection="column">
            <Box borderStyle="round" paddingX={1} justifyContent="space-between">
                <Text bold>Cognitive Substrate OS — TUI</Text>
                <Text dimColor>[1] Home [2] Inbox [3] Board [4] Sesión [5] Ask — r refrescar, q salir</Text>
            </Box>
            {message ? <Text color="green">{message}</Text> : null}
            {view === 'home' && <HomeView workspaces={workspaces} selected={projectIndex} />}
            {view === 'inbox' && (
                <InboxView items={workspaces[projectIndex]?.inbox ?? []} selected={inboxIndex} typing={typing} />
            )}
            {view === 'board' && <BoardView ws={workspaces[projectIndex]} selected={boardIndex} />}
            {view === 'session' && <SessionView ws={currentWs} evidencePath={selectedEvidence} />}
            {view === 'ask' && <AskView buffer={askBuffer} submitting={askSubmitting} outcome={askOutcome} />}
            <Box>
                <Text dimColor>
                    Actualizado: {snapshot.updatedAt.toLocaleTimeString()} — altitud: home (↑↓+Enter) → board (Enter) →
                    sesión
                </Text>
            </Box>
        </Box>
    );
}
