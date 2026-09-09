import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarContext } from '../../src/agent/calendar-context.ts';

test('September 9, 2026 resolves next Monday to September 14, not 15', () => {
    const now = new Date(2026, 8, 9, 12);
    const before = now.getTime();
    const context = calendarContext(now);
    assert.match(context, /Today: 2026-09-09 \(Wednesday\)/);
    assert.match(context, /This week: 2026-09-07 through 2026-09-13/);
    assert.match(context, /Next week: 2026-09-14 \(Monday\) through 2026-09-20 \(Sunday\)/);
    assert.match(context, /Next Monday: 2026-09-14\./);
    assert.equal(now.getTime(), before, 'the timestamp input remains unchanged');
});

for (const [year, month, day, expected] of [
    [2026, 8, 13, '2026-09-14'], // Sunday
    [2026, 8, 14, '2026-09-21'], // Monday means next calendar week
    [2026, 11, 31, '2027-01-04'],
    [2027, 0, 1, '2027-01-04'],
    [2024, 1, 29, '2024-03-04'],
] as const) {
    test(`calendar boundary ${year}-${month + 1}-${day}`, () => {
        assert.match(calendarContext(new Date(year, month, day, 12)), new RegExp(`Next Monday: ${expected}\\.`));
    });
}

test('local dates and Monday–Sunday ranges survive DST and UTC date boundaries', () => {
    const original = process.env.TZ;
    try {
        for (const [zone, instant, today, nextStart, nextEnd] of [
            ['Asia/Seoul', '2026-09-08T15:30:00Z', '2026-09-09 (Wednesday)', '2026-09-14', '2026-09-20'],
            ['America/New_York', '2026-03-01T17:00:00Z', '2026-03-01 (Sunday)', '2026-03-02', '2026-03-08'],
            ['America/New_York', '2026-03-08T06:30:00Z', '2026-03-08 (Sunday)', '2026-03-09', '2026-03-15'],
            ['America/New_York', '2026-03-08T07:30:00Z', '2026-03-08 (Sunday)', '2026-03-09', '2026-03-15'],
            ['America/New_York', '2026-11-01T05:30:00Z', '2026-11-01 (Sunday)', '2026-11-02', '2026-11-08'],
            ['America/New_York', '2026-11-01T06:30:00Z', '2026-11-01 (Sunday)', '2026-11-02', '2026-11-08'],
            ['America/New_York', '2026-10-25T16:00:00Z', '2026-10-25 (Sunday)', '2026-10-26', '2026-11-01'],
            ['America/Los_Angeles', '2027-01-01T01:00:00Z', '2026-12-31 (Thursday)', '2027-01-04', '2027-01-10'],
        ]) {
            process.env.TZ = zone;
            const context = calendarContext(new Date(instant!));
            assert.ok(context.includes(`Today: ${today}.`), context);
            assert.ok(context.includes(`Next week: ${nextStart} (Monday) through ${nextEnd} (Sunday).`), context);
            assert.ok(context.includes(`(${zone})`), context);
        }
    } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
    }
});

test('invalid timestamp fails explicitly instead of fabricating calendar context', () => {
    assert.throws(() => calendarContext(new Date(NaN)), RangeError);
});
