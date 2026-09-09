const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Use the timestamp owner's local civil date; UTC arithmetic avoids DST-hour drift. */
export function calendarContext(now: Date): string {
    if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid calendar date');
    const today = new Date(0);
    today.setUTCFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    const day = today.getUTCDay();
    const mondayOffset = -((day + 6) % 7);
    const dateAt = (offset: number): string => {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() + offset);
        return date.toISOString().slice(0, 10);
    };
    return [
        `[Calendar context — host local time (${Intl.DateTimeFormat().resolvedOptions().timeZone})]`,
        `Today: ${dateAt(0)} (${WEEKDAYS[day]}). Weeks run Monday through Sunday.`,
        `This week: ${dateAt(mondayOffset)} through ${dateAt(mondayOffset + 6)}.`,
        `Next week: ${dateAt(mondayOffset + 7)} (Monday) through ${dateAt(mondayOffset + 13)} (Sunday).`,
        `Next Monday: ${dateAt(mondayOffset + 7)}. Use an explicitly requested timezone or week convention instead when supplied.`,
    ].join('\n');
}
