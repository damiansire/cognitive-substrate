import * as fs from 'fs';
import * as path from 'path';
import { generateJson, hasApiKey } from '@cognitive-substrate/gemini-agent-loop';
import { humanTaskText } from './tasks';
import type { Verdict } from './types';

const KNOWLEDGE_FILE = 'knowledge.md';

/**
 * Appends a timestamped learning to the workspace's archival memory (`knowledge.md`).
 * Archival memory is transparent and human-editable by design (MemGPT-inspired):
 * the agent reads it on demand via tools instead of holding it all in context.
 */
export function appendLearning(workspacePath: string, learning: string, when: Date): void {
    const clean = learning.trim();
    if (!clean) return;
    const file = path.resolve(workspacePath, KNOWLEDGE_FILE);
    fs.appendFileSync(file, `- [${when.toISOString()}] ${clean}\n`, 'utf8');
}

/** Reads the archival memory, or an empty string if none exists yet. */
export function readKnowledge(workspacePath: string): string {
    const file = path.resolve(workspacePath, KNOWLEDGE_FILE);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const SYSTEM_PROMPT = `Eres el módulo de memoria del Cognitive Substrate OS. Destilás UNA lección breve, concreta y reutilizable a partir del resultado de una tarea, útil para futuras tareas del mismo proyecto. Respondés SOLO con JSON.`;

/**
 * Distills exactly one reusable lesson from a completed run. Uses the model when
 * available; otherwise falls back to a deterministic one-line summary so the OS
 * still records *something* learned from every run (CHARTER: "learn one thing").
 */
export async function distillLearning(task: string, verdict: Verdict, log: string): Promise<string> {
    const cleanTask = humanTaskText(task);
    const fallback = `Tarea "${cleanTask}" ${verdict.verified ? 'verificada' : 'no verificada'}: ${verdict.reason}`;
    if (!hasApiKey()) return fallback;

    const userPrompt = `Tarea: ${cleanTask}\nVeredicto: ${verdict.verified ? 'VERIFICADA' : 'NO VERIFICADA'} (${verdict.reason})\nLog:\n${log.slice(0, 4000)}\n\nDevolvé JSON {"lesson": "una línea"}.`;
    const result = await generateJson<{ lesson?: string }>(SYSTEM_PROMPT, userPrompt);
    return result?.lesson?.trim() || fallback;
}
