/**
 * Browser Port Routing Tests (BP-001 ~ BP-009)
 * Verifies activePort lifecycle, getActivePort() fallback chain,
 * and route cdpPort(req) behavior for issue #49.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

// ─── Source-level verification ───────────────────────
const connectionSrc = fs.readFileSync(
    join(import.meta.dirname!, '..', '..', 'src', 'browser', 'connection.ts'), 'utf8'
);
const routesSrc = fs.readFileSync(
    join(import.meta.dirname!, '..', '..', 'src', 'routes', 'browser.ts'), 'utf8'
);
const indexSrc = fs.readFileSync(
    join(import.meta.dirname!, '..', '..', 'src', 'browser', 'index.ts'), 'utf8'
);

describe('Browser Port Routing (#49)', () => {

    // ─── BP-001: activePort variable exists ─────────────
    it('BP-001: connection.ts declares activePort state variable', () => {
        assert.match(connectionSrc, /let activePort:\s*number\s*\|\s*null\s*=\s*null/,
            'activePort must be declared as number | null = null');
    });

    // ─── BP-002: getActivePort() exported with correct fallback chain ───
    it('BP-002: getActivePort() uses activePort > settings > deriveCdpPort fallback', () => {
        assert.match(connectionSrc, /export function getActivePort\(\):\s*number/,
            'getActivePort must be exported');
        assert.match(connectionSrc, /activePort\s*\|\|\s*settings\.browser\?\.cdpPort\s*\|\|\s*deriveCdpPort\(\)/,
            'Fallback chain must be: activePort || settings.browser?.cdpPort || deriveCdpPort()');
    });

    // ─── BP-003: launchChrome sets activePort on success ──────────
    it('BP-003: launchChrome sets activePort on CDP ready and port reuse', () => {
        // Check both success paths: reuse and fresh launch
        const reuseMatch = connectionSrc.match(/reusing existing instance.*?\n\s*activePort\s*=\s*port/s);
        assert.ok(reuseMatch, 'activePort must be set when reusing existing CDP instance');

        const readyMatch = connectionSrc.match(/if\s*\(ready\)\s*\{[^}]*activePort\s*=\s*port/s);
        assert.ok(readyMatch, 'activePort must be set when CDP readiness polling succeeds');
    });

    // ─── BP-004: closeBrowser clears activePort ──────────
    it('BP-004: closeBrowser resets activePort to null', () => {
        const closeSection = connectionSrc.split('export async function closeBrowser')[1]!;
        assert.match(closeSection, /activePort\s*=\s*null/,
            'closeBrowser must reset activePort to null');
    });

    // ─── BP-005: All connection functions use getActivePort() default ──
    it('BP-005: all exported functions default to getActivePort()', () => {
        const functions = ['connectCdp', 'getActivePage', 'listTabs', 'getBrowserStatus', 'getCdpSession'];
        for (const fn of functions) {
            const re = new RegExp(`export async function ${fn}\\(port\\s*=\\s*getActivePort\\(\\)`);
            assert.match(connectionSrc, re, `${fn} must default to getActivePort()`);
        }
    });

    // ─── BP-006: index.ts re-exports getActivePort ──────
    it('BP-006: index.ts re-exports getActivePort', () => {
        assert.match(indexSrc, /getActivePort/,
            'index.ts must re-export getActivePort');
    });

    // ─── BP-007: routes/browser.ts cdpPort(req) with correct priority ──
    it('BP-007: routes cdpPort(req) checks req param then getActivePort()', () => {
        assert.match(routesSrc, /const cdpPort\s*=\s*\(req:\s*Request\)/,
            'cdpPort must accept Request parameter');
        assert.match(routesSrc, /Number\.isInteger\(p\)\s*&&\s*p\s*>\s*0\s*&&\s*p\s*<=\s*65535/,
            'Port validation must use Number.isInteger with range check');
        assert.match(routesSrc, /browser\.getActivePort\(\)/,
            'Fallback must call browser.getActivePort()');
    });

    // ─── BP-008: All routes use cdpPort(req), not cdpPort() ──────
    it('BP-008: no route uses old cdpPort() without req', () => {
        // Count cdpPort( calls — all should have req
        const oldPattern = /cdpPort\(\)/g;
        const routeMatches = routesSrc.match(oldPattern);
        assert.equal(routeMatches, null,
            'No route should call cdpPort() without req argument');
    });

    // ─── BP-009: settings import removed from routes (no duplicate) ──
    it('BP-009: routes/browser.ts does not import deriveCdpPort', () => {
        // Only check import lines, not comments/docs
        const importLines = routesSrc.split('\n').filter(l => l.startsWith('import '));
        const hasDeriveCdpPortImport = importLines.some(l => l.includes('deriveCdpPort'));
        assert.equal(hasDeriveCdpPortImport, false,
            'deriveCdpPort should not be imported in routes — getActivePort handles it');
    });
});
