// Telegram zombie polling prevention — contract tests
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '../..');
const botSrc = fs.readFileSync(join(projectRoot, 'src/telegram/bot.ts'), 'utf8');

test('TZ-001: initTelegram has tgInitLock mutex guard', () => {
    assert.ok(botSrc.includes('tgInitLock'), 'tgInitLock must exist');
    assert.ok(botSrc.includes('already in progress'), 'must warn on concurrent entry');
});

test('TZ-002: 409 retry uses exponential backoff', () => {
    assert.ok(botSrc.includes('Math.pow'), '409 retry must use exponential backoff');
    assert.ok(botSrc.includes('tg409RetryCount'), 'retry counter must exist');
});

test('TZ-003: 409 retry has max limit (TG_MAX_RETRIES)', () => {
    assert.ok(botSrc.includes('TG_MAX_RETRIES'), 'max retry constant must exist');
    assert.ok(botSrc.includes('Max retries'), 'must log when max retries exceeded');
});

test('TZ-004: old.stop() failure triggers wait before proceeding', () => {
    const initIdx = botSrc.indexOf('_initTelegramInner');
    assert.ok(initIdx >= 0, '_initTelegramInner must exist');
    const initBlock = botSrc.slice(initIdx, initIdx + 600);
    assert.ok(initBlock.includes('await old.stop()'), 'initTelegramInner must call old.stop()');
    assert.ok(initBlock.includes('setTimeout(r, 2000)'), 'must wait 2s after stop failure');
});

test('TZ-005: deleteWebhook called before bot.start', () => {
    const delIdx = botSrc.indexOf('deleteWebhook');
    const startIdx = botSrc.indexOf('bot.start(');
    assert.ok(delIdx >= 0, 'deleteWebhook must be called');
    assert.ok(delIdx < startIdx, 'deleteWebhook must come before bot.start');
});

test('TZ-006: onStart resets tg409RetryCount', () => {
    const onStartIdx = botSrc.indexOf('onStart:');
    assert.ok(onStartIdx >= 0, 'onStart callback must exist');
    const block = botSrc.slice(onStartIdx, onStartIdx + 200);
    assert.ok(block.includes('tg409RetryCount = 0'), 'onStart must reset retry counter');
});
