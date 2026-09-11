import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CHATGPT_MODEL_ALIAS_KEYS,
    CHATGPT_MODEL_OPTIONS,
    chatGptModelSelectorTestIds,
    chatGptModelTestIdSlugs,
    modelChoiceFromText,
    normalizeChatGptModelChoice,
} from '../../src/browser/web-ai/chatgpt-model.js';
import { CHATGPT_MODEL_SELECTOR_OBSERVATION } from '../../src/browser/web-ai/capability-observation-presets.js';
import {
    GROK_MODEL_ALIAS_KEYS,
    grokModelLabels,
    grokModelMenuLabelPattern,
    normalizeGrokModelChoice,
} from '../../src/browser/web-ai/grok-model.js';
import {
    GEMINI_MODE_OPTION_TEST_IDS,
    GEMINI_MODEL_ALIAS_KEYS,
    geminiModeLabels,
    normalizeGeminiModelChoice,
} from '../../src/browser/web-ai/gemini-model.js';

// #692: the accepted --model spellings, the DOM test-id generations, the
// observation preset and the CLI's allow-list were four hand-maintained copies
// of the same fact. They drifted: the test-id table already drove gpt-5-6 while
// nothing downstream accepted 'gpt-5.6', and grok-4.6 worked in the runtime but
// died at the CLI. These lock the derivation so a new generation cannot be
// half-added again.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliSrc = readFileSync(join(root, 'bin/commands/browser-web-ai.ts'), 'utf8');

test('BWMAP-001: every model slug the DOM table drives is an accepted --model spelling', () => {
    const slugs = chatGptModelTestIdSlugs();
    assert.ok(slugs.length >= 7, `expected the generation table to yield slugs, got ${slugs.length}`);
    for (const slug of slugs) {
        const dotted = slug.replace(/^gpt-(\d+)-(\d+)/, 'gpt-$1.$2');
        assert.ok(
            normalizeChatGptModelChoice(slug),
            `CHATGPT_MODEL_OPTIONS drives ${slug} but no alias accepts it`,
        );
        assert.ok(
            normalizeChatGptModelChoice(dotted),
            `CHATGPT_MODEL_OPTIONS drives ${slug} but the dotted spelling ${dotted} is rejected`,
        );
    }
});

test('BWMAP-002: the slug a test-id yields maps to the choice that test-id belongs to', () => {
    for (const [choice, { testIds }] of Object.entries(CHATGPT_MODEL_OPTIONS)) {
        for (const testId of testIds) {
            const slug = testId.replace(/^model-switcher-/, '').replace(/-thinking-effort$/, '');
            assert.equal(normalizeChatGptModelChoice(slug), choice, `${slug} should resolve to ${choice}`);
        }
    }
});

test('BWMAP-003: the spellings that already worked keep working', () => {
    const legacy: Record<string, string> = {
        instant: 'instant', fast: 'instant', 'gpt-5-3': 'instant', 'gpt-5.3': 'instant',
        thinking: 'thinking', think: 'thinking', 'gpt-5-5-thinking': 'thinking', 'gpt-5.5-thinking': 'thinking',
        pro: 'pro', 'gpt-5-5-pro': 'pro', 'gpt-5.5-pro': 'pro',
    };
    for (const [input, expected] of Object.entries(legacy)) {
        assert.equal(normalizeChatGptModelChoice(input), expected, `${input} regressed`);
    }
});

test('BWMAP-004: the generation spellings the issue reported now resolve', () => {
    assert.equal(normalizeChatGptModelChoice('gpt-5.6'), 'instant');
    assert.equal(normalizeChatGptModelChoice('gpt-5-6'), 'instant');
    assert.equal(normalizeChatGptModelChoice('gpt-5-6-thinking'), 'thinking');
    assert.equal(normalizeChatGptModelChoice('gpt-5.6-thinking'), 'thinking');
    assert.equal(normalizeChatGptModelChoice('gpt-5-6-pro'), 'pro');
    assert.equal(normalizeChatGptModelChoice('gpt-5.6-pro'), 'pro');
    // Unknown input must still be refused rather than guessed at.
    assert.equal(normalizeChatGptModelChoice('gpt-9000-ultra'), null);
});

test('BWMAP-005: a generation cannot reach the DOM table without reaching the observation preset', () => {
    const candidates = CHATGPT_MODEL_SELECTOR_OBSERVATION.selectorCandidates;
    for (const testId of chatGptModelSelectorTestIds()) {
        assert.ok(
            candidates.includes(`[data-testid="${testId}"]`),
            `${testId} is driven by the runtime but absent from the observation preset`,
        );
    }
});

test('BWMAP-006: the live 2026-09-11 ChatGPT menu labels resolve through the label fallback', () => {
    // Observed rows carried no data-testid at all, so the label path is the only
    // one left; both of these used to return null.
    assert.equal(modelChoiceFromText('Latest'), 'instant');
    assert.equal(modelChoiceFromText('GPT-5.6 Sol'), 'instant');
    assert.equal(modelChoiceFromText('GPT-5.5'), 'instant');
    // A qualifier still wins over the bare-generation rule.
    assert.equal(modelChoiceFromText('GPT-5.6 Thinking'), 'thinking');
    assert.equal(modelChoiceFromText('GPT-5.6 Pro'), 'pro');
});

test('BWMAP-007: every Grok choice survives an id to label to id round trip', () => {
    for (const choice of ['auto', 'fast', 'expert', 'build', 'grok-4.3', 'grok-4.6', 'heavy'] as const) {
        const labels = grokModelLabels(choice);
        assert.ok(labels.length > 0, `${choice} has no label`);
        for (const label of labels) {
            assert.equal(normalizeGrokModelChoice(label), choice, `visible label ${label} must map back to ${choice}`);
        }
    }
});

test('BWMAP-008: the Grok menu probe recognises a version it has never seen', () => {
    const pattern = grokModelMenuLabelPattern();
    // Observed live on 2026-09-11: Auto/Fast/Expert/Build/Heavy with no Grok 4.x
    // row at all. A probe pinned to one minor stops recognising an open menu.
    for (const label of ['Auto', 'Fast', 'Expert', 'Build', 'Heavy', 'Grok 4.3', 'Grok 4.6', 'Grok 4.7', 'Grok 5.0', 'Grok 11']) {
        assert.ok(pattern.test(label), `${label} should read as an open model menu`);
    }
    assert.equal(pattern.test('Settings'), false);
    assert.equal(/Grok 4\\\./.test(String(pattern)), false, 'the probe must not pin a minor version');
});

test('BWMAP-009: every Gemini choice survives an id to label to id round trip', () => {
    for (const choice of ['flash-lite', 'flash', 'pro'] as const) {
        for (const label of geminiModeLabels(choice)) {
            assert.equal(normalizeGeminiModelChoice(label), choice, `visible label ${label} must map back to ${choice}`);
        }
        // A version-prefixed label is what the live menu actually renders.
        for (const label of geminiModeLabels(choice)) {
            assert.equal(normalizeGeminiModelChoice(`3.6 ${label}`), choice, `versioned label 3.6 ${label} must map back to ${choice}`);
        }
    }
    assert.equal(GEMINI_MODE_OPTION_TEST_IDS.length, 3);
});

test('BWMAP-010: the CLI derives its allow-list instead of keeping a fourth copy', () => {
    // A literal list here is what made --model grok-4.6 fail while the runtime
    // accepted it, so the derivation itself is the thing under test.
    assert.match(cliSrc, /chatgpt: new Set\(CHATGPT_MODEL_ALIAS_KEYS\)/);
    assert.match(cliSrc, /grok: new Set\(GROK_MODEL_ALIAS_KEYS\)/);
    assert.match(cliSrc, /gemini: new Set\(\[\.\.\.GEMINI_MODEL_ALIAS_KEYS/);
    assert.match(cliSrc, /deepthink/);
    // Gemini's runtime normalizer accepts a versioned label that no key list can
    // enumerate, so this regex has to survive the derivation.
    assert.match(cliSrc, /flash\[-_\\s\]\?lite\|flash\|pro/);
    // The effort check kept its own model table and so refused any spelling that
    // copy had not been updated with.
    assert.match(cliSrc, /normalizedModel = normalizeChatGptModelChoice/);
    assert.equal(cliSrc.includes("'gpt-5-5-thinking': 'thinking'"), false, 'the duplicated effort model map should be gone');
});

test('BWMAP-011: the runtime alias keys cover both spellings of every generation', () => {
    for (const key of CHATGPT_MODEL_ALIAS_KEYS) {
        assert.ok(normalizeChatGptModelChoice(key), `${key} is listed but does not normalize`);
    }
    for (const key of GROK_MODEL_ALIAS_KEYS) {
        assert.ok(normalizeGrokModelChoice(key), `${key} is listed but does not normalize`);
    }
    for (const key of GEMINI_MODEL_ALIAS_KEYS) {
        assert.ok(normalizeGeminiModelChoice(key), `${key} is listed but does not normalize`);
    }
});

