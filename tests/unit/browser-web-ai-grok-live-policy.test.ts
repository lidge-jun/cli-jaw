import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isGrokUrl } from '../../src/browser/web-ai/grok-live.ts';
import { grokModelMenuLabelPattern, normalizeGrokModelChoice } from '../../src/browser/web-ai/grok-model.ts';

const root = process.cwd();
const grokLiveSrc = readFileSync(join(root, 'src/browser/web-ai/grok-live.ts'), 'utf8');
const copyMarkdownSrc = readFileSync(join(root, 'src/browser/web-ai/copy-markdown.ts'), 'utf8');
const grokModelSrc = readFileSync(join(root, 'src/browser/web-ai/grok-model.ts'), 'utf8');

test('BWAG-001: Grok live runtime gates by grok.com host', () => {
    assert.equal(isGrokUrl('https://grok.com/'), true);
    assert.equal(isGrokUrl('https://www.grok.com/chat'), true);
    assert.equal(isGrokUrl('https://chatgpt.com/'), false);
});

test('BWAG-002: Grok live runtime uses observed DOM selectors', () => {
    assert.match(grokLiveSrc, /\.ProseMirror\[contenteditable="true"\]/);
    assert.match(grokLiveSrc, /\[data-testid="new-chat"\]/);
    assert.match(grokLiveSrc, /\[data-testid="assistant-message"\]/);
    assert.match(grokLiveSrc, /response-content-markdown/);
});

test('BWAG-003: Grok upload uses visible chip and sent-turn evidence', () => {
    assert.match(grokLiveSrc, /attachLocalFileLive/);
    assert.match(grokLiveSrc, /verifyGrokSentTurnAttachment/);
    assert.match(grokLiveSrc, /closest\('\[id\^="response-"\]'\)/);
    assert.match(grokLiveSrc, /waitForTimeout\(250\)/);
    assert.match(grokLiveSrc, /Grok sent turn has no attachment evidence/);
    assert.match(grokLiveSrc, /data-testid\*="file"/);
});

test('BWAG-004: Grok supports opt-in copy markdown fallback', () => {
    assert.match(copyMarkdownSrc, /GROK_COPY_SELECTORS/);
    assert.match(copyMarkdownSrc, /\[data-testid="assistant-message"\]/);
    assert.match(copyMarkdownSrc, /button\[aria-label="Copy"\]/);
    assert.match(grokLiveSrc, /captureCopiedResponseText\(page, GROK_COPY_SELECTORS\)/);
    assert.match(grokLiveSrc, /copy-markdown/);
});

test('BWAG-005: Grok supports observed model picker choices', () => {
    assert.match(grokModelSrc, /button\[aria-label="Model select"\]/);
    // grok-4.6 shipped with the runtime but was never required here, and 'build'
    // was observed live on 2026-09-11 in a menu that had no Grok 4.x row at all.
    for (const label of ['auto', 'fast', 'expert', 'build', 'grok-4.3', 'grok-4.6', 'heavy']) {
        assert.match(grokModelSrc, new RegExp(label.replace('.', '\\.')));
    }
    assert.match(grokLiveSrc, /selectGrokModel/);
    assert.match(grokLiveSrc, /model selected:/);
});

test('BWAG-006: Grok hard-gates context packaging unless --allow-grok-context-pack is passed', () => {
    assert.match(grokLiveSrc, /hasContextPackaging\(input\) && input\.allowGrokContextPack !== true/);
    assert.match(grokLiveSrc, /grok context-pack disabled by default/);
    assert.match(grokLiveSrc, /'grok-context-pack-not-allowed'/);
});

test('BWAG-007: Grok soft warning fires only when override flag is set', () => {
    assert.match(grokLiveSrc, /grok-context-pack-not-recommended/);
    assert.match(grokLiveSrc, /hasContextPackaging\(input\) && input\.allowGrokContextPack === true/);
    assert.match(grokLiveSrc, /warnings\.push\(GROK_CONTEXT_PACK_WARNING\)/);
});

// ─── model-choice normalization (behavior, not source regex) ─────
// The rest of this file matches source strings; these call the function instead, because
// the bug below was invisible to a source match -- every string it needed was present.

test('BWAG-008: the menu button\'s VISIBLE label normalizes, not just the id form', () => {
    // readGrokModel feeds this the button's inner text, which is spaced. Before the fix
    // the alias table only had id form, so a version-labelled choice normalized to null
    // and selection always failed its own post-selection verification. The word-labelled
    // choices worked, which is why it went unnoticed.
    assert.equal(normalizeGrokModelChoice('Grok 4.6'), 'grok-4.6');
    assert.equal(normalizeGrokModelChoice('Grok 4.3'), 'grok-4.3');
    assert.equal(normalizeGrokModelChoice('Expert'), 'expert');
    assert.equal(normalizeGrokModelChoice('Auto'), 'auto');
});

test('BWAG-009: id form, compact form, and aliases still resolve', () => {
    assert.equal(normalizeGrokModelChoice('grok-4.6'), 'grok-4.6');
    assert.equal(normalizeGrokModelChoice('grok46'), 'grok-4.6');
    assert.equal(normalizeGrokModelChoice('grok-46'), 'grok-4.6');
    assert.equal(normalizeGrokModelChoice('thinking'), 'expert');
    assert.equal(normalizeGrokModelChoice('quick'), 'fast');
});

test('BWAG-010: whitespace collapse is general, and unknown input stays null', () => {
    assert.equal(normalizeGrokModelChoice('  Grok  4.6  '), 'grok-4.6');
    assert.equal(normalizeGrokModelChoice('nonsense'), null);
    assert.equal(normalizeGrokModelChoice(''), null);
    assert.equal(normalizeGrokModelChoice(undefined), null);
});

test('BWAG-011: the menu-open probe accepts any Grok 4.x, not one pinned release', () => {
    // This used to count '^Grok 4\.' occurrences in the source, which meant the
    // four probes had to stay written out inline. They are now derived from the
    // labels, so the behavior is asserted instead: the probe recognises an open
    // menu for a version it has never been told about, and no major or minor is
    // baked into it.
    const pattern = grokModelMenuLabelPattern();
    for (const label of ['Auto', 'Fast', 'Expert', 'Build', 'Heavy', 'Grok 4.3', 'Grok 4.6', 'Grok 4.7', 'Grok 5.0']) {
        assert.ok(pattern.test(label), `${label} should read as an open model menu`);
    }
    assert.equal(pattern.test('Settings'), false);
    assert.equal(/Grok 4\\./.test(String(pattern)), false, 'the probe must not pin a major or minor version');
    // Check the code rather than the prose: an earlier version of this asserted
    // the pinned spelling was absent from the whole file and tripped on the
    // comment that explains why it was removed.
    const inlineHasText = grokModelSrc.match(/hasText:\s*\/[^/]*\//g) || [];
    assert.equal(inlineHasText.length, 0, `menu probes should use the derived pattern, found ${inlineHasText.join(', ')}`);
    const derivedUses = grokModelSrc.match(/hasText:\s*GROK_MENU_LABEL_PATTERN/g) || [];
    assert.ok(derivedUses.length >= 4, `expected every probe to use the derived pattern, found ${derivedUses.length}`);
});
