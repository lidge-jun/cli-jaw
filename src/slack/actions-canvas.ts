import { defineAction, type ActionContext, type ActionResult } from './action-types.js';
import { baseAction, enumValue, opaqueId, requiredText } from './task-input.js';
import { acknowledgedFailure, fileAccess, preserve, responseId } from './actions-resources.js';
import { redactOutboundText } from '../messaging/redact.js';
import { slackToolDenied } from './tool-access.js';

const aclMethods = ['files.info', 'users.info'];
const aclScopes = ['files:read', 'users:read'];
async function readCanvas(ctx: ActionContext, id: string, expected?: string): Promise<ActionResult> {
    const file = await fileAccess(ctx, 'canvas', id, false);
    if (!file) return ctx.fail('resource_requester_access_denied', 403, [id]);
    const url = file['url_private_download'] ?? file['url_private'];
    const metadata = { id, title: typeof file['title'] === 'string' ? redactOutboundText(file['title']).slice(0, 512) : undefined };
    if (typeof url !== 'string') return ctx.result('partial', { ...metadata, content: 'not_checked', requesterView: 'not_checked' }, [id]);
    const exported = await ctx.download(url); ctx.checkCurrent();
    if (!await fileAccess(ctx, 'canvas', id, false)) return ctx.fail('resource_requester_access_denied', 403, [id]);
    // The file endpoint supplies no documented completeness/version receipt for Canvas.
    // A bounded supported export may be displayed, but is never labelled a full snapshot.
    const mime = exported.contentType.split(';')[0]?.trim().toLowerCase();
    if (!['text/markdown', 'text/plain'].includes(mime ?? '') || Buffer.byteLength(exported.content) > 1048576) {
        return ctx.result('partial', { ...metadata, content: 'not_checked', export: 'unsupported_format', requesterView: 'not_checked' }, [id]);
    }
    return ctx.result('partial', { ...metadata, content: 'partial', exportText: redactOutboundText(exported.content).slice(0, 8000),
        exportTruncated: exported.content.length > 8000, ...(expected !== undefined ? { exportMatchesRequested: exported.content === expected } : {}), requesterView: 'not_checked' }, [id]);
}
export const canvasActions = [
    defineAction({ operation: 'canvas.create', scopes: ['canvases:write', ...aclScopes], methods: ['canvases.create', 'canvases.access.set', ...aclMethods], mutates: true,
        parse(raw) { return { ...baseAction(raw, ['title', 'markdown'], true), title: requiredText(raw['title'], 256), markdown: redactOutboundText(requiredText(raw['markdown'], 64000)) }; },
        async execute(ctx, args) {
            const ids: string[] = [];
            return preserve(ctx, ids, async () => {
                const direct = args.channel.startsWith('D');
                if (args.channel !== ctx.channel) return ctx.fail('canvas_destination_mismatch', 403);
                if (direct && (ctx.operator || !/^[UW][A-Z0-9]+$/.test(ctx.actor))) return ctx.fail('canvas_requester_identity_required', 403);
                ctx.checkCurrent();
                const created = await ctx.api('canvases.create', { title: redactOutboundText(args.title), document_content: { type: 'markdown', markdown: args.markdown }, ...(direct ? {} : { channel_id: args.channel }) });
                const id = responseId(created.data?.['canvas_id']);
                if (id) { ids.push(id); ctx.remember('canvas', id); }
                ctx.checkCurrent();
                if (!created.ok || !id) {
                    if (ids.length) return acknowledgedFailure(ctx, ids, 'create_unconfirmed');
                    if (['free_teams_cannot_create_standalone_canvases', 'free_teams_cannot_create_non_tabbed_canvases', 'invalid_arguments', 'canvas_disabled_user_team', 'missing_scope'].includes(created.error ?? '')) return ctx.fail(created.error!, created.status ?? 400);
                    return ctx.result('unknown', { creation: 'unconfirmed' });
                }
                let sharing: 'acknowledged' | 'not_requested' = 'not_requested';
                if (direct) {
                    // Slack may require prior direct sharing; failure remains partial, never a wider share fallback.
                    const shared = await ctx.api('canvases.access.set', { canvas_id: id, access_level: 'write', user_ids: [ctx.actor] });
                    ctx.checkCurrent();
                    if (!shared.ok) return acknowledgedFailure(ctx, ids, 'canvas_sharing_unconfirmed');
                    sharing = 'acknowledged';
                    if (!await fileAccess(ctx, 'canvas', id, true)) return acknowledgedFailure(ctx, ids, 'requester_write_unverified');
                }

                const read = await readCanvas(ctx, id, args.markdown);
                if (!read.ok) return acknowledgedFailure(ctx, ids, 'requester_visibility_unverified');
                return ctx.result('partial', { creation: 'acknowledged', sharing, readback: read.data, requesterView: 'not_checked' }, ids);
            });
        } }),
    defineAction({ operation: 'canvas.read', scopes: aclScopes, methods: aclMethods, mutates: false,
        parse(raw) { return { ...baseAction(raw, ['canvasId'], false), canvasId: opaqueId(raw['canvasId']) }; },
        execute(ctx, args) { return preserve(ctx, [], () => readCanvas(ctx, args.canvasId)); } }),
    defineAction({ operation: 'canvas.edit', scopes: ['canvases:write', ...aclScopes], methods: ['canvases.edit', ...aclMethods], mutates: true,
        parse(raw) {
            const base = baseAction(raw, ['canvasId', 'mode', 'markdown', 'sectionId', 'replaceAll'], true);
            const mode = enumValue(raw['mode'], ['append', 'replace'] as const);
            const sectionId = raw['sectionId'] === undefined ? undefined : opaqueId(raw['sectionId']);
            const replaceAll = raw['replaceAll'] === undefined ? false : raw['replaceAll'];
            if (typeof replaceAll !== 'boolean' || (mode === 'append' && (sectionId || replaceAll))
                || (mode === 'replace' && (!!sectionId === replaceAll))) { throw slackToolDenied('invalid_canvas_edit', 400); }
            return { ...base, canvasId: opaqueId(raw['canvasId']), mode, sectionId, replaceAll, markdown: redactOutboundText(requiredText(raw['markdown'], 64000)) };
        },
        async execute(ctx, args) {
            const ids: string[] = [];
            return preserve(ctx, ids, async () => {
                if (!await fileAccess(ctx, 'canvas', args.canvasId, true)) return ctx.fail('resource_requester_write_denied', 403);
                ctx.checkCurrent();
                ids.push(args.canvasId);
                const edited = await ctx.api('canvases.edit', { canvas_id: args.canvasId, changes: [{ operation: args.mode === 'append' ? 'insert_at_end' : 'replace',
                    document_content: { type: 'markdown', markdown: args.markdown }, ...(args.sectionId ? { section_id: args.sectionId } : {}) }] }, async () => {
                    if (!await fileAccess(ctx, 'canvas', args.canvasId, true)) throw slackToolDenied('resource_requester_write_denied', 403);
                    ctx.checkCurrent();
                });
                ctx.checkCurrent();
                if (!edited.ok) return ctx.result('unknown', { edit: 'unconfirmed' }, ids);
                const read = await readCanvas(ctx, args.canvasId, args.replaceAll ? args.markdown : undefined);
                return read.ok ? ctx.result('partial', { edit: 'acknowledged', readback: read.data, requesterView: 'not_checked' }, ids) : acknowledgedFailure(ctx, ids, 'readback_unavailable');
            });
        } }),
];
