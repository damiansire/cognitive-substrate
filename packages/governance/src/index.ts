/**
 * @cognitive-substrate/governance — bounded autonomy and trust controls.
 *
 * Budgets (caps on model/tool spend), an approval gate for dangerous commands, and an
 * append-only audit trail. This is the layer that turns the terminal's accident-guard
 * into a real policy boundary: dangerous commands require approval and, in autonomous
 * mode, are denied by default (fail-safe).
 */
export * from './policy';
export * from './classify';
export * from './decide';
export * from './budget';
export * from './audit';
export * from './approvals';
