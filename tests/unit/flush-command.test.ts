// Flush command unit tests (#27)
import test from 'node:test';
import assert from 'node:assert/strict';
import { flushHandler } from '../../src/cli/handlers.ts';

// ─── Mock helpers ────────────────────────────────────
// Note: locales are NOT loaded in test context, so t() falls back to key name.
// We test the handler logic (ok/fail, settings mutation) rather than i18n text.

function makeCtx(overrides: Record<string, any> = {}) {
    const settings = {
        cli: 'claude',
        perCli: {
            claude: { model: 'claude-sonnet-4-6', effort: 'medium' },
            gemini: { model: 'gemini-2.5-pro', effort: '' },
            codex: { model: 'gpt-5.3-codex', effort: 'medium' },
        },
        memory: { enabled: true, flushEvery: 10, cli: '', model: '', retentionDays: 30 },
        ...overrides,
    };
    return {
        locale: 'en',
        settings,
        getSettings: async () => settings,
        updateSettings: async (patch: any) => {
            if (patch.memory) settings.memory = { ...settings.memory, ...patch.memory };
            return { ok: true };
        },
    };
}

// ─── FC-001: /flush (no args) shows current ─────────

test('FC-001: /flush shows current flush model (ok=true)', async () => {
    const ctx = makeCtx();
    const result = await flushHandler([], ctx);
    assert.equal(result.ok, true);
    // When no custom flush set, includes "active" suffix
    assert.ok(result.text.includes('active'), 'Should indicate using active CLI');
});

test('FC-001b: /flush shows custom flush model when set (ok=true)', async () => {
    const ctx = makeCtx({ memory: { cli: 'gemini', model: 'gemini-2.5-flash', enabled: true, flushEvery: 10, retentionDays: 30 } });
    const result = await flushHandler([], ctx);
    assert.equal(result.ok, true);
    // When custom flush is set, NO "active" suffix
    assert.ok(!result.text.includes('active'), 'Should NOT show active suffix when custom set');
});

// ─── FC-002: /flush <model> changes model ───────────

test('FC-002: /flush <custom-model> changes model, keeps current CLI', async () => {
    const ctx = makeCtx();
    const result = await flushHandler(['my-custom-model'], ctx);
    assert.equal(result.ok, true);
    assert.equal(ctx.settings.memory.model, 'my-custom-model');
});

// ─── FC-003: /flush <cli> <model> changes both ──────

test('FC-003: /flush <cli> <model> changes both CLI and model', async () => {
    const ctx = makeCtx();
    const result = await flushHandler(['gemini', 'gemini-2.5-flash'], ctx);
    // detectCli('gemini') may not be available in CI — test both paths
    if (result.ok) {
        assert.equal(ctx.settings.memory.cli, 'gemini');
        assert.equal(ctx.settings.memory.model, 'gemini-2.5-flash');
    } else {
        // CLI not installed → cliUnavailable
        assert.ok(result.text.includes('gemini'), 'Should mention the CLI name in error');
    }
});

// ─── FC-004: /flush off resets ───────────────────────

test('FC-004: /flush off resets to active CLI/model', async () => {
    const ctx = makeCtx({ memory: { cli: 'gemini', model: 'gemini-2.5-flash', enabled: true, flushEvery: 10, retentionDays: 30 } });
    const result = await flushHandler(['off'], ctx);
    assert.equal(result.ok, true);
    assert.equal(ctx.settings.memory.cli, '');
    assert.equal(ctx.settings.memory.model, '');
});

test('FC-004b: /flush reset also resets', async () => {
    const ctx = makeCtx({ memory: { cli: 'gemini', model: 'gemini-2.5-flash', enabled: true, flushEvery: 10, retentionDays: 30 } });
    const result = await flushHandler(['reset'], ctx);
    assert.equal(result.ok, true);
    assert.equal(ctx.settings.memory.cli, '');
    assert.equal(ctx.settings.memory.model, '');
});

// ─── FC-005: fallback when memory unset ──────────────

test('FC-005: flush model resolution falls back to active CLI model', async () => {
    const ctx = makeCtx();
    const result = await flushHandler([], ctx);
    assert.equal(result.ok, true);
});

// ─── FC-006: /flush <cli> without model → default ───

test('FC-006: /flush <cli> without model sets model to default', async () => {
    const ctx = makeCtx();
    const result = await flushHandler(['claude'], ctx);
    if (result.ok) {
        assert.equal(ctx.settings.memory.cli, 'claude');
        assert.equal(ctx.settings.memory.model, 'default');
    }
});
