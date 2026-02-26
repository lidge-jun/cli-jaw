import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const postinstallSrc = fs.readFileSync(join(__dirname, '../../bin/postinstall.ts'), 'utf8');
const initSrc = fs.readFileSync(join(__dirname, '../../bin/commands/init.ts'), 'utf8');

// ── SAF-001: safe guard with JAW_SAFE ──

test('SAF-001: postinstall has JAW_SAFE safe mode guard', () => {
    assert.ok(postinstallSrc.includes("JAW_SAFE === '1'"), 'checks JAW_SAFE');
    assert.ok(postinstallSrc.includes("JAW_SAFE === 'true'"), 'checks JAW_SAFE=true');
});

// ── SAF-002: safe guard with npm_config_jaw_safe ──

test('SAF-002: postinstall has npm_config_jaw_safe guard', () => {
    assert.ok(postinstallSrc.includes("npm_config_jaw_safe === '1'"), 'checks npm_config_jaw_safe=1');
    assert.ok(postinstallSrc.includes("npm_config_jaw_safe === 'true'"), 'checks npm_config_jaw_safe=true');
});

// ── SAF-003: safe guard exits early ──

test('SAF-003: safe mode exits with process.exit(0)', () => {
    const guardStart = postinstallSrc.indexOf('if (isSafeMode)');
    const guardBlock = postinstallSrc.slice(guardStart, guardStart + 500);
    assert.ok(guardBlock.includes('process.exit(0)'), 'exits cleanly in safe mode');
    assert.ok(guardBlock.includes('safe mode'), 'prints safe mode message');
});

// ── SAF-004: installCliTools exported ──

test('SAF-004: installCliTools is exported', () => {
    assert.ok(postinstallSrc.includes('export async function installCliTools'), 'installCliTools exported');
});

// ── SAF-005: installMcpServers exported ──

test('SAF-005: installMcpServers is exported', () => {
    assert.ok(postinstallSrc.includes('export async function installMcpServers'), 'installMcpServers exported');
});

// ── SAF-006: installSkillDeps exported ──

test('SAF-006: installSkillDeps is exported', () => {
    assert.ok(postinstallSrc.includes('export async function installSkillDeps'), 'installSkillDeps exported');
});

// ── SAF-007: InstallOpts type exported ──

test('SAF-007: InstallOpts type is exported', () => {
    assert.ok(postinstallSrc.includes('export type InstallOpts'), 'InstallOpts type exported');
});

// ── SAF-008: dryRun support in all 3 functions ──

test('SAF-008: all install functions support dryRun', () => {
    const cliBlock = postinstallSrc.slice(postinstallSrc.indexOf('installCliTools'));
    const mcpBlock = postinstallSrc.slice(postinstallSrc.indexOf('installMcpServers'));
    const depsBlock = postinstallSrc.slice(postinstallSrc.indexOf('installSkillDeps'));
    assert.ok(cliBlock.includes('opts.dryRun'), 'installCliTools supports dryRun');
    assert.ok(mcpBlock.includes('opts.dryRun'), 'installMcpServers supports dryRun');
    assert.ok(depsBlock.includes('opts.dryRun'), 'installSkillDeps supports dryRun');
});

// ── INIT-001: --safe option ──

test('INIT-001: init.ts has --safe option', () => {
    assert.ok(initSrc.includes("safe: { type: 'boolean'"), '--safe option defined');
});

// ── INIT-002: --dry-run option ──

test('INIT-002: init.ts has --dry-run option', () => {
    assert.ok(initSrc.includes("'dry-run': { type: 'boolean'"), '--dry-run option defined');
});

// ── INIT-003: no direct import('../postinstall.js') side-effect ──

test('INIT-003: init.ts does not import postinstall.js as side-effect', () => {
    assert.ok(
        !initSrc.includes("await import('../postinstall.js')"),
        'no side-effect import of postinstall',
    );
});

// ── INIT-004: uses extracted functions ──

test('INIT-004: init.ts imports and calls extracted install functions', () => {
    assert.ok(initSrc.includes('installCliTools'), 'calls installCliTools');
    assert.ok(initSrc.includes('installMcpServers'), 'calls installMcpServers');
    assert.ok(initSrc.includes('installSkillDeps'), 'calls installSkillDeps');
});
