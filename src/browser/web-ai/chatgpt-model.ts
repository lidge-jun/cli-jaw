import type { Page } from 'playwright-core';

export type ChatGptModelChoice = 'instant' | 'thinking' | 'pro';

export interface ChatGptModelSelectionResult {
    requested: ChatGptModelChoice;
    selected: ChatGptModelChoice;
    alreadySelected: boolean;
    usedFallbacks: string[];
}

export const CHATGPT_MODEL_SELECTOR_BUTTONS = [
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Model selector"]',
    'button[aria-label*="model selector" i]',
] as const;

export const CHATGPT_MODEL_OPTIONS: Record<ChatGptModelChoice, { testIds: string[]; labels: string[] }> = {
    instant: {
        testIds: ['model-switcher-gpt-5-3'],
        labels: ['Instant'],
    },
    thinking: {
        testIds: ['model-switcher-gpt-5-5-thinking'],
        labels: ['Thinking'],
    },
    pro: {
        testIds: ['model-switcher-gpt-5-5-pro'],
        labels: ['Pro'],
    },
};

const MODEL_ALIASES: Record<string, ChatGptModelChoice> = {
    instant: 'instant',
    fast: 'instant',
    'gpt-5-3': 'instant',
    'gpt-5.3': 'instant',
    thinking: 'thinking',
    think: 'thinking',
    'gpt-5-5-thinking': 'thinking',
    'gpt-5.5-thinking': 'thinking',
    pro: 'pro',
    'gpt-5-5-pro': 'pro',
    'gpt-5.5-pro': 'pro',
};

export function normalizeChatGptModelChoice(model: string | undefined): ChatGptModelChoice | null {
    const key = String(model || '').trim().toLowerCase();
    if (!key) return null;
    return MODEL_ALIASES[key] || null;
}

export async function selectChatGptModel(page: Page, model: string | undefined): Promise<ChatGptModelSelectionResult | null> {
    const requested = normalizeChatGptModelChoice(model);
    if (!requested) {
        if (model) throw new Error(`unsupported ChatGPT model selection: ${model}`);
        return null;
    }
    const usedFallbacks: string[] = [];
    await openModelMenu(page, usedFallbacks);
    const before = await readCheckedModel(page);
    if (before === requested) {
        await closeModelMenu(page);
        return { requested, selected: before, alreadySelected: true, usedFallbacks };
    }
    const option = await findModelOption(page, requested);
    if (!option) {
        throw new Error(`ChatGPT model option not found: ${requested}`);
    }
    await option.click({ timeout: 5_000 });
    await page.waitForTimeout(750).catch(() => undefined);
    await openModelMenu(page, usedFallbacks);
    const after = await readCheckedModel(page);
    await closeModelMenu(page);
    if (after !== requested) {
        throw new Error(`ChatGPT model verification failed: expected ${requested}, got ${after || 'none'}`);
    }
    return { requested, selected: after, alreadySelected: false, usedFallbacks };
}

async function closeModelMenu(page: Page): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
        if (!(await page.locator('[role="menuitemradio"][data-testid^="model-switcher-"]').first().isVisible().catch(() => false))) return;
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
    }
}

async function openModelMenu(page: Page, usedFallbacks: string[]): Promise<void> {
    const alreadyOpen = await page.locator('[role="menuitemradio"][data-testid^="model-switcher-"]').first().isVisible().catch(() => false);
    if (alreadyOpen) return;
    for (const selector of CHATGPT_MODEL_SELECTOR_BUTTONS) {
        const loc = page.locator(selector).first();
        if (!(await loc.isVisible().catch(() => false))) continue;
        await loc.click({ timeout: 5_000 });
        await page.waitForTimeout(400).catch(() => undefined);
        if (await page.locator('[role="menuitemradio"][data-testid^="model-switcher-"]').first().isVisible().catch(() => false)) return;
    }
    usedFallbacks.push('model-menu-text-button');
    const textButton = page.locator('button').filter({ hasText: /^ChatGPT$|^GPT-/i }).first();
    if (await textButton.isVisible().catch(() => false)) {
        await textButton.click({ timeout: 5_000 });
        await page.waitForTimeout(400).catch(() => undefined);
        if (await page.locator('[role="menuitemradio"][data-testid^="model-switcher-"]').first().isVisible().catch(() => false)) return;
    }
    throw new Error(`ChatGPT model selector not found. Tried: ${CHATGPT_MODEL_SELECTOR_BUTTONS.join(', ')}`);
}

async function findModelOption(page: Page, choice: ChatGptModelChoice): Promise<ReturnType<Page['locator']> | null> {
    const option = CHATGPT_MODEL_OPTIONS[choice];
    for (const testId of option.testIds) {
        const loc = page.locator(`[role="menuitemradio"][data-testid="${testId}"], [data-testid="${testId}"]`).first();
        if (await loc.isVisible().catch(() => false)) return loc;
    }
    for (const label of option.labels) {
        const loc = page.locator('[role="menuitemradio"], [role="menuitem"]').filter({ hasText: new RegExp(`^${label}\\b`, 'i') }).first();
        if (await loc.isVisible().catch(() => false)) return loc;
    }
    return null;
}

async function readCheckedModel(page: Page): Promise<ChatGptModelChoice | null> {
    for (const [choice, option] of Object.entries(CHATGPT_MODEL_OPTIONS) as Array<[ChatGptModelChoice, typeof CHATGPT_MODEL_OPTIONS[ChatGptModelChoice]]>) {
        for (const testId of option.testIds) {
            const checked = await page.locator(`[role="menuitemradio"][data-testid="${testId}"][aria-checked="true"], [data-testid="${testId}"][aria-checked="true"]`).first().isVisible().catch(() => false);
            if (checked) return choice;
        }
    }
    return null;
}
