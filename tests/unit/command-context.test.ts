import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ctxSrc = fs.readFileSync(join(__dirname, '../../src/cli/command-context.ts'), 'utf8');
const serverSrc = fs.readFileSync(join(__dirname, '../../server.ts'), 'utf8');
const botSrc = fs.readFileSync(join(__dirname, '../../src/telegram/bot.ts'), 'utf8');

// ─── CC-001: makeCommandCtx exports exist ───

test('CC-001: makeCommandCtx function is exported', () => {
    assert.ok(ctxSrc.includes('export function makeCommandCtx'), 'makeCommandCtx should be exported');
});

// ─── CC-002: unified MCP — no empty objects ───

test('CC-002: getMcp returns real loadUnifiedMcp, not empty object', () => {
    assert.ok(ctxSrc.includes('getMcp: () => loadUnifiedMcp()'), 'getMcp uses loadUnifiedMcp');
    assert.ok(!ctxSrc.includes("getMcp: () => ({ servers: {} })"), 'no empty MCP stub');
});

// ─── CC-003: TG settings restriction is in makeCommandCtx ───

test('CC-003: telegram interface restricts settings to fallbackOrder', () => {
    assert.ok(
        ctxSrc.includes("iface === 'telegram'"),
        'makeCommandCtx checks for telegram interface',
    );
    assert.ok(
        ctxSrc.includes('tg.settingsUnsupported'),
        'returns unsupported message for non-fallbackOrder patches',
    );
});

// ─── CC-004: server.ts uses makeCommandCtx ───

test('CC-004: server.ts uses makeCommandCtx instead of inline object', () => {
    assert.ok(
        serverSrc.includes("import { makeCommandCtx }"),
        'server.ts imports makeCommandCtx',
    );
    assert.ok(
        serverSrc.includes("makeCommandCtx('web'"),
        'server.ts calls makeCommandCtx with web interface',
    );
});

// ─── CC-005: bot.ts uses makeCommandCtx ───

test('CC-005: bot.ts uses makeCommandCtx instead of inline object', () => {
    assert.ok(
        botSrc.includes("import { makeCommandCtx }"),
        'bot.ts imports makeCommandCtx',
    );
    assert.ok(
        botSrc.includes("makeCommandCtx('telegram'"),
        'bot.ts calls makeCommandCtx with telegram interface',
    );
});

// ─── CC-006: unified resetSkills (TG previously missing) ───

test('CC-006: resetSkills available in unified context', () => {
    assert.ok(
        ctxSrc.includes('resetSkills: async'),
        'resetSkills is defined in makeCommandCtx',
    );
    assert.ok(
        ctxSrc.includes('copyDefaultSkills'),
        'resetSkills calls copyDefaultSkills',
    );
});

// ─── CC-007: unified getPrompt ───

test('CC-007: getPrompt returns actual file content, not unsupported message', () => {
    assert.ok(
        ctxSrc.includes("fs.existsSync(A2_PATH)"),
        'getPrompt reads actual A2 file',
    );
    assert.ok(
        !ctxSrc.includes('tg.promptUnsupported'),
        'no unsupported message in unified context',
    );
});
