import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSlackText } from '../../src/slack/send-only-client.ts';

test('same-size wrong cell fails without reposting', async () => {
    let posts = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
        if (String(url).endsWith('chat.postMessage')) { posts++; return new Response(JSON.stringify({ ok: true, ts: '1.1' })); }
        return new Response(JSON.stringify({ ok: true, messages: [{ ts: '1.1', blocks: [{ type: 'table', rows: [[{ type: 'raw_text', text: 'H' }], [{ type: 'raw_text', text: 'Y' }]] }] }] }));
    }) as typeof fetch;
    const result = await sendSlackText('fixture', { channel: 'slack', targetId: 'D1', targetKind: 'user', peerKind: 'direct' }, '| H |\n| --- |\n| X |', { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.sent, true);
    assert.equal(result.retryable, false);
    assert.equal(posts, 1);
    assert.equal(result.delivery?.verifiedTables, 0);
});

import { expectedTableContent, storedTableContent, compareTableContent } from '../../src/slack/table-content.ts';
const textCell = (text: string) => ({ type: 'raw_text', text });
const richCell = (elements: unknown[]) => ({ type: 'rich_text', elements: [{ type: 'rich_text_section', elements }] });
const native = (rows: unknown[][]) => ({ blocks: [{ type: 'table', rows }] });
const compare = (markdown: string, rows: unknown[][]) => compareTableContent(expectedTableContent([{ type: 'markdown', text: markdown }]), storedTableContent(native(rows)));

test('exact Korean, empty, escaped pipe and literal code cells', () => {
    assert.equal(compare('| 한글 | 빈칸 | 코드 |\n|---|---|---|\n| A\\|B | | `**x**` |', [
        [textCell('한글'), textCell('빈칸'), textCell('코드')],
        [textCell('A|B'), textCell(''), richCell([{ type: 'text', text: '**x**', style: { code: true } }])],
    ]).ok, true);
});
test('span splitting merges only equal styles and exact link destinations', () => {
    const source = '| H |\n|---|\n| **한글** [문서](https://example.com/a) |';
    const elements = [{ type: 'text', text: '한', style: { bold: true } }, { type: 'text', text: '글', style: { bold: true, italic: false } }, { type: 'text', text: ' ' }, { type: 'link', text: '문서', url: 'https://example.com/a' }];
    assert.equal(compare(source, [[textCell('H')], [richCell(elements)]]).ok, true);
    for (const change of [
        (v: typeof elements) => { v[0]!.style = { bold: false }; },
        (v: typeof elements) => { v[3]!.url = 'https://example.com/b'; },
        (v: typeof elements) => { v[3]!.text = '변경'; },
    ]) { const altered = structuredClone(elements); change(altered); assert.equal(compare(source, [[textCell('H')], [richCell(altered)]]).ok, false); }
});
test('numbers require both value and display; Markdown does not coerce numeric cells', () => {
    const number = { type: 'raw_number', value: 10, text: '10.00' };
    const expected = expectedTableContent(native([[number]]).blocks);
    for (const changed of [{ ...number, value: 11 }, { ...number, text: '10' }, textCell('10.00')]) {
        assert.equal(compareTableContent(expected, storedTableContent(native([[changed]]))).ok, false);
    }
    assert.equal(compareTableContent(expected, storedTableContent(native([[number]]))).ok, true);
    assert.equal(compare('| H |\n|---|\n| 10.00 |', [[textCell('H')], [number]]).ok, false);
});
test('row/column order and extra attachment tables cannot pass', () => {
    const expected = expectedTableContent([{ type: 'markdown', text: '| A | B |\n|---|---|\n| X | Y |' }]);
    const rows = [[textCell('A'), textCell('B')], [textCell('X'), textCell('Y')]];
    for (const changed of [[rows[1]!, rows[0]!], rows.map(row => [...row].reverse())]) assert.equal(compareTableContent(expected, storedTableContent(native(changed))).ok, false);
    assert.equal(compareTableContent(expected, storedTableContent({ ...native(rows), attachments: [native(rows)] })).ok, false);
});
test('unknown, cyclic and excessive stored structures fail closed', () => {
    const cycle: Record<string, unknown> = { type: 'rich_text_section' }; cycle['elements'] = [cycle];
    for (const cell of [richCell([{ type: 'emoji', name: 'x' }]), richCell([cycle]), textCell('x'.repeat(10001)), { type: 'raw_number', value: Infinity, text: 'x' }]) {
        assert.throws(() => storedTableContent(native([[cell]])), /slack_table_content/);
    }
    assert.throws(() => storedTableContent({ blocks: Array(65537).fill(null) }), /limit/);
    assert.throws(() => storedTableContent({ text: 'x'.repeat(1048577) }), /limit/);
});
test('unsupported expectation rejects all chunks before posting', async () => {
    let calls = 0;
    const result = await sendSlackText('fixture', { channel: 'slack', targetId: 'D1', targetKind: 'user', peerKind: 'direct' }, 'fallback', {
        blocks: [ { type: 'table', rows: [[textCell('valid')]] }, { type: 'table', rows: [[richCell([{ type: 'emoji', name: 'x' }])]] } ],
        fetchImpl: (async () => { calls++; throw new Error('must not call'); }) as typeof fetch,
    });
    assert.equal(result.ok, false); assert.equal(result.status, 400); assert.equal(calls, 0);
});
test('second chunk mismatch retains first proof and never posts third chunk', async () => {
    let posts = 0;
    const result = await sendSlackText('fixture', { channel: 'slack', targetId: 'D1', targetKind: 'user', peerKind: 'direct' }, 'fallback', {
        blocks: ['A', 'B', 'C'].map(value => ({ type: 'table', rows: [[textCell(value)]] })),
        fetchImpl: (async (url: string | URL | Request) => {
            if (String(url).endsWith('chat.postMessage')) { posts++; return new Response(JSON.stringify({ ok: true, ts: `1.${posts}` })); }
            return new Response(JSON.stringify({ ok: true, messages: [{ ts: `1.${posts}`, ...native([[textCell(posts === 1 ? 'A' : 'X')]]) }] }));
        }) as typeof fetch,
    });
    assert.equal(result.ok, false); assert.equal(posts, 2); assert.equal(result.delivery?.verifiedTables, 1);
    assert.equal(result.delivery?.tableContent, 'failed'); assert.equal(result.retryable, false);
    assert.deepEqual(result.delivery?.messageTs, ['1.1', '1.2']);
});

import { verifySlackTables } from '../../src/slack/table-verification.ts';
const target = { channel: 'slack', targetId: 'D1', targetKind: 'user', peerKind: 'direct' } as const;
const responseFor = (message: unknown) => (async () => new Response(JSON.stringify({ ok: true, messages: [message] }))) as typeof fetch;
test('legacy shape proof is explicitly not checked; missing prose does not erase table proof', async () => {
    const message = { ts: '1.1', ...native([[textCell('H')]]) };
    const legacy = await verifySlackTables('fixture', target, '1.1', [{ rows: 1, columns: 1 }], { fetchImpl: responseFor(message) });
    assert.equal(legacy.ok, true); assert.equal(legacy.tableContent, 'not_checked');
    const checked = await verifySlackTables('fixture', target, '1.1', [{ rows: 1, columns: 1 }], { fetchImpl: responseFor(message) }, ['quote'], expectedTableContent(message.blocks));
    assert.equal(checked.ok, false); assert.equal(checked.tableContent, 'verified'); assert.equal(checked.verifiedTables, 1);
});
test('malformed readback and wrong timestamp fail with bounded reasons', async () => {
    const expected = expectedTableContent(native([[textCell('H')]]).blocks);
    for (const message of [{ ts: '1.1', attachments: {} }, { ts: '1.2', ...native([[textCell('H')]]) }]) {
        const checked = await verifySlackTables('fixture', target, '1.1', [{ rows: 1, columns: 1 }], { fetchImpl: responseFor(message) }, [], expected);
        assert.equal(checked.ok, false); assert.equal(checked.verifiedTables, 0); assert.equal(checked.tableContent, 'failed');
    }
});
test('table node and URL budgets reject even short rendered text', () => {
    assert.throws(() => storedTableContent(native([[richCell(Array.from({ length: 5000 }, () => ({ type: 'text', text: '' })))]])), /limit/);
    assert.throws(() => storedTableContent(native([[richCell([{ type: 'link', text: 'x', url: 'https://example.com/' + '가'.repeat(4000) }])]])), /limit/);
    assert.throws(() => storedTableContent(native([[{ type: 'raw_text', text: 'x', style: { bold: true } }]])), /unsupported_field/);
});

test('ordinary table readback stops oversized response streaming before full consumption', async () => {
    const { sendSlackText } = await import('../../src/slack/send-only-client.ts');
    let posts = 0; let pulls = 0; let cancelled = false;
    const fetchImpl: typeof fetch = async url => {
        if (String(url).endsWith('chat.postMessage')) { posts++; return new Response(JSON.stringify({ ok: true, ts: '20.000001' })); }
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) { pulls++; controller.enqueue(new Uint8Array(256 * 1024).fill(32)); if (pulls >= 40) controller.close(); },
            cancel() { cancelled = true; },
        });
        return new Response(stream);
    };
    const result = await sendSlackText('fixture', { channel: 'slack', targetKind: 'channel', peerKind: 'direct', targetId: 'D1' }, '| a |\n|---|\n| b |', { fetchImpl });
    assert.equal(result.ok, false); assert.equal(result.sent, true); assert.equal(result.retryable, false);
    assert.equal(posts, 1); assert.equal(cancelled, true); assert.ok(pulls < 40);
    assert.match(result.error ?? '', /slack_response_too_large/);
});
