import { createActionIntent, serializeActionIntent, type ActionIntentInput } from './action-intent.js';
import { resolveActionTarget, type PageLike, type ResolveActionTargetContext, type ResolveActionTargetResult } from './self-heal.js';

export async function resolveTargetForIntent(
    page: PageLike,
    intentInput: ActionIntentInput = {},
    options: Partial<ResolveActionTargetContext> = {},
): Promise<ReturnType<typeof formatResolverResult>> {
    const actionIntent = createActionIntent(intentInput);
    const resolution = await resolveActionTarget(page, {
        ...options,
        provider: actionIntent.provider,
        intent: actionIntent.intentId,
        actionKind: actionIntent.operation,
        feature: actionIntent.feature,
        semanticTargetOverride: actionIntent.semanticTarget,
        selectors: actionIntent.cssFallbacks,
    });
    return formatResolverResult(actionIntent, resolution);
}

export function formatResolverResult(
    actionIntentInput: ActionIntentInput = {},
    resolution: ResolveActionTargetResult = { ok: false, attempts: [] },
): {
    ok: boolean;
    intent: ReturnType<typeof serializeActionIntent>;
    target: ResolveActionTargetResult['target'] | null;
    confidence: number | null;
    resolutionSource: string | null;
    attempts: ResolveActionTargetResult['attempts'];
    errorCode: string | null;
    required: boolean;
} {
    const actionIntent = serializeActionIntent(actionIntentInput);
    const selectedAttempt = resolution.attempts?.find(attempt => attempt.validation?.ok) || null;
    const resolutionSource = resolution.target?.["resolution"] || selectedAttempt?.source || null;
    return {
        ok: resolution.ok === true,
        intent: actionIntent,
        target: resolution.target || null,
        confidence: resolution.target?.confidence ?? selectedAttempt?.validation?.confidence ?? null,
        resolutionSource: typeof resolutionSource === 'string' ? resolutionSource : null,
        attempts: resolution.attempts || [],
        errorCode: resolution.errorCode || null,
        required: resolution.required === true || actionIntent.required === true,
    };
}
