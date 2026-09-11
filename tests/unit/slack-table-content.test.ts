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
    assert.equal(result.ok, true);
    assert.equal(result.delivery?.verification, 'failed');
    // #687: posted is not verified. The common receipt says the send happened
    // AND that rendering could not be confirmed, instead of hiding the second
    // half behind ok:true where every caller ignored it.
    assert.equal(result.deliveryStatus, 'sent');
    assert.equal(result.verification, 'failed');
    assert.equal(result.platformMessageId, '1.1');
    assert.equal(result.ambiguous, false);
    assert.match(result.delivery!.messages[0]!.error!, /table_content_mismatch:0:1:0/);
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
test('second chunk mismatch retains first proof and still posts and verifies third chunk', async () => {
    let posts = 0;
    const result = await sendSlackText('fixture', { channel: 'slack', targetId: 'D1', targetKind: 'user', peerKind: 'direct' }, 'fallback', {
        blocks: ['A', 'B', 'C'].map(value => ({ type: 'table', rows: [[textCell(value)]] })),
        fetchImpl: (async (url: string | URL | Request, init?: { body?: unknown }) => {
            if (String(url).endsWith('chat.postMessage')) { posts++; return new Response(JSON.stringify({ ok: true, ts: `1.${posts}` })); }
            // Readback is keyed by the requested ts, not the post counter: every
            // chunk posts before any verification runs, so `posts` is always 3 here.
            const requestedTs = new URLSearchParams(String(init?.body ?? '')).get('latest') ?? '';
            const cell = requestedTs === '1.1' ? 'A' : requestedTs === '1.2' ? 'X' : 'C';
            return new Response(JSON.stringify({ ok: true, messages: [{ ts: requestedTs, ...native([[textCell(cell)]]) }] }));
        }) as typeof fetch,
    });
    assert.equal(result.ok, true); assert.equal(posts, 3); assert.equal(result.delivery?.verifiedTables, 2);
    assert.equal(result.delivery?.verification, 'failed');
    assert.deepEqual(result.delivery?.messages.map(m => m.verification), ['verified', 'failed', 'verified']);
    assert.match(result.delivery!.messages[1]!.error!, /table_content_mismatch/);
    assert.equal(result.delivery?.tableContent, 'failed'); assert.equal(result.retryable, false);
    assert.deepEqual(result.delivery?.messageTs, ['1.1', '1.2', '1.3']);
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
        assert.equal(checked.ok, false); assert.equal(checked.verifiedTables, 0); assert.equal(checked.tableContent, 'unavailable'); assert.equal(checked.verification, 'unavailable');
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
    assert.equal(result.ok, true); assert.equal(result.sent, true); assert.equal(result.retryable, false);
    assert.equal(result.delivery?.verification, 'unavailable');
    assert.equal(result.delivery?.tableContent, 'unavailable');
    assert.equal(posts, 1); assert.equal(cancelled, true); assert.ok(pulls < 40);
    assert.equal(result.delivery?.messages[0]?.error, 'slack_sensitive_request_failed');
});

test('CommonMark character references decode once in text and labels, never code or escaped ampersands', () => {
    const cases = [
        ['A &amp; B &#38; C &#x26; D &copy; &NotEqualTilde;', 'A & B & C & D © ≂̸'],
        ['&amp;amp; &notAnEntity; &#0;', '&amp; &notAnEntity; �'],
        ['\\&amp; \\&#38; \\&#x26;', '&amp; &#38; &#x26;'],
    ];
    for (const [source, rendered] of cases) {
        assert.equal(compare(`| H |\n|---|\n| ${source} |`, [[textCell('H')], [textCell(rendered!)]]).ok, true);
        assert.equal(compare(`| H |\n|---|\n| ${source} |`, [[textCell('H')], [textCell(rendered! + '!')]]).ok, false);
    }
    assert.equal(compare('| H |\n|---|\n| [A &amp; B](https://example.com) `&amp; &#38;` |', [
        [textCell('H')], [richCell([{ type: 'link', text: 'A & B', url: 'https://example.com' },
            { type: 'text', text: ' ' }, { type: 'text', text: '&amp; &#38;', style: { code: true } }])],
    ]).ok, true);
    assert.equal(compare('| H |\n|---|\n| [A \\&amp; B](https://example.com) |', [
        [textCell('H')], [richCell([{ type: 'link', text: 'A &amp; B', url: 'https://example.com' }])],
    ]).ok, true);
});

for (const reason of ['missing_scope', 'ratelimited', 'network', 'missing_message_ts']) {
    test(`${reason} leaves verification unavailable and posts every chunk exactly once`, async () => {
        let posts = 0; let reads = 0;
        const result = await sendSlackText('fixture', target, 'fallback', {
            blocks: ['A', 'B', 'C'].map(value => ({ type: 'table', rows: [[textCell(value)]] })),
            fetchImpl: async url => {
                if (String(url).endsWith('chat.postMessage')) {
                    posts++;
                    return new Response(JSON.stringify({ ok: true, ...(reason === 'missing_message_ts' ? {} : { ts: `2.${posts}` }) }));
                }
                reads++;
                if (reason === 'network') throw new Error('fixture_network_error');
                return new Response(JSON.stringify({ ok: false, error: reason }));
            },
        });
        assert.equal(result.ok, true); assert.equal(result.sent, true); assert.equal(result.retryable, false);
        assert.equal(posts, 3); assert.equal(reads, reason === 'missing_message_ts' ? 0 : 3);
        assert.equal(result.delivery?.verification, 'unavailable');
        assert.equal(result.delivery?.tableContent, 'unavailable');
        assert.equal(result.delivery?.verifiedTables, 0);
        assert.equal(result.delivery?.postedChunks, 3); assert.equal(result.delivery?.totalChunks, 3);
        for (const message of result.delivery!.messages) {
            assert.equal(message.verification, 'unavailable'); assert.equal(message.tableContent, 'unavailable');
            assert.equal(message.error, reason === 'network' ? 'slack_sensitive_request_failed' : reason);
        }
    });
}

test('actual POST failure keeps partial receipt and does not retry or post remaining chunks', async () => {
    let posts = 0;
    const result = await sendSlackText('fixture', target, 'fallback', {
        blocks: ['A', 'B', 'C'].map(value => ({ type: 'table', rows: [[textCell(value)]] })),
        fetchImpl: async url => {
            if (String(url).endsWith('chat.postMessage')) {
                posts++;
                return new Response(JSON.stringify(posts === 1 ? { ok: true, ts: '3.1' } : { ok: false, error: 'internal_error' }));
            }
            return new Response(JSON.stringify({ ok: true, messages: [{ ts: '3.1', ...native([[textCell('A')]]) }] }));
        },
    });
    assert.equal(result.ok, false); assert.equal(result.sent, true); assert.equal(result.retryable, false);
    assert.match(result.error!, /internal_error/); assert.equal(posts, 2);
    assert.equal(result.delivery?.verification, 'unavailable');
    assert.equal(result.delivery?.tableContent, 'unavailable');
    // Verification runs only after every chunk posts, so a mid-answer POST failure
    // leaves the posted chunk checked as delivered but not content-verified.
    assert.equal(result.delivery?.verifiedTables, 0);
    assert.equal(result.delivery?.postedChunks, 1); assert.equal(result.delivery?.totalChunks, 3);
    assert.deepEqual(result.delivery?.messageTs, ['3.1']);
    assert.equal(result.delivery?.messages[0]?.verification, 'not_checked');
});

test('untrusted readback error text never enters successful transport receipts', async () => {
    const privateText = 'private document text /Users/private/report.txt';
    const result = await sendSlackText('fixture', target, '| H |\n|---|\n| X |', {
        fetchImpl: async url => new Response(JSON.stringify(String(url).endsWith('chat.postMessage')
            ? { ok: true, ts: '5.1' } : { ok: false, error: privateText })),
    });
    assert.equal(result.ok, true);
    assert.equal(result.delivery?.verification, 'unavailable');
    assert.equal(result.delivery?.messages[0]?.error, 'slack_request_failed');
    assert.ok(!JSON.stringify(result).includes(privateText));
});

test('onPosted fires after the last post and before any readback', async () => {
    const order: string[] = [];
    const result = await sendSlackText('fixture', target, 'fallback', {
        blocks: ['A', 'B'].map(value => ({ type: 'table', rows: [[textCell(value)]] })),
        onPosted: info => { order.push('posted'); assert.equal(info.postedChunks, 2); },
        fetchImpl: (async (url: string | URL | Request, init?: { body?: unknown }) => {
            if (String(url).endsWith('chat.postMessage')) { order.push('post'); return new Response(JSON.stringify({ ok: true, ts: '7.' + order.length })); }
            order.push('read');
            const ts = new URLSearchParams(String(init?.body ?? '')).get('latest') ?? '';
            return new Response(JSON.stringify({ ok: true, messages: [{ ts, ...native([[textCell(ts === '7.1' ? 'A' : 'B')]]) }] }));
        }) as typeof fetch,
    });
    assert.equal(result.ok, true);
    assert.equal(result.delivery?.verification, 'verified');
    assert.deepEqual(order, ['post', 'post', 'posted', 'read', 'read']);
});

test('stored markdown blocks and data_table still verify as delivered', async () => {
    // Slack can persist a posted markdown block verbatim, and tables as data_table.
    const markdownMessage = { ts: '8.1', blocks: [{ type: 'markdown', text: '# Title\n\n![alt](https://example.com/a.png)' }] };
    const markdownChecked = await verifySlackTables('fixture', target, '8.1', [], { fetchImpl: responseFor(markdownMessage) }, ['heading', 'image']);
    assert.equal(markdownChecked.verification, 'verified');
    assert.deepEqual(markdownChecked.verifiedFeatures, ['heading', 'image']);
    const dataTable = { ts: '8.2', blocks: [{ type: 'data_table', rows: [[textCell('H')], [textCell('V')]] }] };
    const tableChecked = await verifySlackTables('fixture', target, '8.2', [{ rows: 2, columns: 1 }], { fetchImpl: responseFor(dataTable) });
    assert.equal(tableChecked.verification, 'verified');
    assert.equal(tableChecked.verifiedTables, 1);
});

test('readback timeout is named, not reported as a send abort', async () => {
    const fetchImpl = (async () => { throw new DOMException('aborted', 'AbortError'); }) as typeof fetch;
    const checked = await verifySlackTables('fixture', target, '9.1', [{ rows: 1, columns: 1 }], { fetchImpl });
    assert.equal(checked.verification, 'unavailable');
    assert.equal(checked.reason, 'slack_readback_timeout');
});
