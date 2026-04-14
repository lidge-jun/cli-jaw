// ─── Argument Completions ────────────────────────────
// Extracted from handlers.ts for 500-line compliance.

import { CLI_KEYS, buildModelChoicesByCli } from './registry.js';
import { t } from '../core/i18n.js';

const DEFAULT_CLI_CHOICES = [...CLI_KEYS];
const MODEL_CHOICES_BY_CLI = buildModelChoicesByCli();

function toChoiceKey(value: any) {
    return String(value || '').trim().toLowerCase();
}

function dedupeChoices(list: any[]) {
    const out: any[] = [];
    const seen = new Set();
    for (const entry of list || []) {
        const key = toChoiceKey(entry?.value ?? entry);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

function getCliChoicesFromContext(ctx: any) {
    const keys = Object.keys(ctx?.settings?.perCli || {});
    return keys.length ? keys : DEFAULT_CLI_CHOICES;
}

function getModelChoicesFromContext(ctx: any) {
    const fromCatalog = Object.values(MODEL_CHOICES_BY_CLI).flat();
    const fromSettings = Object.values(ctx?.settings?.perCli || {} as Record<string, any>)
        .map((v: any) => v?.model)
        .filter(Boolean);
    const activeCli = ctx?.settings?.cli || '';
    const currentModel = ctx?.settings?.perCli?.[activeCli]?.model;
    return dedupeChoices([...fromCatalog, ...fromSettings, ...(currentModel ? [currentModel] : [])]);
}

export function modelArgumentCompletions(ctx: any) {
    const cliByModel = new Map();
    for (const [cli, models] of Object.entries(MODEL_CHOICES_BY_CLI)) {
        for (const m of models) cliByModel.set(toChoiceKey(m), cli);
    }

    return getModelChoicesFromContext(ctx)
        .map((value: any) => ({
            value,
            label: cliByModel.get(toChoiceKey(value)) || 'custom',
        }));
}

export function cliArgumentCompletions(ctx: any) {
    return getCliChoicesFromContext(ctx)
        .map(value => ({ value, label: 'cli' }));
}

export function skillArgumentCompletions(ctx: any) {
    const L = ctx?.locale || 'ko';
    return [{ value: 'list', label: t('cmd.arg.skillList', {}, L) }, { value: 'reset', label: t('cmd.arg.skillReset', {}, L) }];
}

export function employeeArgumentCompletions(ctx: any) {
    const L = ctx?.locale || 'ko';
    return [{ value: 'reset', label: t('cmd.arg.employeeReset', {}, L) }];
}

export function browserArgumentCompletions(ctx: any) {
    const L = ctx?.locale || 'ko';
    return [{ value: 'status', label: t('cmd.arg.browserStatus', {}, L) }, { value: 'tabs', label: t('cmd.arg.browserTabs', {}, L) }];
}

export function fallbackArgumentCompletions(ctx: any) {
    const L = ctx?.locale || 'ko';
    const clis = Object.keys(ctx?.settings?.perCli || {});
    return [
        ...clis.map(c => ({ value: c, label: 'cli' })),
        { value: 'off', label: t('cmd.arg.fallbackOff', {}, L) },
    ];
}

export function flushArgumentCompletions(ctx: any) {
    const L = ctx?.locale || 'ko';
    const clis = Object.keys(ctx?.settings?.perCli || {});
    const allModels: string[] = Object.values(MODEL_CHOICES_BY_CLI).flat();
    return dedupeChoices([
        ...clis.map(c => ({ value: c, label: 'cli' })),
        ...allModels.map(m => ({ value: m, label: 'model' })),
        { value: 'off', label: t('cmd.arg.flushOff', {}, L) },
    ]);
}
