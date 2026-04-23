import test from 'node:test';
import assert from 'node:assert/strict';
import {
    migrateLegacyClaudeValue,
    getDefaultClaudeModel,
    getDefaultClaudeChoices,
    getClaudeModelKind,
    isClaudeCanonicalModel,
    CLAUDE_CANONICAL_MODELS,
    CLAUDE_LEGACY_VALUE_MAP,
} from '../../src/cli/claude-models.ts';

// ─── Canonical set ───────────────────────────────────

test('CM-001: canonical set contains exactly 4 short aliases', () => {
    assert.equal(CLAUDE_CANONICAL_MODELS.length, 4);
    assert.deepEqual([...CLAUDE_CANONICAL_MODELS].sort(), ['haiku', 'opus', 'sonnet', 'sonnet[1m]']);
});

test('CM-002: isClaudeCanonicalModel accepts all canonical values', () => {
    for (const m of CLAUDE_CANONICAL_MODELS) {
        assert.ok(isClaudeCanonicalModel(m), `${m} should be canonical`);
    }
});

test('CM-003: isClaudeCanonicalModel rejects non-canonical values', () => {
    assert.equal(isClaudeCanonicalModel('claude-sonnet-4-6'), false);
    assert.equal(isClaudeCanonicalModel('gpt-5.4'), false);
    assert.equal(isClaudeCanonicalModel(''), false);
});

// ─── Legacy migration ────────────────────────────────

test('CM-004: migrateLegacyClaudeValue maps full IDs to short aliases', () => {
    assert.equal(migrateLegacyClaudeValue('claude-sonnet-4-6[1m]'), 'sonnet[1m]');
    assert.equal(migrateLegacyClaudeValue('claude-opus-4-6[1m]'), 'opus');
    assert.equal(migrateLegacyClaudeValue('claude-opus-4-7'), 'opus');
});

test('CM-005: migrateLegacyClaudeValue maps full sonnet/opus/haiku to aliases', () => {
    assert.equal(migrateLegacyClaudeValue('claude-sonnet-4-6'), 'sonnet');
    assert.equal(migrateLegacyClaudeValue('claude-opus-4-6'), 'opus');
    assert.equal(migrateLegacyClaudeValue('claude-haiku-4-5'), 'haiku');
});

test('CM-006: migrateLegacyClaudeValue maps pinned Haiku to haiku alias', () => {
    assert.equal(migrateLegacyClaudeValue('claude-haiku-4-5-20251001'), 'haiku');
});

test('CM-007: migrateLegacyClaudeValue preserves unknown explicit values', () => {
    assert.equal(
        migrateLegacyClaudeValue('claude-sonnet-4-7-preview[1m]'),
        'claude-sonnet-4-7-preview[1m]',
    );
});

test('CM-008: migrateLegacyClaudeValue is idempotent on canonical alias values', () => {
    for (const m of CLAUDE_CANONICAL_MODELS) {
        assert.equal(migrateLegacyClaudeValue(m), m);
    }
});

// ─── Legacy map ──────────────────────────────────────

test('CM-009: legacy map covers old full IDs', () => {
    assert.ok('claude-sonnet-4-6' in CLAUDE_LEGACY_VALUE_MAP);
    assert.ok('claude-opus-4-6' in CLAUDE_LEGACY_VALUE_MAP);
    assert.ok('claude-opus-4-7' in CLAUDE_LEGACY_VALUE_MAP);
    assert.ok('claude-haiku-4-5' in CLAUDE_LEGACY_VALUE_MAP);
    assert.ok('claude-haiku-4-5-20251001' in CLAUDE_LEGACY_VALUE_MAP);
    assert.ok('opus[1m]' in CLAUDE_LEGACY_VALUE_MAP);
});

// ─── Helpers ─────────────────────────────────────────

test('CM-011: getDefaultClaudeModel returns sonnet alias', () => {
    assert.equal(getDefaultClaudeModel(), 'sonnet');
});

test('CM-012: getDefaultClaudeChoices returns all canonical aliases', () => {
    const choices = getDefaultClaudeChoices();
    assert.deepEqual([...choices].sort(), ['haiku', 'opus', 'sonnet', 'sonnet[1m]']);
});

test('CM-013: getClaudeModelKind classifies correctly', () => {
    assert.equal(getClaudeModelKind('sonnet'), 'canonical');
    assert.equal(getClaudeModelKind('opus'), 'canonical');
    assert.equal(getClaudeModelKind('claude-sonnet-4-6'), 'legacy');
    assert.equal(getClaudeModelKind('claude-opus-4-6[1m]'), 'legacy');
    assert.equal(getClaudeModelKind('claude-sonnet-4-7-preview'), 'explicit');
    assert.equal(getClaudeModelKind('default'), 'explicit');
});
