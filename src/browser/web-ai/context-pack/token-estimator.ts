import {
    DEFAULT_BROWSER_INLINE_CHAR_BUDGET,
    DEFAULT_MODEL_INPUT_BUDGETS,
    DEFAULT_TOKEN_WARNING_RATIO,
} from './constants.js';
import type { ContextBudgetReport, ContextPackInput, SelectedContextFile } from './types.js';

const SECTION_OVERHEAD_TOKENS = 16;

export function estimateTokens(text = '', sectionCount = 1): number {
    const chars = String(text || '').length;
    return Math.ceil(chars / 3) + Math.max(0, sectionCount) * SECTION_OVERHEAD_TOKENS;
}

export function resolveMaxInputTokens(input: ContextPackInput = {}): number {
    const explicit = Number(input.maxInput || 0);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);

    const vendor = String(input.vendor || 'chatgpt').toLowerCase() as keyof typeof DEFAULT_MODEL_INPUT_BUDGETS;
    const model = String(input.model || 'default').toLowerCase();
    const vendorBudgets = DEFAULT_MODEL_INPUT_BUDGETS[vendor] || DEFAULT_MODEL_INPUT_BUDGETS.chatgpt;
    return (vendorBudgets as Record<string, number>)[model] || vendorBudgets.default;
}

export function buildBudgetReport(
    input: ContextPackInput = {},
    composerText = '',
    files: SelectedContextFile[] = [],
): ContextBudgetReport {
    const maxInputTokens = resolveMaxInputTokens(input);
    const estimatedTokens = estimateTokens(composerText, files.length + 2);
    const inlineCharLimit = Number(input.inlineCharLimit || DEFAULT_BROWSER_INLINE_CHAR_BUDGET);
    const inlineChars = composerText.length;
    const status = estimatedTokens > maxInputTokens || inlineChars > inlineCharLimit
        ? 'over-budget'
        : estimatedTokens >= maxInputTokens * DEFAULT_TOKEN_WARNING_RATIO
            ? 'warning'
            : 'ok';
    return { status, estimatedTokens, maxInputTokens, inlineChars, inlineCharLimit };
}
