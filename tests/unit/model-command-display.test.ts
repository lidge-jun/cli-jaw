import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadLocales } from '../../src/core/i18n.ts';
import { modelHandler, statusHandler } from '../../src/cli/handlers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadLocales(join(__dirname, '../../public/locales'));

function makeCtx(overrides: Record<string, any> = {}) {
    const settings = {
        cli: 'gemini',
        perCli: {
            gemini: { model: 'gemini-3-flash-preview', effort: '' },
            codex: { model: 'gpt-5.3-codex', effort: 'medium' },
        },
        activeOverrides: {},
        ...overrides,
    };

    const session = {
        active_cli: settings.cli,
        model: settings.perCli?.[settings.cli]?.model || 'default',
        ...(overrides.session || {}),
    };

    return {
        locale: 'en',
        settings,
        session,
        getSettings: async () => settings,
        getSession: async () => session,
        updateSettings: async (patch: any) => {
            if (patch.perCli) settings.perCli = { ...settings.perCli, ...patch.perCli };
            if (patch.activeOverrides) settings.activeOverrides = { ...settings.activeOverrides, ...patch.activeOverrides };
            if (patch.cli) settings.cli = patch.cli;

            const activeCli = settings.cli || 'claude';
            const aoModel = settings.activeOverrides?.[activeCli]?.model;
            const perCliModel = settings.perCli?.[activeCli]?.model;
            session.active_cli = activeCli;
            session.model = aoModel || perCliModel || session.model || 'default';
            return { ok: true };
        },
    };
}

test('MD-001: /model shows active CLI perCli model by default', async () => {
    const ctx = makeCtx();
    const result = await modelHandler([], ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('gemini-3-flash-preview'));
});

test('MD-002: /model prefers activeOverrides model over perCli model', async () => {
    const ctx = makeCtx({
        activeOverrides: {
            gemini: { model: 'gemini-2.5-flash' },
        },
        session: {
            active_cli: 'gemini',
            model: 'gemini-3.0-pro-preview',
        },
    });
    const result = await modelHandler([], ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('gemini-2.5-flash'));
});

test('MD-003: /model uses session model when session active CLI matches', async () => {
    const ctx = makeCtx({
        session: {
            active_cli: 'gemini',
            model: 'gemini-2.5-flash',
        },
    });
    const result = await modelHandler([], ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('gemini-2.5-flash'));
});

test('MD-004: /model does not leak session model from different CLI', async () => {
    const ctx = makeCtx({
        session: {
            active_cli: 'codex',
            model: 'gpt-5.3-codex',
        },
    });
    const result = await modelHandler([], ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('gemini-3-flash-preview'));
    assert.ok(!result.text.includes('gpt-5.3-codex'));
});

test('MD-005: /model <new> then /model shows the updated model', async () => {
    const ctx = makeCtx();
    const change = await modelHandler(['gemini-2.5-flash'], ctx);
    assert.equal(change.ok, true);
    assert.equal(ctx.settings.perCli.gemini.model, 'gemini-2.5-flash');

    const current = await modelHandler([], ctx);
    assert.equal(current.ok, true);
    assert.ok(current.text.includes('gemini-2.5-flash'));
});

test('MD-006: /status shows activeOverrides model when set', async () => {
    const ctx = makeCtx({
        activeOverrides: {
            gemini: { model: 'gemini-2.5-flash' },
        },
    });
    const result = await statusHandler([], ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('gemini-2.5-flash'));
});

test('MD-007: /status shows perCli model by default (no overrides)', async () => {
    const ctx = makeCtx();
    const result = await statusHandler([], ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('gemini-3-flash-preview'));
});

test('MD-008: /status and /model show same model (cross-consistency)', async () => {
    const ctx = makeCtx({
        activeOverrides: {
            gemini: { model: 'gemini-2.5-flash' },
        },
    });
    const modelResult = await modelHandler([], ctx);
    const statusResult = await statusHandler([], ctx);
    // .+ instead of \S+ to handle space-containing model names
    const statusModel = statusResult.text.match(/Model:\s+(.+)/)?.[1]?.trim();
    assert.ok(modelResult.text.includes('gemini-2.5-flash'));
    assert.equal(statusModel, 'gemini-2.5-flash');
});

test('MD-009: /status effort uses activeOverrides over perCli', async () => {
    const ctx = makeCtx({
        activeOverrides: {
            gemini: { model: 'gemini-2.5-flash', effort: 'high' },
        },
    });
    const result = await statusHandler([], ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('high'), '/status should show activeOverrides effort');
});

test('MD-010: /status effort does not leak from different CLI session', async () => {
    const ctx = makeCtx({
        session: {
            active_cli: 'codex',
            model: 'gpt-5.3-codex',
            effort: 'low',
        },
    });
    // settings.cli is 'gemini', session is 'codex' → effort should come from perCli.gemini, not session
    const result = await statusHandler([], ctx);
    assert.equal(result.ok, true);
    // perCli.gemini.effort is '' (empty), so final should be '-' (default), NOT 'low' from codex session
    assert.ok(!result.text.includes('low'), '/status should not leak effort from different CLI session');
});

test('MD-011: /status handles space-containing model names', async () => {
    const ctx = makeCtx({
        activeOverrides: {
            gemini: { model: 'my custom model v2' },
        },
    });
    const modelResult = await modelHandler([], ctx);
    const statusResult = await statusHandler([], ctx);
    const statusModel = statusResult.text.match(/Model:\s+(.+)/)?.[1]?.trim();
    assert.ok(modelResult.text.includes('my custom model v2'));
    assert.equal(statusModel, 'my custom model v2');
});
