import test from 'node:test';
import assert from 'node:assert/strict';

import {
    describeHeartbeatSchedule,
    getHeartbeatMinuteSlotKey,
    getHeartbeatScheduleTimeZone,
    matchesHeartbeatCron,
    normalizeHeartbeatSchedule,
    validateHeartbeatScheduleInput,
    validateHeartbeatCron,
} from '../../src/memory/heartbeat-schedule.ts';

test('normalizeHeartbeatSchedule defaults to every 5 minutes', () => {
    assert.deepEqual(normalizeHeartbeatSchedule(undefined), { kind: 'every', minutes: 5 });
});

test('normalizeHeartbeatSchedule preserves cron and timezone', () => {
    assert.deepEqual(
        normalizeHeartbeatSchedule({ kind: 'cron', cron: '0 9 * * *', timeZone: 'Asia/Seoul' }),
        { kind: 'cron', cron: '0 9 * * *', timeZone: 'Asia/Seoul' },
    );
});

test('matchesHeartbeatCron respects target timezone', () => {
    const now = new Date('2026-03-07T00:00:00.000Z');
    assert.equal(matchesHeartbeatCron('0 9 * * *', now, 'Asia/Seoul'), true);
    assert.equal(matchesHeartbeatCron('0 9 * * *', now, 'UTC'), false);
});

test('matchesHeartbeatCron supports weekday aliases', () => {
    const mondayUtc = new Date('2026-03-09T00:00:00.000Z');
    assert.equal(matchesHeartbeatCron('0 9 * * mon', mondayUtc, 'Asia/Seoul'), true);
});

test('validateHeartbeatCron rejects malformed expressions', () => {
    assert.match(validateHeartbeatCron('0 9 * *') || '', /5 fields/);
    assert.match(validateHeartbeatCron('61 9 * * *') || '', /out of range/);
});

test('describeHeartbeatSchedule includes timezone label', () => {
    assert.equal(
        describeHeartbeatSchedule({ kind: 'cron', cron: '0 9 * * *', timeZone: 'Asia/Seoul' }),
        'cron 0 9 * * * (Asia/Seoul)',
    );
});

test('getHeartbeatScheduleTimeZone falls back to system timezone', () => {
    assert.equal(getHeartbeatScheduleTimeZone({ kind: 'every', minutes: 5 }), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
});

test('getHeartbeatMinuteSlotKey uses zoned minute, not raw UTC minute', () => {
    const now = new Date('2026-03-07T00:00:00.000Z');
    assert.equal(
        getHeartbeatMinuteSlotKey({ kind: 'cron', cron: '* * * * *', timeZone: 'Asia/Seoul' }, now),
        '2026-03-07 09:00 Asia/Seoul',
    );
});

test('validateHeartbeatScheduleInput returns normalized cron schedule', () => {
    const result = validateHeartbeatScheduleInput({ kind: 'cron', cron: '0   9   * * *', timeZone: 'Asia/Seoul' });
    assert.deepEqual(result, {
        ok: true,
        schedule: { kind: 'cron', cron: '0 9 * * *', timeZone: 'Asia/Seoul' },
    });
});

test('validateHeartbeatScheduleInput rejects invalid timezone', () => {
    const result = validateHeartbeatScheduleInput({ kind: 'cron', cron: '0 9 * * *', timeZone: 'Mars/Base' });
    assert.equal(result.ok, false);
    if (result.ok) assert.fail('expected validation failure');
    assert.equal(result.code, 'invalid_timezone');
});
