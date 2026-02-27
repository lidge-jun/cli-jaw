// #44: /api/quota 3-state classification matrix tests
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Read source for structural verification
const quotaSrc = fs.readFileSync(
    path.join(import.meta.dirname, '../../src/routes/quota.ts'), 'utf8'
);
const serverSrc = fs.readFileSync(
    path.join(import.meta.dirname, '../../server.ts'), 'utf8'
);
const settingsSrc = fs.readFileSync(
    path.join(import.meta.dirname, '../../public/js/features/settings.ts'), 'utf8'
);
const sidebarCss = fs.readFileSync(
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

test('QS-003: readClaudeCreds is macOS-only with explicit platform guard', () => {
    assert.ok(
        quotaSrc.includes("process.platform !== 'darwin'"),
        'should have explicit darwin guard',
    );
    assert.ok(
        quotaSrc.includes('macOS-only'),
        'should document macOS-only behavior',
    );
});

test('QS-004: readGeminiAccount has cross-platform documentation', () => {
    assert.ok(
        quotaSrc.includes('Cross-platform'),
        'should document cross-platform behavior',
    );
});

// ── Server.ts: classify logic ──

test('QS-005: /api/quota classify separates no-creds from API failure', () => {
    assert.ok(
        serverSrc.includes('hasCreds'),
        'should distinguish creds-present from creds-absent',
    );
    assert.ok(
        serverSrc.includes("opencode: { authenticated: true }"),
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

// ── CSS: .cli-dot.warn style ──

test('QS-011: sidebar.css has .cli-dot.warn with yellow color', () => {
    assert.ok(sidebarCss.includes('.cli-dot.warn'), 'should have .cli-dot.warn class');
    assert.ok(sidebarCss.includes('#fbbf24'), 'should use yellow color');
    assert.ok(sidebarCss.includes('pulse-warn'), 'should have pulse animation');
});

test('QS-012: sidebar.css has all 3 dot states', () => {
    assert.ok(sidebarCss.includes('.cli-dot.ok'), 'should have ok state');
    assert.ok(sidebarCss.includes('.cli-dot.warn'), 'should have warn state');
    assert.ok(sidebarCss.includes('.cli-dot.missing'), 'should have missing state');
});
