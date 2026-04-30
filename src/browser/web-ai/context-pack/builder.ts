import { DEFAULT_INLINE_CHAR_LIMIT } from './constants.js';
import { buildContextPack } from './file-selector.js';
import { buildContextRenderResult } from './renderer.js';
import type { ContextPackInput, ContextPackResult, ContextPackSummary } from './types.js';

export async function buildContextPackageResult(input: ContextPackInput = {}): Promise<ContextPackResult> {
    const selected = await buildContextPack(input);
    const result = buildContextRenderResult(input, selected.files, selected.excluded, selected.warnings);
    if (result.budget.estimatedTokens > result.budget.maxInputTokens) result.ok = false;
    return result;
}

export async function buildInlineContextOrFail(input: ContextPackInput = {}): Promise<ContextPackResult | null> {
    if (!hasContextPackaging(input)) return null;
    const result = await buildContextPackageResult({ ...input, strict: true });
    const inlineLimit = Number(input.inlineCharLimit || DEFAULT_INLINE_CHAR_LIMIT);
    if (result.budget.estimatedTokens > result.budget.maxInputTokens) {
        throw new Error(`context package exceeds max input tokens: ${result.budget.estimatedTokens}/${result.budget.maxInputTokens}`);
    }
    if (result.composerText.length > inlineLimit) {
        throw new Error(`context package exceeds inline limit: ${result.composerText.length}/${inlineLimit} chars`);
    }
    return result;
}

export function hasContextPackaging(input: ContextPackInput = {}): boolean {
    return Boolean(input.contextFile || (Array.isArray(input.contextFromFiles) && input.contextFromFiles.length > 0));
}

export function summarizeContextPack(contextPack: ContextPackResult): ContextPackSummary {
    return {
        files: contextPack.files.map(file => ({
            relativePath: file.relativePath,
            sizeBytes: file.sizeBytes,
            estimatedTokens: file.estimatedTokens,
        })),
        excluded: contextPack.excluded,
        budget: contextPack.budget,
    };
}
