/**
 * Eval categories from the CHARTER's eval program. Each answers a different question:
 * - capability: can the system do the task at all?
 * - regression: did a change break previously-working behavior?
 * - behavioral: does it respect policy/scope/uncertainty (e.g. no completion w/o evidence)?
 * - adversarial: does it resist prompt-injection / malicious inputs / sandbox escapes?
 * - long-horizon: can it carry multi-step work across ticks?
 */
export type EvalCategory = 'capability' | 'regression' | 'behavioral' | 'adversarial' | 'long-horizon';

/** A fresh, isolated temp workspace handed to each case. */
export interface EvalContext {
    workspace: string;
}

export interface EvalOutcome {
    passed: boolean;
    detail: string;
}

export interface EvalCase {
    id: string;
    category: EvalCategory;
    description: string;
    run(ctx: EvalContext): Promise<EvalOutcome>;
}

export interface EvalResult {
    id: string;
    category: EvalCategory;
    description: string;
    passed: boolean;
    detail: string;
    /** time-to-pass (ms). */
    durationMs: number;
    /** cost-to-pass, as number of model round-trips (0 in simulation mode). */
    llmCalls: number;
    error?: string;
}

export interface CategorySummary {
    total: number;
    passed: number;
}

export interface EvalReport {
    generatedAt: string;
    simulation: boolean;
    total: number;
    passed: number;
    /** pass@1 across all cases. */
    passRate: number;
    totalDurationMs: number;
    totalLlmCalls: number;
    byCategory: Record<string, CategorySummary>;
    results: EvalResult[];
}
