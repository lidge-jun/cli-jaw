// What the shared Slack harness is for: one stub spec, three product surfaces.
//
// Six Slack unit files used to carry their own `makeFetch`, and every copy was
// pinned to "HTTP 200, ok:true". A 429 or an `invalid_arguments` fixture could
// therefore only ever be written in slack-outbound, and it proved nothing about
// conversation or history — which is how the same Slack send/readback subject
// ended up being fixed repeatedly in separate files.
//
// Each surface gets its OWN harness instance built from the SAME spec constant.
// The spec is what is shared; the call log is not, so every assertion counts
// only its own requests.
import '../setup/isolated-home.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    makeSlackFetch,
    slackInvalidArguments,
    slackRateLimited,
    slackRaw,
} from '../helpers/slack-fetch.mts';
import { slackApi } from '../../src/slack/api.ts';
import {
    resetConversationRateLimitForTest,
    resetSlackConversationCache,
    resolveConversationInfo,
} from '../../src/slack/conversation.ts';
import { fetchSlackHistory } from '../../src/slack/history.ts';
import { resetSlackIdentityCache } from '../../src/slack/identity.ts';
import { sendSlackText } from '../../src/slack/send-only-client.ts';
import { slackTargetFromId } from '../../src/messaging/slack-target.ts';

const TOKEN = 'xoxb-not-a-real-token-000';
const TEAM = 'T0TEST';

// Two minutes, deliberately. src/slack/send-only-client.ts retries inline only
// when the wait is at or under MAX_INLINE_RATE_LIMIT_MS (5s), so a two-minute
// retry-after drives the rate-limit classification without spending real time
// in the unit shard. History is held to one call by `noRetryOnRateLimit`, the
// only seam it has — its backoff is a hardcoded 1s sleep with no injectable
// clock (src/slack/history.ts callWithRetry).
const RATE_LIMITED = slackRateLimited(120);

beforeEach(() => {
    // A 429 suppresses that conversation for 60s and the per-method start gate
    // holds for 1.2s. Without both resets a later call returns the same
    // degraded value having issued no request at all, and the assertion would
    // pass while proving nothing.
    resetSlackConversationCache();
    resetConversationRateLimitForTest();
    resetSlackIdentityCache();
});

test('one rate-limit spec reaches conversation, history, and outbound', async () => {
    const conversation = makeSlackFetch([RATE_LIMITED]);
    const info = await resolveConversationInfo(TOKEN, 'C1', { teamId: TEAM, fetchImpl: conversation.impl });
    // conversations.info never retries: it degrades to the raw id.
    assert.equal(info.resolved, false);
    assert.equal(info.name, 'C1');
    assert.equal(conversation.calls.length, 1);

    const history = makeSlackFetch([RATE_LIMITED]);
    const window = await fetchSlackHistory(TOKEN, 'C1', {
        limit: 10, fetchImpl: history.impl, noRetryOnRateLimit: true,
    });
    if (window.ok) assert.fail('a rate-limited history read must not report ok');
    // `code` carries Slack's raw error; `error` is operator prose.
    assert.equal(window.code, 'ratelimited');
    assert.equal(history.calls.length, 1);

    const outbound = makeSlackFetch([RATE_LIMITED]);
    const sent = await sendSlackText(TOKEN, slackTargetFromId('C1'), 'hi', { fetchImpl: outbound.impl });
    assert.equal(sent.ok, false);
    assert.equal(sent.status, 429);
    // retry-after is seconds on the wire and milliseconds in the result.
    assert.equal(sent.retryAfterMs, 120_000);
    assert.equal(outbound.calls.length, 1);
});

test('one invalid_arguments spec reaches conversation and history', async () => {
    const conversation = makeSlackFetch([slackInvalidArguments()]);
    const info = await resolveConversationInfo(TOKEN, 'C2', { teamId: TEAM, fetchImpl: conversation.impl });
    assert.equal(info.resolved, false);
    assert.equal(conversation.calls.length, 1);

    const history = makeSlackFetch([slackInvalidArguments()]);
    const window = await fetchSlackHistory(TOKEN, 'C2', { limit: 10, fetchImpl: history.impl });
    if (window.ok) assert.fail('invalid_arguments must not report ok');
    assert.equal(window.code, 'invalid_arguments');
    // Not retryable, so no second request and no backoff — unlike ratelimited.
    assert.equal(history.calls.length, 1);
});

test('the harness can answer at the transport level, not only with a Slack body', async () => {
    // The presigned upload POST in src/slack/slack-file.ts reads upload.ok and
    // upload.status directly and never parses a body. slackApi reaching the
    // same empty response reports unknown_error while keeping the HTTP status.
    const transport = makeSlackFetch([slackRaw({ ok: false, status: 502 })]);
    const result = await slackApi(TOKEN, 'auth.test', {}, { fetchImpl: transport.impl });
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.equal(result.error, 'unknown_error');
    assert.equal(transport.calls.length, 1);
});

test('calls record the Slack method, the parsed body, and the original init', async () => {
    const harness = makeSlackFetch({
        'conversations.history': [{ ok: true, messages: [] }],
    });
    await fetchSlackHistory(TOKEN, 'C3', { limit: 25, fetchImpl: harness.impl });
    const call = harness.calls[0];
    assert.ok(call);
    // The Slack RPC name, not the HTTP verb — roster filters on this.
    assert.equal(call.method, 'conversations.history');
    assert.equal(call.body['channel'], 'C3');
    // Digit-only form values arrive as numbers, which is what history asserts.
    assert.equal(call.body['limit'], 25);
    // The HTTP verb stays where slack-outbound reads it, on the original init.
    assert.equal(call.init?.method, 'POST');
});

test('an unscripted method answers ok and a spent queue replays its last entry', async () => {
    // Both behaviours are load-bearing: roster scripts one paging response and
    // then asserts the call ceiling, which only terminates because the last
    // spec replays.
    const harness = makeSlackFetch({ 'conversations.history': [{ ok: true, messages: [], has_more: false }] });
    const first = await fetchSlackHistory(TOKEN, 'C4', { fetchImpl: harness.impl });
    const second = await fetchSlackHistory(TOKEN, 'C4', { fetchImpl: harness.impl });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(harness.calls.length, 2);

    const unscripted = makeSlackFetch({ 'users.list': [{ ok: true, members: [] }] });
    const result = await slackApi(TOKEN, 'team.info', {}, { fetchImpl: unscripted.impl });
    assert.equal(result.ok, true);
});
