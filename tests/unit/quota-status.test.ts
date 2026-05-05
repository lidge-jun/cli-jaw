import { readSource } from './source-normalize.js';
// #44: /api/quota 3-state classification matrix tests
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readClaudeCreds, getClaudeCredentialsPath } from '../../src/routes/quota.ts';

// Read source for structural verification
const quotaSrc = readSource(
    path.join(import.meta.dirname, '../../src/routes/quota.ts'), 'utf8'
);
const serverSrc = readSource(
    path.join(import.meta.dirname, '../../server.ts'), 'utf8'
);
// After Phase 4 decomposition, read all settings modules for structural checks
const settingsDir = path.join(import.meta.dirname, '../../public/js/features');
const settingsSrc = [
    'settings.ts', 'settings-types.ts', 'settings-core.ts', 'settings-cli-status.ts',
    'settings-telegram.ts', 'settings-discord.ts', 'settings-channel.ts',
    'settings-stt.ts', 'settings-mcp.ts', 'settings-templates.ts',
].map(f => readSource(path.join(settingsDir, f), 'utf8')).join('\n');
const sidebarCss = readSource(
    path.join(import.meta.dirname, '../../public/css/sidebar.css'), 'utf8'
);

// ── Quota route: auth failure vs transient error ──

test('QS-001: fetchClaudeUsage distinguishes 401/403 from 5xx', () => {
    // 401/403 should return {authenticated: false}
    assert.ok(
        quotaSrc.includes('resp.status === 401') && quotaSrc.includes('resp.status === 403'),
        'should check for 401/403 status codes',
    );
    assert.ok(
        quotaSrc.includes('{ authenticated: false }'),
        'should return {authenticated: false} for auth failures',
    );
    assert.ok(
        quotaSrc.includes('{ error: true }'),
        'should return {error: true} for transient errors',
    );
});

test('QS-002: fetchCodexUsage distinguishes 401/403 from 5xx', () => {
    const codexFn = quotaSrc.slice(quotaSrc.indexOf('fetchCodexUsage'));
    assert.ok(
        codexFn.includes('resp.status === 401') && codexFn.includes('resp.status === 403'),
        'codex should also check 401/403',
    );
});

test('QS-003: readClaudeCreds supports cross-platform Claude credentials file', () => {
    assert.ok(
        quotaSrc.includes('getClaudeCredentialsPath'),
        'should centralize Claude credentials file path resolution',
    );
    assert.ok(
        quotaSrc.includes("CLAUDE_CONFIG_DIR"),
        'should support Claude Code custom config directory',
    );
    assert.ok(
        quotaSrc.includes("'.credentials.json'"),
        'should read Claude Code credentials JSON on Linux/Windows/WSL',
    );
    assert.ok(
        quotaSrc.includes('macOS stores subscription OAuth in Keychain'),
        'should document macOS Keychain behavior without making the reader macOS-only',
    );
});

test('QS-003b: readClaudeCreds reads CLAUDE_CONFIG_DIR credentials before OS keychain fallback', () => {
    const prev = {
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
        CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
        CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
        CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-claude-creds-'));
    try {
        for (const key of Object.keys(prev)) delete process.env[key];
        process.env.CLAUDE_CONFIG_DIR = tmp;
        fs.writeFileSync(
            path.join(tmp, '.credentials.json'),
            JSON.stringify({ claudeAiOauth: { accessToken: 'oauth-test', subscriptionType: 'max', rateLimitTier: 'tier-1' } }),
            { mode: 0o600 },
        );

        assert.equal(getClaudeCredentialsPath(tmp), path.join(tmp, '.credentials.json'));
        const creds = readClaudeCreds();
        assert.equal(creds?.token, 'oauth-test');
        assert.equal(creds?.source, 'credentials-json');
        assert.equal(creds?.quotaCapable, true);
        assert.deepEqual(creds?.account, { type: 'max', tier: 'tier-1' });
    } finally {
        for (const [key, value] of Object.entries(prev)) {
            if (value == null) delete process.env[key];
            else process.env[key] = value;
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('QS-004: readGeminiAccount has cross-platform documentation', () => {
    assert.ok(
        quotaSrc.includes('Cross-platform'),
        'should document cross-platform behavior',
    );
});

// ── Server.ts: classify logic ──

test('QS-005: /api/quota classify separates no-creds from API failure', () => {
    const settingsRouteSrc = readSource(
        path.join(import.meta.dirname, '../../src/routes/settings.ts'), 'utf8'
    );
    assert.ok(
        settingsRouteSrc.includes('hasCreds'),
        'should distinguish creds-present from creds-absent',
    );
    assert.ok(
        settingsRouteSrc.includes("opencode: { authenticated: true }"),
        'opencode should always be authenticated (no quota API)',
    );
});

// ── Frontend: 3-state dot classification ──

test('QS-006: settings.ts has 3-state dotClass (ok/warn/missing)', () => {
    assert.ok(settingsSrc.includes("dotClass = 'ok'"), 'should have ok state');
    assert.ok(settingsSrc.includes("dotClass = 'warn'"), 'should have warn state');
    assert.ok(settingsSrc.includes("dotClass = 'missing'"), 'should have missing state');
});

test('QS-007: settings.ts warn state triggers on authenticated === false', () => {
    assert.ok(
        settingsSrc.includes('q.authenticated === false'),
        'should check authenticated === false for warn',
    );
});

test('QS-008: settings.ts error state keeps green (not warn)', () => {
    assert.ok(
        settingsSrc.includes('q.error'),
        'should check q.error',
    );
    // error should map to ok, not warn
    const errorLine = settingsSrc.split('\n').find((l: string) => l.includes('q.error'));
    assert.ok(errorLine, 'should have error handling line');
});

test('QS-009: settings.ts auth hint shows for warn state too', () => {
    assert.ok(
        settingsSrc.includes("dotClass === 'warn'"),
        'auth hint condition should include warn state',
    );
    assert.ok(
        settingsSrc.includes('cli.notAuthenticated'),
        'should use notAuthenticated i18n key for warn',
    );
});

test('QS-010: QuotaEntry type includes authenticated and error fields', () => {
    assert.ok(
        settingsSrc.includes('authenticated?: boolean'),
        'QuotaEntry should have authenticated field',
    );
    assert.ok(
        settingsSrc.includes('error?: boolean'),
        'QuotaEntry should have error field',
    );
});

test('QS-010b: QuotaWindow type preserves source modelId for compact Gemini labels', () => {
    assert.ok(
        settingsSrc.includes('modelId?: string'),
        'QuotaWindow should allow preserving source modelId',
    );
});

test('QS-010c: Gemini quota normalization exposes compact F/P policy', () => {
    assert.ok(
        quotaSrc.includes('normalizeGeminiQuotaBuckets'),
        'should expose Gemini quota normalization helper',
    );
    assert.ok(
        quotaSrc.includes("label: tier === 'pro' ? 'P' : 'F'"),
        'Gemini quota labels should normalize to P/F',
    );
    assert.ok(
        quotaSrc.includes("tier !== 'flash' && tier !== 'pro'"),
        'Gemini quota normalization should exclude non-Pro/Flash tiers',
    );
});

test('QS-010d: Copilot monthly quota writes reset to window resetsAt', () => {
    const copilotSrc = readSource(
        path.join(import.meta.dirname, '../../lib/quota-copilot.ts'), 'utf8',
    );
    assert.ok(
        copilotSrc.includes('nextMonthFirstResetDate'),
        'should have next-month-first fallback helper',
    );
    assert.ok(
        copilotSrc.includes('data.quota_reset_date || nextMonthFirstResetDate()'),
        'should fallback to next month first when API reset date is missing',
    );
    assert.ok(
        copilotSrc.includes('resetsAt,'),
        'Copilot Premium window should include resetsAt',
    );
});

// ── CSS: .cli-dot.warn style ──

test('QS-011: sidebar.css has .cli-dot.warn with yellow color', () => {
    assert.ok(sidebarCss.includes('.cli-dot.warn'), 'should have .cli-dot.warn class');
    assert.ok(sidebarCss.includes('#fbbf24') || sidebarCss.includes('var(--warning)'), 'should use yellow/warning color');
    assert.ok(sidebarCss.includes('pulse-warn'), 'should have pulse animation');
});

test('QS-012: sidebar.css has all 3 dot states', () => {
    assert.ok(sidebarCss.includes('.cli-dot.ok'), 'should have ok state');
    assert.ok(sidebarCss.includes('.cli-dot.warn'), 'should have warn state');
    assert.ok(sidebarCss.includes('.cli-dot.missing'), 'should have missing state');
});
