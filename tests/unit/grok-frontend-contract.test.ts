import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const src = (path: string) => readFileSync(join(root, path), 'utf8');

test('GROK-FE-001: provider icons include local Grok SVG assets and aliases', () => {
    const icons = src('public/js/provider-icons.ts');
    const colorSvg = src('public/assets/providers/grok-color.svg');
    const monoSvg = src('public/assets/providers/grok.svg');
    assert.match(icons, /grok-color\.svg\?raw/);
    assert.match(icons, /grok\.svg\?raw/);
    assert.match(icons, /normalized\.startsWith\('grok'\)/);
    assert.match(icons, /label:\s*'Grok'/);
    for (const svg of [colorSvg, monoSvg]) {
        assert.match(svg, /<svg[^>]+viewBox=/);
        assert.doesNotMatch(svg, /<script|<style|(?:href|src)=["']https?:\/\//);
    }
});

test('CODEX-FE-001: provider icons keep codex original and color only codex-app', () => {
    const icons = src('public/js/provider-icons.ts');
    assert.match(icons, /'codex-app'/);
    assert.match(icons, /normalized === 'codexapp'/);
    assert.match(icons, /codex:\s*\{\s*color:\s*openaiSvg,\s*mono:\s*openaiSvg/);
    assert.match(icons, /'codex-app':\s*\{\s*color:\s*openaiColorSvg,\s*mono:\s*openaiSvg/);
    assert.match(icons, /Codex App \(OpenAI\)/);
});

test('CLAUDE-EXEC-FE-001: frontend presents claude-i as Claude Exec', () => {
    const meta = src('public/manager/src/settings/pages/components/agent/agent-meta.ts');
    const constants = src('public/js/constants.ts');
    const icons = src('public/js/provider-icons.ts');
    const settingsCore = src('public/js/features/settings-core.ts');
    const cliStatus = src('public/js/features/settings-cli-status.ts');
    assert.match(meta, /'claude-i':\s*\{[\s\S]*label:\s*'Claude Exec'/);
    assert.match(constants, /'claude-i':\s*\{[\s\S]*label:\s*'Claude Exec'/);
    assert.match(icons, /'claude-i':\s*'Claude Exec'/);
    assert.match(settingsCore, /cliDisplayLabel\(cli\)/);
    assert.match(cliStatus, /providerLabel\(name\)/);
});

test('GROK-FE-002: legacy settings fallback registry exposes grok-build without effort', () => {
    const constants = src('public/js/constants.ts');
    assert.match(constants, /grok:\s*\{/);
    assert.match(constants, /label:\s*'Grok'/);
    assert.match(constants, /models:\s*\['grok-build'\]/);
    assert.match(constants, /efforts:\s*\[\]/);
    assert.match(constants, /unsupported by grok-build/);
});

test('GROK-FE-003: quota renderer shows Grok Heavy auth-status instead of fake quota bars', () => {
    const status = src('public/js/features/settings-cli-status.ts');
    assert.match(status, /name === 'grok'/);
    assert.match(status, /q\?\.quotaCapable === false/);
    assert.match(status, /Grok Heavy/);
    assert.match(status, /Quota not exposed by Grok CLI/);
    const forbiddenClaims = [
        ['Grok ', 'unlimited'].join(''),
        ['Grok quota ', '0%'].join(''),
        ['Grok quota ', '100%'].join(''),
    ];
    for (const claim of forbiddenClaims) {
        assert.ok(!status.includes(claim), `status renderer must not contain ${claim}`);
    }
});

test('GROK-FE-004: manager settings metadata treats Grok as normal CLI with disabled effort', () => {
    const meta = src('public/manager/src/settings/pages/components/agent/agent-meta.ts');
    const employees = src('public/manager/src/settings/pages/components/employees-helpers.ts');
    assert.match(meta, /grok:\s*\{/);
    assert.match(meta, /models:\s*\['grok-build'\]/);
    assert.match(meta, /efforts:\s*\[\]/);
    assert.match(employees, /'grok'/);
    assert.match(meta, /'codex-app':\s*\{/);
});
