import { VALIDATION_THRESHOLD } from './constants.js';
import { resolveIntentFeature, semanticTargetsForVendor, type SemanticTarget } from './self-heal.js';

const OPERATION_BY_INTENT: Readonly<Record<string, string>> = Object.freeze({
    'composer.fill': 'fill',
    'composer.click': 'click',
    'send.click': 'click',
    'copy.lastResponse': 'click',
    'modelPicker.open': 'click',
    'modelPicker.click': 'click',
    'upload.attach': 'click',
    'upload.click': 'click',
    'responseFeed.read': 'read',
    'streaming.check': 'read',
    'stop.click': 'click',
});

export interface ActionIntentInput {
    intentId?: string;
    intent?: string;
    provider?: string;
    feature?: string | null;
    semanticTarget?: SemanticTarget | null;
    operation?: string;
    requiredEvidence?: string[];
    cssFallbacks?: string[];
    ambiguityPolicy?: 'reject' | 'prefer-highest-confidence';
    confidenceThreshold?: number | string;
}

export interface ActionIntent {
    intentId: string;
    provider: string;
    feature: string;
    operation: string;
    roleHints: string[];
    nameHints: string[];
    excludeNameHints: string[];
    cssFallbacks: string[];
    requiredEvidence: string[];
    ambiguityPolicy: 'reject' | 'prefer-highest-confidence';
    required: boolean;
    confidenceThreshold: number;
    semanticTarget: SemanticTarget;
}

export function createActionIntent(input: ActionIntentInput = {}): ActionIntent {
    const intentId = input.intentId || input.intent;
    if (!intentId) throw new Error('ActionIntent requires intentId');
    const provider = input.provider || 'chatgpt';
    const feature = input.feature || resolveIntentFeature(intentId);
    if (!feature) throw new Error(`unknown action intent: ${intentId}`);
    const semanticTarget = input.semanticTarget || semanticTargetsForVendor(provider)[feature];
    if (!semanticTarget) throw new Error(`missing semantic target for ${provider}:${feature}`);
    const operation = input.operation || OPERATION_BY_INTENT[intentId] || 'click';
    const requiredEvidence = input.requiredEvidence || requiredEvidenceForOperation(operation);

    return {
        intentId,
        provider,
        feature,
        operation,
        roleHints: [...(semanticTarget.roles || [])],
        nameHints: (semanticTarget.names || []).map(patternToHint),
        excludeNameHints: (semanticTarget.excludeNames || []).map(patternToHint),
        cssFallbacks: [...(input.cssFallbacks || semanticTarget.cssFallbacks || [])],
        requiredEvidence,
        ambiguityPolicy: input.ambiguityPolicy || 'reject',
        required: semanticTarget.required === true,
        confidenceThreshold: Number.isFinite(Number(input.confidenceThreshold))
            ? Number(input.confidenceThreshold)
            : VALIDATION_THRESHOLD,
        semanticTarget,
    };
}

export function serializeActionIntent(input: ActionIntentInput): Omit<ActionIntent, 'semanticTarget'> {
    const normalized = createActionIntent(input);
    const { semanticTarget: _semanticTarget, ...serializable } = normalized;
    return serializable;
}

function requiredEvidenceForOperation(operation: string): string[] {
    if (operation === 'fill') return ['visible', 'enabled', 'editable'];
    if (operation === 'click') return ['visible', 'enabled'];
    return ['visible'];
}

function patternToHint(pattern: unknown): string {
    if (pattern instanceof RegExp) return pattern.source;
    return String(pattern);
}
