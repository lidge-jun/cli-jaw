import type { Page } from 'playwright-core';
import type { CapabilityProbeResult } from './capability-probe.js';

export type GrokModelChoice = 'auto' | 'fast' | 'expert' | 'build' | 'grok-4.3' | 'grok-4.6' | 'heavy';

export interface GrokModelSelectionResult {
    requested: GrokModelChoice;
    selected: GrokModelChoice;
    alreadySelected: boolean;
    usedFallbacks: string[];
}

const GROK_MODEL_MENU_BUTTONS = [
    'button[aria-label="Model select"]',
    'button[aria-label*="Model select" i]',
] as const;

const GROK_MODEL_OPTIONS: Record<GrokModelChoice, { labels: string[] }> = {
    auto: { labels: ['Auto'] },
    fast: { labels: ['Fast'] },
    expert: { labels: ['Expert'] },
    // Observed live on 2026-09-11: the menu read Auto / Fast / Expert / Build /
    // Heavy, with no Grok 4.x row at all on that account. The version choices
    // stay because they reappear per account, and Build was simply unreachable.
    build: { labels: ['Build'] },
    'grok-4.3': { labels: ['Grok 4.3'] },
    'grok-4.6': { labels: ['Grok 4.6'] },
    heavy: { labels: ['Heavy'] },
};

/** Aliases that are not derivable from a menu label. */
const GROK_MODEL_ALIAS_SEEDS: Record<string, GrokModelChoice> = {
    automatic: 'auto',
    quick: 'fast',
    thinking: 'expert',
    think: 'expert',
    beta: 'grok-4.3',
};

/**
 * Aliases come from the labels rather than a parallel hand-written table, which
 * is what let 'grok-4.6' exist here while the CLI still rejected it. 'Grok 4.6'
 * yields grok-4.6, grok46 and grok-46 on its own, so a new release only needs a
 * label.
 */
function deriveGrokModelAliases(): Record<string, GrokModelChoice> {
    const aliases: Record<string, GrokModelChoice> = {};
    for (const [choice, { labels }] of Object.entries(GROK_MODEL_OPTIONS) as [GrokModelChoice, { labels: string[] }][]) {
        const keys = new Set<string>([choice]);
        for (const label of labels) {
            const lower = label.toLowerCase();
            keys.add(lower);
            keys.add(lower.replace(/\s+/g, '-'));
            keys.add(lower.replace(/[\s.]+/g, ''));
            keys.add(lower.replace(/\s+/g, '-').replace(/\./g, ''));
        }
        for (const key of keys) if (key && !(key in aliases)) aliases[key] = choice;
    }
    for (const [key, choice] of Object.entries(GROK_MODEL_ALIAS_SEEDS)) {
        if (!(key in aliases)) aliases[key] = choice;
    }
    return aliases;
}

const GROK_MODEL_ALIASES: Record<string, GrokModelChoice> = deriveGrokModelAliases();

export const GROK_MODEL_ALIAS_KEYS: readonly string[] = Object.freeze(Object.keys(GROK_MODEL_ALIASES));

export function grokModelLabels(choice: GrokModelChoice): readonly string[] {
    return GROK_MODEL_OPTIONS[choice].labels;
}

/**
 * Recognises an open model menu from its labels with the version left generic.
 *
 * The four probes used to spell '^Grok 4\.\d' inline, so the day the web UI
 * shipped a different major an open menu stopped reading as open. Deriving one
 * pattern from the labels means a new release needs no probe edit, and the 2026-09-11
 * observation that no Grok 4.x row existed at all is exactly that failure mode.
 */
export function grokModelMenuLabelPattern(): RegExp {
    const alternatives = new Set<string>();
    for (const { labels } of Object.values(GROK_MODEL_OPTIONS)) {
        for (const label of labels) {
            const versionless = label.replace(/\s*\d+(?:\.\d+)?\s*$/, '').trim();
            const base = escapeRegExp(versionless || label);
            alternatives.add(versionless && versionless !== label
                ? `^${base}\\s+\\d+(?:\\.\\d+)?`
                : `^${base}\\b`);
        }
    }
    return new RegExp([...alternatives].join('|'), 'i');
}

const GROK_MENU_LABEL_PATTERN = grokModelMenuLabelPattern();

export function normalizeGrokModelChoice(model: string | undefined): GrokModelChoice | null {
    const key = String(model || '').trim().toLowerCase();
    if (!key) return null;
    const direct = GROK_MODEL_ALIASES[key];
    if (direct) return direct;
    // The alias table is keyed in id form ("grok-4.6"), but readGrokModel feeds this the
    // menu button's VISIBLE text, which is spaced ("Grok 4.6"). Without this, every
    // version-labelled choice normalized to null while the word-labelled ones (Auto,
    // Expert) worked, so selecting a Grok version always failed its own post-selection
    // verification. Collapsing whitespace to the id separator covers the current labels
    // and whatever version ships next, rather than needing a new alias per release.
    return GROK_MODEL_ALIASES[key.replace(/\s+/g, '-')] || null;
}

export async function selectGrokModel(page: Page, model: string | undefined): Promise<GrokModelSelectionResult | null> {
    const requested = normalizeGrokModelChoice(model);
    if (!requested) {
        if (model) throw new Error(`unsupported Grok model selection: ${model}`);
        return null;
    }
    const usedFallbacks: string[] = [];
    const before = await readGrokModel(page);
    if (before === requested) {
        return { requested, selected: before, alreadySelected: true, usedFallbacks };
    }
    await openGrokModelMenu(page, usedFallbacks);
    const option = await findGrokModelOption(page, requested);
    if (!option) throw new Error(`Grok model option not found: ${requested}`);
    await option.click({ timeout: 5_000 });
    await page.waitForTimeout(700).catch(() => undefined);
    const after = await readGrokModel(page);
    if (after !== requested) {
        throw new Error(`Grok model verification failed: expected ${requested}, got ${after || 'none'}`);
    }
    return { requested, selected: after, alreadySelected: false, usedFallbacks };
}

async function openGrokModelMenu(page: Page, usedFallbacks: string[]): Promise<void> {
    if (await page.locator('[role="menuitem"]').filter({ hasText: GROK_MENU_LABEL_PATTERN }).first().isVisible().catch(() => false)) return;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        for (const selector of GROK_MODEL_MENU_BUTTONS) {
            const loc = page.locator(selector).first();
            if (!(await loc.isVisible().catch(() => false))) continue;
            await loc.click({ timeout: 5_000 });
            await page.waitForTimeout(350).catch(() => undefined);
            if (await page.locator('[role="menuitem"]').filter({ hasText: GROK_MENU_LABEL_PATTERN }).first().isVisible().catch(() => false)) return;
        }
        await page.waitForTimeout(150).catch(() => undefined);
    }
    usedFallbacks.push('model-menu-text-button');
    const textButton = page.locator('button').filter({ hasText: GROK_MENU_LABEL_PATTERN }).first();
    if (await textButton.isVisible().catch(() => false)) {
        await textButton.click({ timeout: 5_000 });
        await page.waitForTimeout(350).catch(() => undefined);
        if (await page.locator('[role="menuitem"]').first().isVisible().catch(() => false)) return;
    }
    throw new Error(`Grok model selector not found. Tried: ${GROK_MODEL_MENU_BUTTONS.join(', ')}`);
}

async function findGrokModelOption(page: Page, choice: GrokModelChoice): Promise<ReturnType<Page['locator']> | null> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const candidates = await page.locator('[role="menuitem"], button').all().catch(() => []);
        for (const label of GROK_MODEL_OPTIONS[choice].labels) {
            const pattern = new RegExp(`^${escapeRegExp(label)}\\b`, 'i');
            for (const candidate of candidates) {
                if (!(await candidate.isVisible().catch(() => false))) continue;
                const text = (await candidate.innerText({ timeout: 500 }).catch(() => '')).trim().replace(/\s+/g, ' ');
                if (pattern.test(text)) return candidate;
            }
        }
        await page.waitForTimeout(150).catch(() => undefined);
    }
    return null;
}

async function readGrokModel(page: Page): Promise<GrokModelChoice | null> {
    for (const selector of GROK_MODEL_MENU_BUTTONS) {
        const loc = page.locator(selector).first();
        if (!(await loc.isVisible().catch(() => false))) continue;
        return normalizeGrokModelChoice(await loc.innerText({ timeout: 1_000 }).catch(() => ''));
    }
    return null;
}

// 104.9: read-only probe — close any menu we open and never mutate the selection.
async function closeGrokModelMenu(page: Page): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
        const menuVisible = await page.locator('[role="menuitem"]')
            .filter({ hasText: GROK_MENU_LABEL_PATTERN }).first().isVisible().catch(() => false);
        if (!menuVisible) return;
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
    }
}

/**
 * 104.9: read-only Grok model capability probe with a fallback ladder.
 * Reports whether the requested model is already active ('ok'), selectable but not
 * active ('warn'), or unavailable ('fail') — without ever changing the selection.
 */
export async function grokModelCapabilityProbe(page: Page, model: string | undefined): Promise<CapabilityProbeResult> {
    if (!model) return { state: 'unknown', evidence: { requested: null }, next: 'send' };
    const requested = normalizeGrokModelChoice(model);
    if (!requested) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
    const active = await readGrokModel(page).catch(() => null);
    if (active === requested) return { state: 'ok', evidence: { active, requested, selectable: true }, next: 'send' };
    const usedFallbacks: string[] = [];
    try {
        await openGrokModelMenu(page, usedFallbacks);
    } catch {
        return { state: 'warn', evidence: { active, requested, menuOpenFailed: true, usedFallbacks }, next: 'model-fallback' };
    }
    const option = await findGrokModelOption(page, requested).catch(() => null);
    await closeGrokModelMenu(page);
    return option
        ? { state: 'warn', evidence: { active, requested, selectable: true, usedFallbacks }, next: 'model-fallback' }
        : { state: 'fail', evidence: { active, requested, selectable: false, usedFallbacks }, next: 'model-fallback' };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
