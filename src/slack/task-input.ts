import { slackToolDenied } from './tool-access.js';
import type { ActionBase } from './action-types.js';
export function strictRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw slackToolDenied('invalid_slack_task', 400);
    return value as Record<string, unknown>;
}
export function onlyFields(value: Record<string, unknown>, keys: readonly string[]): void {
    if (Object.keys(value).some(key => !keys.includes(key))) throw slackToolDenied('invalid_slack_task_fields', 400);
}
export function requiredText(value: unknown, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw slackToolDenied('invalid_slack_task_string', 400);
    return value;
}
export function optionalText(value: unknown, max: number): string | undefined { return value === undefined ? undefined : requiredText(value, max); }
export function channelId(value: unknown): string {
    const id = requiredText(value, 64);
    if (id !== id.trim() || !/^[CGD][A-Z0-9]+$/.test(id)) throw slackToolDenied('invalid_slack_channel', 400);
    return id;
}
export function messageTs(value: unknown): string {
    const ts = requiredText(value, 24);
    if (ts !== ts.trim() || !/^\d{1,13}\.\d{1,6}$/.test(ts)) throw slackToolDenied('invalid_slack_timestamp', 400);
    return ts;
}
export function opaqueId(value: unknown, max = 128): string {
    const id = requiredText(value, max);
    if (!/^[A-Za-z0-9:_-]+$/.test(id) || id !== id.trim()) throw slackToolDenied('invalid_slack_identifier', 400);
    return id;
}
export function boundedInteger(value: unknown, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw slackToolDenied('invalid_slack_task_number', 400);
    return value;
}
export function finiteNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw slackToolDenied('invalid_slack_task_number', 400);
    return Object.is(value, -0) ? 0 : value;
}
export function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) throw slackToolDenied('invalid_slack_task_enum', 400);
    return value as T;
}
export function baseAction(raw: Record<string, unknown>, extraFields: readonly string[], mutates: boolean): ActionBase {
    onlyFields(raw, ['operation', 'channel', 'invocationId', ...extraFields]);
    const invocationId = raw['invocationId'] === undefined && !mutates ? undefined : opaqueId(raw['invocationId'], 64);
    return { channel: channelId(raw['channel']), ...(invocationId ? { invocationId } : {}) };
}
