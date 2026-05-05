const CAPTURE_METHODS = new Set(['copy-button', 'dom-fallback', 'clipboard', 'manual', 'unknown']);

export interface AnswerArtifact {
    provider: string;
    sessionId: string | null;
    conversationUrl: string | null;
    capturedBy: string;
    markdown: string;
    text: string;
    exactnessScore: number;
    responseStableMs: number | null;
    warnings: string[];
}

export interface AnswerArtifactInput {
    provider?: string;
    sessionId?: string | null;
    conversationUrl?: string | null;
    capturedBy?: string;
    captureMethod?: string;
    markdown?: string;
    text?: string;
    exactnessScore?: number;
    responseStableMs?: number | string | null;
    warnings?: unknown[];
}

export function createAnswerArtifact(input: AnswerArtifactInput = {}): AnswerArtifact {
    const capturedBy = normalizeCaptureMethod(input.capturedBy || input.captureMethod);
    const markdown = normalizeText(input.markdown);
    const text = normalizeText(input.text || markdown);
    const warnings = Array.isArray(input.warnings) ? input.warnings.filter(Boolean).map(String) : [];
    const exactnessScore = input.exactnessScore === undefined
        ? estimateExactnessScore({ capturedBy, markdown, text })
        : clampScore(Number(input.exactnessScore));

    return {
        provider: input.provider || 'unknown',
        sessionId: input.sessionId || null,
        conversationUrl: input.conversationUrl || null,
        capturedBy,
        markdown,
        text,
        exactnessScore,
        responseStableMs: Number.isFinite(Number(input.responseStableMs)) ? Number(input.responseStableMs) : null,
        warnings,
    };
}

export function artifactFromPollResult(result: Record<string, any> = {}, context: Record<string, any> = {}): AnswerArtifact {
    const capturedBy = result.capturedBy
        || result.captureMethod
        || (Array.isArray(result.usedFallbacks) && result.usedFallbacks.includes('copy-markdown') ? 'copy-button' : null)
        || (result.answerText ? 'dom-fallback' : 'unknown');

    return createAnswerArtifact({
        provider: result.vendor || context.provider,
        sessionId: result.sessionId || context.sessionId,
        conversationUrl: result.conversationUrl || result.url || context.conversationUrl,
        capturedBy,
        markdown: result.markdown || result.answerMarkdown || result.answerText || '',
        text: result.text || result.answerText || result.markdown || result.answerMarkdown || '',
        responseStableMs: result.responseStableMs,
        warnings: [...(context.warnings || []), ...(result.warnings || [])],
    });
}

export function withAnswerArtifact<T extends Record<string, any>>(result: T, context: Record<string, any> = {}): T & { answerArtifact?: AnswerArtifact } {
    if (result.answerArtifact) return result;
    if (!result.answerText && !result.markdown && !result.answerMarkdown && !result.text) return result;
    return {
        ...result,
        answerArtifact: artifactFromPollResult(result, context),
    };
}

export function summarizeAnswerArtifact(artifact: AnswerArtifactInput = {}): Record<string, unknown> {
    const normalized = createAnswerArtifact(artifact);
    return {
        provider: normalized.provider,
        sessionId: normalized.sessionId,
        capturedBy: normalized.capturedBy,
        markdownChars: normalized.markdown.length,
        textChars: normalized.text.length,
        exactnessScore: normalized.exactnessScore,
        warningCount: normalized.warnings.length,
    };
}

function normalizeCaptureMethod(value: unknown): string {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return CAPTURE_METHODS.has(normalized) ? normalized : 'unknown';
}

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function estimateExactnessScore(input: { capturedBy: string; markdown: string; text: string }): number {
    if (!input.markdown && !input.text) return 0;
    if (input.capturedBy === 'copy-button' || input.capturedBy === 'clipboard') return 1;
    if (input.capturedBy === 'dom-fallback') return 0.75;
    if (input.markdown && input.text && input.markdown.trim() === input.text.trim()) return 0.8;
    return 0.5;
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}
