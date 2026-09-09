import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSlackMessageContent } from '../../src/slack/message-content.ts';
const expected = { text: 'fallback', blocks: [{ type: 'markdown', text: '**한글** [문서](https://example.com/a) `x`' }] };
const native = { text: 'Slack-generated fallback', blocks: [{ type: 'rich_text', block_id: 'vendor-generated', elements: [{ type: 'rich_text_section', elements: [
    { type: 'text', text: '한', style: { bold: true } }, { type: 'text', text: '글', style: { bold: true, italic: false } },
    { type: 'text', text: ' ' }, { type: 'link', text: '문서', url: 'https://example.com/a' },
    { type: 'text', text: ' ' }, { type: 'text', text: 'x', style: { code: true } },
] }] }] };
test('independent native spans verify Markdown without comparing generated fallback or block IDs', () => {
    assert.equal(compareSlackMessageContent(expected, native), 'verified');
});
test('changed text, style, link and order fail', () => {
    for (const change of ['text', 'style', 'url', 'order']) {
        const copy = structuredClone(native); const spans = copy.blocks[0]!.elements[0]!.elements;
        if (change === 'text') spans[0]!.text = '다';
        if (change === 'style') spans[0]!.style = { bold: false };
        if (change === 'url') spans[3]!.url = 'https://example.com/b';
        if (change === 'order') spans.reverse();
        assert.equal(compareSlackMessageContent(expected, copy), 'failed', change);
    }
});
const table = { type: 'table', block_id: 'assigned', rows: [[{ type: 'raw_text', text: 'H' }], [{ type: 'raw_text', text: 'X' }]] };
test('Markdown table and prose retain interleaved order and exact cells', () => {
    const input = { text: '', blocks: [{ type: 'markdown', text: 'Before\n\n| H |\n|---|\n| X |' }] };
    const paragraph = { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Before' }] }] };
    assert.equal(compareSlackMessageContent(input, { blocks: [paragraph, table] }), 'verified');
    assert.equal(compareSlackMessageContent(input, { blocks: [table, paragraph] }), 'failed');
    const changed = structuredClone(table); changed.rows[1]![0]!.text = 'Y';
    assert.equal(compareSlackMessageContent(input, { blocks: [paragraph, changed] }), 'failed');
});
test('native number value and display must both survive', () => {
    const block = { type: 'table', rows: [[{ type: 'raw_number', value: 10, text: '10.00' }]] };
    const input = { text: '', blocks: [block] };
    assert.equal(compareSlackMessageContent(input, { blocks: [{ ...block, block_id: 'server' }] }), 'verified');
    for (const cell of [{ value: 11, text: '10.00' }, { value: 10, text: '10' }]) {
        assert.equal(compareSlackMessageContent(input, { blocks: [{ type: 'table', rows: [[{ type: 'raw_number', ...cell }]] }] }), 'failed');
    }
});
test('unchanged unsupported structures never claim verification', () => {
    for (const block of [{ type: 'image', image_url: 'https://example.com/a', alt_text: 'x' },
        { type: 'rich_text', elements: [{ type: 'rich_text_quote', elements: [{ type: 'text', text: 'x' }] }] }]) {
        assert.equal(compareSlackMessageContent({ text: 'x', blocks: [block] }, { text: 'x', blocks: [block] }), 'partial');
    }
});
test('plain text, missing body, unsafe structures and budget overflow are not false positives', () => {
    assert.equal(compareSlackMessageContent({ text: 'x' }, { text: 'x' }), 'verified');
    assert.equal(compareSlackMessageContent({ text: 'x' }, { text: 'y' }), 'failed');
    assert.equal(compareSlackMessageContent(expected, { text: 'fallback' }), 'failed');
    assert.equal(compareSlackMessageContent(expected, { blocks: native.blocks, text: 'x'.repeat(1048577) }), 'partial');
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    assert.equal(compareSlackMessageContent(expected, { blocks: cyclic }), 'partial');
});

import Database from 'better-sqlite3';
import { messageActions } from '../../src/slack/actions-message.ts';
import { configureRtsOutputStore, RtsOutputStore } from '../../src/slack/rts-output-store.ts';
import type { ActionContext, ActionResult, ActionVerification } from '../../src/slack/action-types.ts';
import type { SlackApiResult } from '../../src/slack/api.ts';
test('actual message.update uses semantic readback and retains ID on unsupported or corrupt content', async t => {
    const db = new Database(':memory:'); configureRtsOutputStore(new RtsOutputStore(db));
    t.after(() => { configureRtsOutputStore(undefined); db.close(); });
    const definition = messageActions.find(action => action.operation === 'message.update')!;
    for (const state of ['verified', 'failed', 'partial', 'attachment', 'file', 'malformedAttachment', 'malformedFile', 'emptyBodies'] as const) {
        let writes = 0; let reads = 0;
        const saved = structuredClone(native);
        if (state === 'failed') saved.blocks[0]!.elements[0]!.elements[0]!.text = 'corrupt';
        const extra = state === 'attachment' ? { attachments: [{ text: 'EXTRA_BODY_CANARY' }] }
            : state === 'file' ? { files: [{ id: 'F1', title: 'EXTRA_BODY_CANARY' }] }
            : state === 'malformedAttachment' ? { attachments: null }
            : state === 'malformedFile' ? { files: {} }
            : state === 'emptyBodies' ? { attachments: [], files: [], client_msg_id: 'ordinary-metadata' } : {};
        const blocks = state === 'partial' ? [{ type: 'image', image_url: 'https://example.com/image', alt_text: 'unknown' }] : saved.blocks;
        const result = (verification: ActionVerification, data?: unknown, resourceIds: string[] = []): ActionResult => ({ ok: verification === 'verified', operation: 'message.update', verification, retryable: false, resourceIds, data });
        const ctx: ActionContext = {
            token: 'fixture', workspace: 'T1', botUserId: 'UBOT', actor: 'U1', channel: 'C1', credentialKey: 'fixture', operator: true,
            async api<T>(method: string, body: Record<string, unknown>) {
                let data: unknown;
                if (method === 'chat.update') { writes++; assert.equal(body['ts'], '1.1'); data = { ts: '1.1' }; }
                else { assert.equal(method, 'conversations.history'); reads++; data = { messages: [{ ts: '1.1', user: 'UBOT', ...(reads === 1 ? { text: 'old' } : { text: saved.text, blocks, ...extra }) }], has_more: false }; }
                return { ok: true, data } as SlackApiResult<T>;
            },
            checkCurrent() {}, now: () => 0, result,
            fail(error, status = 409, ids = []) { return { ...result('failed', undefined, ids), error, status }; },
            remember() { throw new Error('unexpected resource write'); }, retire() { throw new Error('unexpected resource retirement'); },
            resource: () => undefined, resources: () => [], download: async () => { throw new Error('unexpected download'); },
        };
        const receipt = await definition.prepare({ operation: 'message.update', channel: 'C1', invocationId: 'update', ts: '1.1', text: '**한글** [문서](https://example.com/a) `x`' }).execute(ctx);
        const expectedState = state === 'verified' || state === 'emptyBodies' ? 'verified' : state === 'failed' ? 'failed' : 'partial';
        assert.equal(receipt.verification, expectedState, state); assert.equal(receipt.ok, expectedState === 'verified', state);
        if (expectedState === 'partial') assert.deepEqual(receipt.data, { channel: 'C1', ts: '1.1', content: 'not_checked' });
        assert.ok(!JSON.stringify(receipt).includes('EXTRA_BODY_CANARY'));
        assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(receipt.retryable, false);
        assert.deepEqual(receipt.resourceIds, ['1.1']);
        assert.ok(!JSON.stringify(receipt).includes('corrupt'));
    }
});

for (const key of ['attachments', 'files'] as const) {
    test(`${key}: additional or malformed body is partial, absent and empty remain verified`, () => {
        for (const value of [[{ text: 'EXTRA_BODY_CANARY' }], null, {}, 'malformed', 0, false, undefined]) {
            assert.equal(compareSlackMessageContent(expected, { ...native, [key]: value }), 'partial');
        }
        assert.equal(compareSlackMessageContent(expected, { ...native, [key]: [] }), 'verified');
        const withMetadata = { ...native, client_msg_id: 'metadata', reactions: [{ name: 'eyes', count: 1 }] };
        assert.equal(compareSlackMessageContent(expected, withMetadata), 'verified');
    });
}
