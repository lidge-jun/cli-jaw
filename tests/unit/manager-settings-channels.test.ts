// Phase 3 — Channels (Telegram + Discord) page primitives.
//
// Pure helpers + dirty-store wiring for the channels pages. Verifies:
//   • numeric chat-id validation + parse
//   • snowflake ID validation
//   • secret-field never seeds the original token
//   • active-channel toggle writes a single dirty key
//   • cross-page collisions resolve to last-write-wins on `channel`
//   • saveBundle + expandPatch produce the exact PUT body shape

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDirtyStore } from '../../public/manager/src/settings/dirty-store';
import { expandPatch } from '../../public/manager/src/settings/pages/path-utils';
import {
    isValidChatId,
    partitionChatIds,
    chatIdsToChips,
    chipsToChatIds,
} from '../../public/manager/src/settings/pages/ChannelsTelegram';
import { isValidSnowflake } from '../../public/manager/src/settings/pages/ChannelsDiscord';
import {
    interpretTelegramProbe,
    interpretDiscordHealth,
} from '../../public/manager/src/settings/pages/components/HealthBadge';

// ─── chat-id validation ──────────────────────────────────────────────

test('isValidChatId accepts plain integers and signed channel IDs', () => {
    assert.equal(isValidChatId('123456789'), true);
    assert.equal(isValidChatId('-1001234567890'), true);
    assert.equal(isValidChatId('  42  '), true);
});

test('isValidChatId rejects non-numeric, floats, scientific, empty', () => {
    assert.equal(isValidChatId(''), false);
    assert.equal(isValidChatId('abc'), false);
    assert.equal(isValidChatId('1.5'), false);
    assert.equal(isValidChatId('1e9'), false);
    assert.equal(isValidChatId('--1'), false);
    assert.equal(isValidChatId('+1'), false);
});

test('partitionChatIds splits chips by validity', () => {
    const { valid, invalid } = partitionChatIds(['1', 'abc', ' -2 ', '3.0']);
    assert.deepEqual(valid, ['1', '-2']);
    assert.deepEqual(invalid, ['abc', '3.0']);
});

test('chatIdsToChips drops non-finite values', () => {
    const chips = chatIdsToChips([1, 2, Number.NaN, Number.POSITIVE_INFINITY, -3]);
    assert.deepEqual(chips, ['1', '2', '-3']);
});

test('chipsToChatIds round-trips numeric chips and drops invalid', () => {
    const ids = chipsToChatIds(['1', 'abc', '2', '3.5']);
    assert.deepEqual(ids, [1, 2]);
});

// ─── snowflake validation ────────────────────────────────────────────

test('isValidSnowflake accepts long numeric strings', () => {
    assert.equal(isValidSnowflake('123456789012345678'), true);
    assert.equal(isValidSnowflake('  987654  '), true);
});

test('isValidSnowflake rejects letters, signs, empty, too short', () => {
    assert.equal(isValidSnowflake(''), false);
    assert.equal(isValidSnowflake('123'), false);
    assert.equal(isValidSnowflake('-12345'), false);
    assert.equal(isValidSnowflake('123abc456'), false);
});

// ─── ActiveChannelToggle dirty-key behaviour ─────────────────────────

test('Active channel write sets a single dirty entry under "channel"', () => {
    const store = createDirtyStore();
    store.set('channel', { value: 'discord', original: 'telegram', valid: true });
    assert.equal(store.pending.size, 1);
    assert.equal(store.pending.get('channel')?.value, 'discord');
});

test('Both pages write to the same channel key — last-write-wins, no double entry', () => {
    const store = createDirtyStore();
    // Telegram page writes
    store.set('channel', { value: 'discord', original: 'telegram', valid: true });
    // Discord page writes — same key, replaces
    store.set('channel', { value: 'telegram', original: 'telegram', valid: true });
    // Reverted to original → entry cleared
    assert.equal(store.isDirty(), false);
    assert.equal(store.pending.size, 0);
});

test('Active channel switch with unsaved Telegram fields keeps both pending', () => {
    const store = createDirtyStore();
    store.set('telegram.enabled', { value: true, original: false, valid: true });
    store.set('channel', { value: 'discord', original: 'telegram', valid: true });
    const bundle = store.saveBundle();
    assert.deepEqual(Object.keys(bundle).sort(), ['channel', 'telegram.enabled']);
});

// ─── saveBundle + expandPatch shape ──────────────────────────────────

test('Telegram edits expand to nested PUT body', () => {
    const store = createDirtyStore();
    store.set('telegram.enabled', { value: true, original: false, valid: true });
    store.set('telegram.token', { value: 'abc:123', original: '', valid: true });
    store.set('telegram.allowedChatIds', { value: [1, 2], original: [], valid: true });
    store.set('channel', { value: 'telegram', original: 'discord', valid: true });
    const patch = expandPatch(store.saveBundle());
    assert.deepEqual(patch, {
        channel: 'telegram',
        telegram: {
            enabled: true,
            token: 'abc:123',
            allowedChatIds: [1, 2],
        },
    });
});

test('Discord edits expand to nested PUT body', () => {
    const store = createDirtyStore();
    store.set('discord.enabled', { value: true, original: false, valid: true });
    store.set('discord.guildId', {
        value: '123456789012345678',
        original: '',
        valid: true,
    });
    store.set('discord.channelIds', {
        value: ['987654321098765432'],
        original: [],
        valid: true,
    });
    store.set('discord.allowBots', { value: true, original: false, valid: true });
    const patch = expandPatch(store.saveBundle());
    assert.deepEqual(patch, {
        discord: {
            enabled: true,
            guildId: '123456789012345678',
            channelIds: ['987654321098765432'],
            allowBots: true,
        },
    });
});

test('Invalid allowedChatIds entry is dropped from saveBundle', () => {
    const store = createDirtyStore();
    store.set('telegram.allowedChatIds', { value: [], original: [42], valid: false });
    store.set('telegram.enabled', { value: true, original: false, valid: true });
    const bundle = store.saveBundle();
    assert.deepEqual(Object.keys(bundle), ['telegram.enabled']);
});

// ─── secret-field semantics (no seeding original token) ──────────────

test('Empty token input does not produce a dirty entry', () => {
    // Page contract: when the input is empty, we remove the dirty key — the
    // saved value stays untouched. This guards against accidentally clearing
    // the existing token by tabbing through the field.
    const store = createDirtyStore();
    store.set('telegram.token', { value: '', original: 'real-token', valid: true });
    // Page calls remove() rather than set() in this path — emulate it directly.
    store.remove('telegram.token');
    assert.equal(store.pending.has('telegram.token'), false);
});

// ─── HealthBadge interpreters ────────────────────────────────────────

test('interpretTelegramProbe maps {ok:true,username} → ok', () => {
    const state = interpretTelegramProbe({ ok: true, username: 'jaw_bot' });
    assert.equal(state.kind, 'ok');
    assert.equal(state.kind === 'ok' ? state.detail : null, '@jaw_bot');
});

test('interpretTelegramProbe maps {ok:false,error} → error', () => {
    const state = interpretTelegramProbe({ ok: false, error: 'bad token' });
    assert.equal(state.kind, 'error');
});

test('interpretDiscordHealth flags degraded mode', () => {
    const state = interpretDiscordHealth({
        discord: { ready: true, degraded: true, degradedReason: 'intent missing' },
    });
    assert.equal(state.kind, 'degraded');
});

test('interpretDiscordHealth maps healthy bot to ok', () => {
    const state = interpretDiscordHealth({ discord: { ready: true } });
    assert.equal(state.kind, 'ok');
});

test('interpretDiscordHealth handles missing block as unknown', () => {
    const state = interpretDiscordHealth({});
    assert.equal(state.kind, 'unknown');
});
