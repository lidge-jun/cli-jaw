// P37-PROMPT: A1 template must carry the Desktop/Browser Control anchor,
// intent matrix, who-performs-it block, and forbidden phrases.
// Matches devlog/_plan/computeruse/37_revisions_and_integration.md §D/§E/§M.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const A1_PATH = path.resolve(here, '..', '..', 'src', 'prompt', 'templates', 'a1-system.md');
const CONTROL_SYS_PATH = path.resolve(here, '..', '..', 'src', 'prompt', 'templates', 'control-system.md');

function readA1(): string {
    return fs.readFileSync(A1_PATH, 'utf8');
}

test('P37-PROMPT-001: A1 carries Desktop/Browser Control anchor pair', () => {
    const a1 = readA1();
    assert.match(a1, /<!-- anchor:desktop-control -->/);
    assert.match(a1, /<!-- \/anchor:desktop-control -->/);
});

test('P37-PROMPT-002: A1 has both CDP path and Computer Use path sections', () => {
    const a1 = readA1();
    assert.match(a1, /CDP path/);
    assert.match(a1, /Computer Use path/);
    assert.match(a1, /mcp__computer_use__/);
});

test('P37-PROMPT-003: A1 names all Computer Use action classes', () => {
    const a1 = readA1();
    for (const cls of ['state-read', 'element-action', 'value-injection', 'keyboard-action', 'pointer-action']) {
        assert.match(a1, new RegExp(cls), `missing action class: ${cls}`);
    }
});

test('P37-PROMPT-004: A1 contains three forbidden phrases (explicit bans)', () => {
    const a1 = readA1();
    assert.match(a1, /visible cursor/i);
    assert.match(a1, /silently fall back/i);
    assert.match(a1, /Never (claim|say)/i);
});

test('P37-PROMPT-005: A1 has "Who performs it" block (Control not exclusive)', () => {
    const a1 = readA1();
    assert.match(a1, /Who performs it/i);
    assert.match(a1, /may dispatch to `?Control`?/i);
    assert.match(a1, /may self-serve Computer Use/i);
    assert.match(a1, /Neither self-serve nor dispatch is mandatory/i);
});

test('P37-PROMPT-006: A1 intent→action-class matrix row exists', () => {
    const a1 = readA1();
    // the intent/path/action-class header row should be present
    assert.match(a1, /\| *User intent[^\n]*\| *Path *\| *Action class *\|/);
});

test('P37-PROMPT-007: A1 transcript format shows path= and action_class=', () => {
    const a1 = readA1();
    assert.match(a1, /path=cdp/);
    assert.match(a1, /path=computer-use/);
    assert.match(a1, /action_class=/);
    assert.match(a1, /stale_warning=/);
});

test('P37-PROMPT-008: control-system.md exists with Control-specific rules', () => {
    assert.ok(fs.existsSync(CONTROL_SYS_PATH), 'control-system.md must exist');
    const text = fs.readFileSync(CONTROL_SYS_PATH, 'utf8');
    assert.match(text, /You are `Control`/);
    assert.match(text, /path=cdp|path=computer-use/);
    assert.match(text, /get_app_state/);
});
