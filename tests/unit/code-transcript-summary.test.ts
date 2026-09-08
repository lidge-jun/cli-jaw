import test from 'node:test';
import assert from 'node:assert/strict';
import type { CodeItem } from '../../src/code-mode/wire.ts';
import { noteworthyStatus, shortenPath, summariseToolInput, toolSummary } from '../../public/manager/src/code/tool-summary.ts';
import { pendingUserItem, withPendingUserItem, PENDING_USER_ITEM_ID } from '../../public/manager/src/code/pending-user-item.ts';
import { createCodeDraft } from '../../public/manager/src/code/code-controller-drafts.ts';

const CWD = '/work/repo';
function item(patch: Partial<CodeItem> = {}): CodeItem {
    return { itemId: 'i-1', turnId: 't-1', kind: 'tool_call', status: 'done', createdAt: 1, updatedAt: 1, ...patch };
}
function draft(text: string, kind: 'idle' | 'sending' | 'unknown-send' = 'sending') {
    const d = createCodeDraft({ provider: 'codex-app', cwd: CWD, model: 'm', effort: null, permissionMode: 'ask' });
    d.retry = { text, key: 'key-1', edit: 0 };
    d.operation = { kind, error: null };
    return d;
}

test('a tool call reads as an action, not a function signature', () => {
    const cases: Array<[string, string, string]> = [
        ['read', JSON.stringify({ path: '/work/repo/src/app.ts' }), 'Read src/app.ts'],
        ['apply_patch', JSON.stringify({ file_path: '/work/repo/src/app.ts' }), 'Edit src/app.ts'],
        ['bash', JSON.stringify({ command: 'npm test -- --watch' }), 'Bash npm test -- --watch'],
        ['rg', JSON.stringify({ pattern: 'composer' }), 'Search composer'],
        ['browser_open', JSON.stringify({ url: 'https://example.com' }), 'Open https://example.com'],
    ];
    for (const [name, input, expected] of cases) {
        assert.equal(toolSummary(item({ tool: { name, input } }), CWD), expected);
    }
    // An unrecognised tool keeps its own name: renaming an MCP tool would hide
    // which tool actually ran.
    assert.equal(toolSummary(item({ tool: { name: 'github.create_pr', input: '{}' } }), CWD), 'github.create_pr');
    assert.equal(toolSummary(item({ kind: 'file_change', tool: { name: 'x', input: '/work/repo/a/b.ts' } }), CWD), 'Edit a/b.ts');
    assert.equal(toolSummary(item({ tool: { name: 'read' } }), CWD), 'Read', 'a missing argument still names the action');
});

test('summaries stay one short line whatever the argument shape is', () => {
    assert.equal(summariseToolInput('not json at all\nsecond line', CWD), 'not json at all');
    assert.equal(summariseToolInput('{bad json', CWD), '{bad json');
    assert.equal(summariseToolInput(JSON.stringify({ unrelated: 'x' }), CWD), '');
    assert.equal(summariseToolInput(undefined, CWD), '');
    const long = summariseToolInput('a'.repeat(300), CWD);
    assert.ok(long.length <= 96 && long.endsWith('…'));
    assert.equal(shortenPath('/work/repo/src/deep/file.ts', CWD), 'src/deep/file.ts');
    assert.equal(shortenPath('/elsewhere/short.ts', CWD), '/elsewhere/short.ts');
    assert.equal(shortenPath(`/elsewhere/${'d'.repeat(80)}/x/y.ts`, CWD), '…/x/y.ts');
});

test('only actionable states are worth a badge', () => {
    assert.equal(noteworthyStatus(item({ status: 'done' })), null, 'success is the default and needs no label');
    assert.equal(noteworthyStatus(item({ status: 'running' })), 'Running');
    assert.equal(noteworthyStatus(item({ status: 'error' })), 'Failed');
    assert.equal(noteworthyStatus(item({ kind: 'turn_cancelled', status: 'done' })), 'Stopped');
});

test('a submitted prompt is visible before the server echoes it', () => {
    const d = draft('what did I just type');
    const pending = pendingUserItem(d, []);
    assert.equal(pending?.text, 'what did I just type');
    assert.equal(pending?.kind, 'user_message');
    assert.equal(pending?.status, 'pending');
    assert.equal(pending?.itemId, PENDING_USER_ITEM_ID);
    // It must sort last so it appears where the user expects it.
    assert.equal(pending?.firstSequence, Number.MAX_SAFE_INTEGER);
});

test('the server echo replaces the local copy rather than duplicating it', () => {
    const d = draft('hello');
    const echoed = item({ itemId: 't-1:user', kind: 'user_message', text: 'hello', clientTurnKey: 'key-1' });
    assert.equal(pendingUserItem(d, [echoed]), null);
    assert.deepEqual(withPendingUserItem(d, [echoed]), [echoed]);
    // A different turn's echo must not suppress this one.
    const other = item({ itemId: 't-0:user', kind: 'user_message', text: 'earlier', clientTurnKey: 'key-0' });
    assert.equal(withPendingUserItem(d, [other]).length, 2);
});

test('an unconfirmed send keeps the text on screen instead of dropping it', () => {
    const d = draft('did this send?', 'unknown-send');
    const pending = pendingUserItem(d, []);
    // Unconfirmed is not failed: the turn may still be running on the server.
    assert.equal(pending?.status, 'pending');
    assert.equal(pending?.text, 'did this send?');
});

test('with no pending send the item list is returned untouched', () => {
    const d = createCodeDraft({ provider: 'codex-app', cwd: CWD, model: 'm', effort: null, permissionMode: 'ask' });
    const items = [item()];
    assert.equal(withPendingUserItem(d, items), items);
});
