import { buildContextPackageResult } from './builder.js';
import type { ContextPackInput, ContextPackResult } from './types.js';

export async function contextDryRun(input: ContextPackInput = {}): Promise<ContextPackResult> {
    const result = await buildContextPackageResult(input);
    return { ...result, status: 'dry-run' };
}

export async function contextRender(input: ContextPackInput = {}): Promise<ContextPackResult> {
    const result = await buildContextPackageResult(input);
    return { ...result, status: 'rendered' };
}
