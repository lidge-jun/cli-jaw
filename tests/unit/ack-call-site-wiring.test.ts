// ACK wiring at the call sites, not just in the state machine.
//
// The state-machine tests pass whether or not a channel actually CALLS it. Two
// real bugs got through that gap: Telegram built an ACK handle and then used it
// only inside the queued branch, so the common idle path never reacted at all;
// and Slack/Discord settled the outcome only AFTER an uncancellable image
// upload, which can strand the reaction on `running` while the answer is
// already visible. Source-level assertions because the wiring lives inside
// closures that cannot be imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('every channel ACKs on its normal path, not only when queued', () => {
    // Slack's normal path is the runReply callback, which appears BEFORE the
    // queued branch; Telegram and Discord put theirs after it. So each channel
    // names the marker that opens its own normal path.
    const cases = [
        { channel: 'slack', file: 'src/slack/bot.ts', handle: 'ack', marker: 'runReply: async (ctx: SlackRunContext)' },
        { channel: 'telegram', file: 'src/telegram/bot.ts', handle: 'ackHandle', marker: 'markChatActive(chat.id, ctx)' },
        { channel: 'discord', file: 'src/discord/bot.ts', handle: 'ack', marker: 'markChannelActive(msg.channelId)' },
    ];
    for (const { channel, file, handle, marker } of cases) {
        const src = read(file);
        const idx = src.indexOf(marker);
        assert.ok(idx > 0, `${channel}: normal-path marker not found`);
        const settleIdx = src.indexOf(`${handle}?.settle(`, idx);
        assert.ok(settleIdx > idx,
            `${channel}: the normal path must settle its ACK, not just the queued path`);
    }
});

test('the ACK outcome is settled before the uncancellable image relay', () => {
    // Image upload has no cancellation (#417), so awaiting it first can leave
    // the reaction on `running` after the user already has their answer.
    // Relay calls now carry the outbound cancellation signal (#417), so the
    // anchors match the call prefix rather than the exact argument list.
    const cases = [
        // Slack settles through the once-only settleAck helper (#654 reply ownership);
        // the pin tracks that call site instead.
        { channel: 'slack', file: 'src/slack/bot.ts', settle: 'await settleAck(', relay: 'await relaySlackImages(token, target, text' },
        { channel: 'discord', file: 'src/discord/bot.ts', settle: 'await ack?.settle(ackOutcome);', relay: 'await relayDiscordImages(msg.client, target, text' },
    ];
    for (const { channel, file, settle, relay } of cases) {
        const src = read(file);
        const settleIdx = src.indexOf(settle);
        assert.ok(settleIdx > 0, `${channel}: settle call not found`);
        // Searched FROM the settle: both files contain an earlier relay call in
        // the standing forwarder, which has no ACK at all.
        const relayIdx = src.indexOf(relay, settleIdx);
        assert.ok(relayIdx > settleIdx,
            `${channel}: ACK must settle before the image relay, not after`);
    }
});

test('Telegram records its outcome before the fire-and-forget relay', () => {
    // Telegram relays with void rather than await, so ordering is about when the
    // outcome is recorded rather than a blocking call.
    const src = read('src/telegram/bot.ts');
    const outcomeIdx = src.indexOf("ackOutcome = 'success'");
    const relayIdx = src.indexOf('void relayTelegramImages(bot, chat.id, collectedText');
    assert.ok(outcomeIdx > 0 && relayIdx > 0);
    assert.ok(outcomeIdx < relayIdx, 'the outcome must be recorded before the relay');
});

test('Slack and Discord settle exactly once per turn', () => {
    // Settling in both the happy path and the finally would double-settle; the
    // guard flag is what keeps it to one.
    // Slack latches the first outcome through ackPromise; Discord keeps the flag shape.
    const slack = read('src/slack/bot.ts');
    assert.match(slack, /ackPromise \?\?=/, 'src/slack/bot.ts: settleAck must latch the first outcome');
    const discord = read('src/discord/bot.ts');
    assert.match(discord, /ackSettled = true/, 'src/discord/bot.ts: needs a settled guard');
    assert.match(discord, /if \(!ackSettled\) await ack\?\.settle/, 'src/discord/bot.ts: the finally must respect the guard');
});
