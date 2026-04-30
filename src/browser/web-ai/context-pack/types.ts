export type ContextDryRunMode = 'summary' | 'json' | 'full';
export type ContextTransportMode = 'inline' | 'upload' | 'none';

export interface ContextPackInput {
    vendor?: string;
    model?: string;
    prompt?: string;
    contextFromFiles?: string[];
    contextExclude?: string[];
    contextFile?: string;
    maxInput?: number | string;
    maxFileSize?: number | string;
    inlineCharLimit?: number | string;
    filesReport?: boolean;
    strict?: boolean;
    cwd?: string;
}

export interface SelectedContextFile {
    path: string;
    relativePath: string;
    sizeBytes: number;
    estimatedTokens: number;
    language: string;
    content: string;
}

export interface ExcludedContextFile {
    path: string;
    relativePath?: string;
    reason: string;
    sizeBytes?: number;
}

export interface ContextBudgetReport {
    status: 'ok' | 'warning' | 'over-budget';
    estimatedTokens: number;
    maxInputTokens: number;
    inlineChars: number;
    inlineCharLimit: number;
}

export interface ContextPackResult {
    ok: boolean;
    status: 'rendered' | 'dry-run';
    vendor: string;
    model?: string;
    budget: ContextBudgetReport;
    files: SelectedContextFile[];
    excluded: ExcludedContextFile[];
    composerText: string;
    warnings: string[];
}

export interface ContextPackSummary {
    files: Array<Pick<SelectedContextFile, 'relativePath' | 'sizeBytes' | 'estimatedTokens'>>;
    excluded: ExcludedContextFile[];
    budget: ContextBudgetReport;
}
