import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSlackText } from '../../src/slack/send-only-client.ts';
import { sendDiscordDm } from '../../src/discord/send-only-client.ts';
import { deliveryFailed, deliverySent } from '../../src/messaging/delivery-outcome.ts';
import { sendResultHttpStatus } from '../../src/messaging/send-result.ts';

// #687: 'success' used to mean three different things. Slack meant posted,
// Discord meant HTTP 2xx with the message id thrown away, Telegram meant the
// call did not throw. These pin the common vocabulary that replaced that.

const slackTarget = { channel: 'slack', targetId: 'D1', targetKind: 'user', peerKind: 'direct' } as const;

test('a Slack text send reports the posted message id on the common receipt', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: true, ts: '1700000000.0001' }))) as typeof fetch;
    const result = await sendSlackText('fixture', slackTarget, 'plain answer', { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.deliveryStatus, 'sent');
    assert.equal(result.platformMessageId, '1700000000.0001');
    assert.equal(result.ambiguous, false);
    // No tables and no rich features means nothing was verified, so the receipt
    // makes no verification claim at all rather than inventing one.
    assert.equal('verification' in result, false);
});

test('a failed Slack send keeps status as the HTTP code, not a delivery word', async () => {
    const fetchImpl = (async () => ({
        ok: false, status: 403, headers: new Headers(), text: async () => '',
    })) as unknown as typeof fetch;
    const result = await sendSlackText('fixture', slackTarget, 'plain answer', { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.deliveryStatus, 'failed');
    // The whole reason the classification is called deliveryStatus: this key is
    // already the HTTP code and the channel route maps the response from it.
    assert.equal(result.status, 403);
    assert.equal(sendResultHttpStatus(result), 403);
});

test('a Discord send carries the platform message id instead of discarding it', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
        const isOpen = String(url).endsWith('/users/@me/channels');
        return new Response(JSON.stringify(isOpen ? { id: 'DM123' } : { id: '111222333444555666' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const result = await sendDiscordDm('token', 'USER9', 'digest payload', fetchImpl);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.platformMessageId, '111222333444555666');
    assert.equal(result.deliveryStatus, 'sent');
    assert.equal(result.ambiguous, false);
});

test('a Discord send with an unreadable body stays sent but ambiguous', async () => {
    // An empty or non-JSON body still means the message was posted. Turning that
    // into a transport failure would invent an error out of a success, so the
    // parse swallows it and reports an unknown id instead.
    const fetchImpl = (async (url: string | URL | Request) => {
        const isOpen = String(url).endsWith('/users/@me/channels');
        if (isOpen) return new Response(JSON.stringify({ id: 'DM123' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return new Response('<<not json>>', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }) as typeof fetch;
    const result = await sendDiscordDm('token', 'USER9', 'digest payload', fetchImpl);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.platformMessageId, null);
    assert.equal(result.deliveryStatus, 'sent');
    assert.equal(result.ambiguous, true);
});

test('the common receipt can express posted-but-unverified', () => {
    assert.deepEqual(deliverySent('1.1', { verification: 'failed' }),
        { deliveryStatus: 'sent', platformMessageId: '1.1', ambiguous: false, verification: 'failed' });
    // Absent rather than undefined: exactOptionalPropertyTypes, and a caller
    // checking 'verification' in receipt must not see a key that says nothing.
    assert.equal('verification' in deliverySent('1.1'), false);
    assert.deepEqual(deliverySent(null),
        { deliveryStatus: 'sent', platformMessageId: null, ambiguous: true });
    assert.deepEqual(deliveryFailed(null),
        { deliveryStatus: 'failed', platformMessageId: null, ambiguous: false });
});
