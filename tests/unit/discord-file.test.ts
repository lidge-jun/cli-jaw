// Discord file handling tests — Phase 7 Bundle D
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const discordFileSrc = readFileSync(join(projectRoot, 'src/discord/discord-file.ts'), 'utf8');

// ─── Confirmation (#700) ─────────────────────────────
// Discord documents Create Message as returning the created message object;
// 204 No Content is documented only for reactions, deletes and unpin. So an
// answer with no message id on a file POST did not come from Discord, and
// reporting it as a delivered upload is the same hole Slack closed by demanding
// the reserved file id back.
//
// The gateway fallback is exercised here because it needs no HTTP: it runs
// whenever the client has no token.

const gatewayClient = (send: (payload: unknown) => Promise<unknown>) => ({
    token: null,
    channels: { fetch: async () => ({ send }) },
}) as never;

const fileTarget = {
    channel: 'discord', targetKind: 'channel', peerKind: 'channel', targetId: 'C1',
} as never;

test('DCF-700a: a gateway send that returns a Message id is confirmed', async () => {
    const { sendDiscordFile } = await import('../../src/discord/discord-file.js');
    const tmp = join(projectRoot, 'package.json');
    const r = await sendDiscordFile(gatewayClient(async () => ({ id: '123456789' })), fileTarget, tmp);
    assert.equal(r.ok, true);
    assert.equal(r.confirmation, 'confirmed');
    assert.equal(r.platformMessageId, '123456789');
    assert.equal(r.ambiguous, false);
});

test('DCF-700b: a gateway send that names nothing is unconfirmed, not success', async () => {
    const { sendDiscordFile } = await import('../../src/discord/discord-file.js');
    const tmp = join(projectRoot, 'package.json');
    for (const reply of [undefined, null, {}, { id: '' }, { id: 42 }, 'ok']) {
        const r = await sendDiscordFile(gatewayClient(async () => reply), fileTarget, tmp);
        assert.equal(r.ok, false, JSON.stringify(reply ?? null));
        assert.equal(r.confirmation, 'unconfirmed', JSON.stringify(reply ?? null));
        assert.equal(r.error, 'discord_file_send_unconfirmed');
        assert.equal(r.status, 502);
        assert.equal(r.ambiguous, true);
    }
});

test('DCF-700c: a throwing gateway send is a plain failure, NOT unconfirmed', async () => {
    // sendChannelOutput lets an unconfirmed send keep its caption claim. A real
    // rejection delivered nothing, so it must not borrow that exception.
    const { sendDiscordFile } = await import('../../src/discord/discord-file.js');
    const tmp = join(projectRoot, 'package.json');
    const r = await sendDiscordFile(gatewayClient(async () => { throw new Error('nope'); }), fileTarget, tmp);
    assert.equal(r.ok, false);
    assert.equal(r.confirmation, undefined);
});

test('DCF-700d: the REST branch forwards confirmation instead of collapsing to { ok, error }', async () => {
    // The connected-client path is the normal one in production. It used to
    // return only { ok, error } on failure, which threw the flag away exactly
    // where sendChannelOutput needed it.
    assert.match(discordFileSrc, /confirmation: rest\.confirmation/,
        'the REST failure branch must carry the confirmation through');
});

test('DCF-700e: 204 rejection lives in sendDiscordFileRest, not in the scheduler', async () => {
    // 204 IS the documented success for the reaction/delete/unpin routes the
    // scheduler also serves, so the rejection cannot live there.
    const restSrc = readFileSync(join(projectRoot, 'src/discord/send-only-client.ts'), 'utf8');
    const schedulerSrc = readFileSync(join(projectRoot, 'src/discord/rest-scheduler.ts'), 'utf8');
    assert.match(restSrc, /DISCORD_FILE_UNCONFIRMED/, 'the file send must own the unconfirmed verdict');
    assert.ok(!/DISCORD_FILE_UNCONFIRMED|unconfirmed/.test(schedulerSrc),
        'the shared REST scheduler must stay out of this decision');
});

// ─── File size guard ─────────────────────────────────

test('DISCORD_LIMITS defines 10 MiB cap', () => {
    assert.match(discordFileSrc, /10\s*\*\s*1024\s*\*\s*1024/,
        'should define 10 MiB limit');
});

test('validateDiscordFileSize throws on oversized files', () => {
    assert.match(discordFileSrc, /exceeds Discord 10 MiB limit/,
        'should throw descriptive error for oversized files');
    assert.match(discordFileSrc, /statusCode:\s*413/,
        'should set statusCode 413');
});

// ─── Behavior test: validateDiscordFileSize ──────────

test('validateDiscordFileSize accepts files under limit', async () => {
    const { validateDiscordFileSize } = await import('../../src/discord/discord-file.js');
    // Should not throw for 1 MiB
    assert.doesNotThrow(() => validateDiscordFileSize('test.txt', 1024 * 1024));
});

test('validateDiscordFileSize rejects files over 10 MiB', async () => {
    const { validateDiscordFileSize } = await import('../../src/discord/discord-file.js');
    const overLimit = 11 * 1024 * 1024;
    assert.throws(() => validateDiscordFileSize('big.bin', overLimit), /exceeds Discord 10 MiB/);
});

test('validateDiscordFileSize accepts exactly 10 MiB', async () => {
    const { validateDiscordFileSize } = await import('../../src/discord/discord-file.js');
    const exactLimit = 10 * 1024 * 1024;
    assert.doesNotThrow(() => validateDiscordFileSize('exact.bin', exactLimit));
});

// ─── Text-based channel requirement ──────────────────

test('sendDiscordFile checks for text-based channel', () => {
    assert.match(discordFileSrc, /not text-based/,
        'should reject non-text channels');
});

// ─── File attachment format ──────────────────────────

test('sendDiscordFile uses attachment format with basename', () => {
    assert.match(discordFileSrc, /attachment:\s*filePath/,
        'should pass file path as attachment');
    assert.match(discordFileSrc, /basename\(filePath\)/,
        'should use basename for filename');
});
