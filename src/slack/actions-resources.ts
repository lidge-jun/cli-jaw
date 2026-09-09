import type { ActionContext, ActionDefinition, ActionResult } from './action-types.js';
import { canvasActions } from './actions-canvas.js';
import { listActions } from './actions-lists.js';

export const resourceActions: ActionDefinition[] = [...canvasActions, ...listActions];
export function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function responseId(value: unknown): string | undefined {
    return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : undefined;
}
export function ledger(ctx: ActionContext, kind: string, id: string): boolean {
    if (ctx.operator) return true;
    const r = ctx.resource(kind, id);
    return !!r && r.status === 'active' && r.workspace === ctx.workspace && r.actor === ctx.actor
        && r.channel === ctx.channel && r.botUserId === ctx.botUserId && r.credentialKey === ctx.credentialKey;
}
/** A direct requester grant is deliberately narrower than the bot's file access. */
export function directAccess(file: Record<string, unknown>, actor: string, write: boolean): boolean {
    const entries = file['dm_mpdm_users_with_file_access'];
    if (!Array.isArray(entries) || entries.length > 10000) return false;
    const matches = entries.map(record).filter(entry => entry?.['user_id'] === actor);
    return matches.length > 0 && matches.every(entry => (write ? ['write', 'owner'] : ['read', 'write', 'owner']).includes(String(entry?.['access'])));
}
export async function fileAccess(ctx: ActionContext, kind: string, id: string, write: boolean): Promise<Record<string, unknown> | undefined> {
    ctx.checkCurrent();
    if (write && !ledger(ctx, kind, id)) return undefined;
    const read = await ctx.api('files.info', { file: id });
    ctx.checkCurrent();
    const file = record(read.data?.['file']);
    if (!read.ok || !file || file['id'] !== id) return undefined;
    if (ctx.operator || directAccess(file, ctx.actor, write)) return file;
    // Positive workspace access additionally needs freshly observed full membership.
    if (file['org_or_workspace_access'] !== 'write' || file['source_team'] !== ctx.workspace
        || file['is_restricted_sharing_enabled'] !== false) return undefined;
    // Conflicting explicit requester entries must not be overridden by workspace access.
    const entries = file['dm_mpdm_users_with_file_access'];
    if (entries !== undefined && (!Array.isArray(entries) || entries.some(e => record(e)?.['user_id'] === ctx.actor))) return undefined;
    const member = await ctx.api('users.info', { user: ctx.actor }); ctx.checkCurrent();
    const user = record(member.data?.['user']);
    return member.ok && user?.['id'] === ctx.actor && user['team_id'] === ctx.workspace && user['deleted'] === false
        && user['is_bot'] === false && user['is_restricted'] === false && user['is_ultra_restricted'] === false ? file : undefined;
}
/** Keep acknowledged identities even when a later call throws or loses its grant. */
export async function preserve(ctx: ActionContext, ids: string[], run: () => Promise<ActionResult>): Promise<ActionResult> {
    try { return await run(); }
    catch { return ids.length ? ctx.result('unknown', { readback: 'not_checked' }, ids) : ctx.result('unknown', { reason: 'resource_operation_unavailable' }); }
}
export function acknowledgedFailure(ctx: ActionContext, ids: string[], code: string): ActionResult {
    return ctx.result('partial', { acknowledged: true, content: 'not_checked', requesterView: 'not_checked', reason: code }, ids);
}
