// ─── Argument Completions ────────────────────────────
// Extracted from handlers.ts for 500-line compliance.

import { CLI_KEYS, buildModelChoicesByCli } from './registry.js';
import { t } from '../core/i18n.js';
import type { CompletionCtx, SlashChoice } from './types.js';

const DEFAULT_CLI_CHOICES = [...CLI_KEYS];
const MODEL_CHOICES_BY_CLI = buildModelChoicesByCli();

function toChoiceKey(value: unknown) {
    return String(value || '').trim().toLowerCase();
}

function dedupeChoices(list: SlashChoice[]): SlashChoice[] {
    const out: SlashChoice[] = [];
    const seen = new Set<string>();
    for (const entry of list || []) {
        const key = toChoiceKey(entry?.value ?? entry);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

function getCliChoicesFromContext(ctx: CompletionCtx): string[] {
    const keys = Object.keys(ctx?.settings?.perCli || {});
    return keys.length ? keys : DEFAULT_CLI_CHOICES;
}

function getModelChoicesFromContext(ctx: CompletionCtx): string[] {
    const fromCatalog = (Object.values(MODEL_CHOICES_BY_CLI) as string[][]).flat();
    const perCli = (ctx?.settings?.perCli || {}) as Record<string, { model?: string } | undefined>;
    const fromSettings = Object.values(perCli)
        .map((v) => v?.model)
        .filter((m): m is string => Boolean(m));
    const activeCli = ctx?.settings?.cli || '';
    const currentModel = perCli[activeCli]?.model;
    const merged = [...fromCatalog, ...fromSettings, ...(currentModel ? [currentModel] : [])];
    return dedupeChoices(merged.map((value) => ({ value }))).map((c) => c.value);
}

export function modelArgumentCompletions(ctx: CompletionCtx): SlashChoice[] {
    const cliByModel = new Map<string, string>();
    for (const [cli, models] of Object.entries(MODEL_CHOICES_BY_CLI)) {
        for (const m of models as string[]) cliByModel.set(toChoiceKey(m), cli);
    }

    return getModelChoicesFromContext(ctx)
        .map((value) => ({
            value,
            label: cliByModel.get(toChoiceKey(value)) || 'custom',
        }));
}

export function cliArgumentCompletions(ctx: CompletionCtx): SlashChoice[] {
    return getCliChoicesFromContext(ctx)
        .map(value => ({ value, label: 'cli' }));
}

export function skillArgumentCompletions(ctx: CompletionCtx): SlashChoice[] {
    const L = ctx?.locale || 'ko';
    return [{ value: 'list', label: t('cmd.arg.skillList', {}, L) }, { value: 'reset', label: t('cmd.arg.skillReset', {}, L) }];
}

export function employeeArgumentCompletions(ctx: CompletionCtx): SlashChoice[] {
    const L = ctx?.locale || 'ko';
    return [{ value: 'reset', label: t('cmd.arg.employeeReset', {}, L) }];
}

export function browserArgumentCompletions(ctx: CompletionCtx): SlashChoice[] {
    const L = ctx?.locale || 'ko';
    return [{ value: 'status', label: t('cmd.arg.browserStatus', {}, L) }, { value: 'tabs', label: t('cmd.arg.browserTabs', {}, L) }];
}

export function fallbackArgumentCompletions(ctx: CompletionCtx): SlashChoice[] {
    const L = ctx?.locale || 'ko';
    const clis = Object.keys(ctx?.settings?.perCli || {});
    return [
        ...clis.map(c => ({ value: c, label: 'cli' })),
        { value: 'off', label: t('cmd.arg.fallbackOff', {}, L) },
    ];
}

export function flushArgumentCompletions(ctx: CompletionCtx): SlashChoice[] {
    const L = ctx?.locale || 'ko';
    const clis = Object.keys(ctx?.settings?.perCli || {});
    const allModels: string[] = (Object.values(MODEL_CHOICES_BY_CLI) as string[][]).flat();
    return dedupeChoices([
        ...clis.map(c => ({ value: c, label: 'cli' })),
        ...allModels.map(m => ({ value: m, label: 'model' })),
        { value: 'off', label: t('cmd.arg.flushOff', {}, L) },
    ]);
}
