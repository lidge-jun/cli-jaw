import { defineAction, type ActionDefinition } from './action-types.js';
import { baseAction, messageTs, opaqueId, requiredText, optionalText } from './task-input.js';
import { redactChannelSecrets } from '../messaging/redact.js';
import { slackToolDenied } from './tool-access.js';
function safeLink(value: unknown): string {
    const link = requiredText(value, 2048); let url: URL;
    try { url = new URL(link); } catch { throw slackToolDenied('slack_link_invalid', 400); }
    if (url.protocol !== 'https:' || url.username || url.password || redactChannelSecrets(link) !== link) throw slackToolDenied('slack_link_unsafe', 400);
    return link;
}
type PinItem = { type?: string; channel?: string; message?: { ts?: string; text?: string; contentExcluded?: boolean } };
export const channelActions: ActionDefinition[] = [];
for (const operation of ['pin.add', 'pin.remove', 'pin.list'] as const) {
    const mutates = operation !== 'pin.list';
    channelActions.push(defineAction({ operation, scopes: mutates ? ['pins:write', 'pins:read'] : ['pins:read'],
        methods: mutates ? [operation === 'pin.add' ? 'pins.add' : 'pins.remove', 'pins.list'] : ['pins.list'], mutates,
        parse(raw) { return { ...baseAction(raw, mutates ? ['ts'] : [], mutates), ...(mutates ? { ts: messageTs(raw['ts']) } : {}) }; },
        async execute(ctx, args) {
            if (mutates) {
                const changed = await ctx.api(operation === 'pin.add' ? 'pins.add' : 'pins.remove', { channel: args.channel, timestamp: args.ts });
                const converged = operation === 'pin.add' ? changed.error === 'already_pinned' : changed.error === 'not_pinned';
                if (!changed.ok && !converged) return ctx.fail(changed.error ?? 'slack_pin_failed', changed.status);
            }
            const read = await ctx.api<{ items?: PinItem[] }>('pins.list', { channel: args.channel });
            if (!read.ok || !Array.isArray(read.data?.items) || read.data.items.length > 1000) return ctx.fail('slack_pins_readback_failed', 502, mutates ? [args.ts!] : []);
            if (read.data.items.some(item => item.channel && item.channel !== args.channel)) return ctx.fail('slack_pins_target_mismatch', 502, mutates ? [args.ts!] : []);
            const items = read.data.items.filter(item => item.type === 'message' && typeof item.message?.ts === 'string').map(item => ({ ts: item.message!.ts!, text: item.message?.text ?? '', contentExcluded: item.message?.contentExcluded === true }));
            if (mutates && items.some(item => item.ts === args.ts) !== (operation === 'pin.add')) return ctx.fail('slack_pin_state_mismatch', 409, [args.ts!]);
            return ctx.result(read.data.items.length !== items.length ? 'partial' : 'verified', { items, scope: 'conversation' }, mutates ? [args.ts!] : []);
        },
    }));
}
type Bookmark = { id?: string; channel_id?: string; title?: string; link?: string; emoji?: string; type?: string };
for (const operation of ['bookmark.add', 'bookmark.edit', 'bookmark.remove', 'bookmark.list'] as const) {
    const mutates = operation !== 'bookmark.list';
    channelActions.push(defineAction({ operation, scopes: mutates ? ['bookmarks:write', 'bookmarks:read'] : ['bookmarks:read'],
        methods: mutates ? [operation.replace('bookmark.', 'bookmarks.'), 'bookmarks.list'] : ['bookmarks.list'], mutates,
        parse(raw) {
            const allowed = operation === 'bookmark.add' ? ['title', 'link', 'emoji'] : operation === 'bookmark.edit' ? ['bookmarkId', 'title', 'link', 'emoji'] : operation === 'bookmark.remove' ? ['bookmarkId'] : [];
            const base = baseAction(raw, allowed, mutates);
            const title = operation === 'bookmark.add' ? requiredText(raw['title'], 100) : optionalText(raw['title'], 100);
            const link = raw['link'] !== undefined || operation === 'bookmark.add' ? safeLink(raw['link']) : undefined;
            const emoji = optionalText(raw['emoji'], 100);
            if (operation === 'bookmark.edit' && title === undefined && link === undefined && emoji === undefined) throw slackToolDenied('slack_bookmark_edit_empty', 400);
            return { ...base, ...(title !== undefined ? { title: redactChannelSecrets(title) } : {}), ...(link ? { link } : {}), ...(emoji ? { emoji } : {}),
                ...(['bookmark.edit', 'bookmark.remove'].includes(operation) ? { bookmarkId: opaqueId(raw['bookmarkId']) } : {}) };
        },
        async execute(ctx, args) {
            let id = args.bookmarkId;
            if (mutates) {
                const changed = await ctx.api<{ bookmark?: Bookmark }>(operation.replace('bookmark.', 'bookmarks.'), { channel_id: args.channel,
                    ...(id ? { bookmark_id: id } : {}), ...(operation === 'bookmark.add' ? { type: 'link' } : {}),
                    ...(args.title !== undefined ? { title: args.title } : {}), ...(args.link ? { link: args.link } : {}), ...(args.emoji ? { emoji: args.emoji } : {}) });
                if (!changed.ok) return ctx.fail(changed.error ?? 'slack_bookmark_failed', changed.status, id ? [id] : []);
                if (operation === 'bookmark.add') {
                    id = changed.data?.bookmark?.id;
                    if (!id || changed.data?.bookmark?.channel_id !== args.channel) return ctx.fail('slack_bookmark_id_unverified');
                    ctx.remember('bookmark', id);
                }
            }
            const read = await ctx.api<{ bookmarks?: Bookmark[] }>('bookmarks.list', { channel_id: args.channel });
            if (!read.ok || !Array.isArray(read.data?.bookmarks) || read.data.bookmarks.length > 100) return ctx.fail('slack_bookmark_readback_failed', 502, id ? [id] : []);
            if (read.data.bookmarks.some(bookmark => bookmark.channel_id !== args.channel || typeof bookmark.id !== 'string')
                || new Set(read.data.bookmarks.map(bookmark => bookmark.id)).size !== read.data.bookmarks.length) return ctx.fail('slack_bookmark_response_invalid', 502, id ? [id] : []);
            const bookmark = read.data.bookmarks.find(item => item.id === id);
            if (operation === 'bookmark.remove' && bookmark) return ctx.fail('slack_bookmark_still_present', 409, [id!]);
            if ((operation === 'bookmark.add' || operation === 'bookmark.edit') && (!bookmark || bookmark.type !== 'link' || (args.title !== undefined && bookmark.title !== args.title) || (args.link !== undefined && bookmark.link !== args.link) || (args.emoji !== undefined && bookmark.emoji !== args.emoji))) return ctx.fail('slack_bookmark_content_mismatch', 409, id ? [id] : []);
            return ctx.result('verified', { bookmarks: read.data.bookmarks.map(item => ({ id: item.id, title: item.title, link: item.link, type: item.type })) }, id ? [id] : []);
        },
    }));
}
