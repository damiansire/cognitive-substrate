import { useCallback, useEffect, useState } from 'react';
import {
    resolveWorkspaces,
    getHomeSummary,
    getInboxItems,
    getBoardWithEvidence,
    type ResolvedWorkspace,
    type HomeSummary,
    type InboxItem,
    type BoardWithEvidence
} from '@cognitive-substrate/engine';

/**
 * Polls the same on-disk read-model the CLI uses (`@cognitive-substrate/engine`'s
 * readModel.ts) so the TUI never re-implements tasks.md/approvals.json/incidents.jsonl
 * parsing. "Live" here means filesystem polling, not a push server — there is no
 * WebSocket/SSE anywhere in this system yet, and building one isn't justified for a
 * single-user local CLI tool.
 */

export interface WorkspaceSnapshot {
    ws: ResolvedWorkspace;
    home: HomeSummary;
    inbox: InboxItem[];
    board: BoardWithEvidence;
}

export interface Snapshot {
    workspaces: WorkspaceSnapshot[];
    updatedAt: Date;
}

function takeSnapshot(rootDir: string): Snapshot {
    const workspaces = resolveWorkspaces(rootDir).map((ws) => ({
        ws,
        home: getHomeSummary(ws.path, ws.project),
        inbox: getInboxItems(ws.path, ws.project),
        board: getBoardWithEvidence(ws.path)
    }));
    return { workspaces, updatedAt: new Date() };
}

export function useWorkspaceData(rootDir: string, refreshMs = 3000): { snapshot: Snapshot; refresh: () => void } {
    const [snapshot, setSnapshot] = useState<Snapshot>(() => takeSnapshot(rootDir));
    const refresh = useCallback(() => setSnapshot(takeSnapshot(rootDir)), [rootDir]);

    useEffect(() => {
        const timer = setInterval(refresh, refreshMs);
        return () => clearInterval(timer);
    }, [refresh, refreshMs]);

    return { snapshot, refresh };
}
