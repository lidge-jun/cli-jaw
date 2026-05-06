// @ts-check
/**
 * G01 mirror — local planner loop contract types (cli-jaw).
 * Mirrors agbrowse/web-ai/planner-contract.mjs.
 */

export const PLANNER_CONTRACT_SCHEMA_VERSION = 'planner-contract-v1';
export const PLANNER_RESULT_SCHEMA_VERSION = 'planner-result-v1';

export type CandidateActionKind =
    | 'observe' | 'click' | 'type' | 'press'
    | 'scroll' | 'wait' | 'extract' | 'finalize';

export interface PlannerObjective {
    id: string;
    description: string;
    stopConditions: string[];
    maxSteps?: number;
    maxStepMs?: number;
    overallTimeoutMs?: number;
}

export interface CandidateActionV1 {
    kind: CandidateActionKind;
    ref?: string;
    text?: string;
    reason?: string;
    args?: Record<string, unknown>;
}

export interface VerificationV1 {
    ok: boolean;
    reason?: string;
    signals?: string[];
}

export interface PlannerStepV1 {
    step: number;
    observationId: string;
    action: CandidateActionV1;
    verification: VerificationV1;
    startedAt: number;
    endedAt: number;
    attempts: number;
}

export type PlannerOutcome =
    | 'completed' | 'max-steps' | 'timeout' | 'aborted' | 'error';

export interface PlannerResultV1 {
    schemaVersion: 'planner-result-v1';
    objectiveId: string;
    outcome: PlannerOutcome;
    steps: PlannerStepV1[];
    finalAnswer: string | null;
    stats: {
        totalMs: number;
        retryCount: number;
        observeCount: number;
        mutateCount: number;
    };
}

const VALID_KINDS: ReadonlyArray<CandidateActionKind> = [
    'observe', 'click', 'type', 'press', 'scroll', 'wait', 'extract', 'finalize',
];

export function isValidCandidateAction(a: unknown): a is CandidateActionV1 {
    if (!a || typeof a !== 'object') return false;
    const k = (a as { kind?: unknown }).kind;
    return typeof k === 'string'
        && (VALID_KINDS as readonly string[]).includes(k);
}
