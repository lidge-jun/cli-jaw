import { isDeepStrictEqual } from 'node:util';
import { defineAction, type ActionContext } from './action-types.js';
import { baseAction, boundedInteger, enumValue, finiteNumber, opaqueId, onlyFields, optionalText, requiredText, strictRecord } from './task-input.js';
import { acknowledgedFailure, fileAccess, preserve, record, responseId } from './actions-resources.js';
import { redactOutboundText } from '../messaging/redact.js';
import { slackToolDenied } from './tool-access.js';

function invalid(): never { throw slackToolDenied('invalid_list_action', 400); }

const aclMethods = ['files.info', 'users.info'];
const aclScopes = ['files:read', 'users:read'];
type Field = { columnId: string; type: 'text' | 'number' | 'checkbox' | 'date' | 'user'; value: string | number | boolean | string[] };
function parseFields(value: unknown): Field[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20) return invalid();
    const ids = new Set<string>();
    return value.map(item => {
        const raw = strictRecord(item); onlyFields(raw, ['columnId', 'type', 'value']);
        const columnId = opaqueId(raw['columnId']); const type = enumValue(raw['type'], ['text', 'number', 'checkbox', 'date', 'user'] as const);
        if (ids.has(columnId)) invalid(); ids.add(columnId);
        let result: Field['value'];
        if (type === 'number') result = finiteNumber(raw['value']);
        else if (type === 'checkbox') { if (typeof raw['value'] !== 'boolean') invalid(); result = raw['value'] as boolean; }
        else if (type === 'user') {
            if (!Array.isArray(raw['value']) || raw['value'].length > 20 || raw['value'].length < 1) invalid();
            result = (raw['value'] as unknown[]).map(v => { const id = opaqueId(v); if (!/^[UW][A-Z0-9]+$/.test(id)) invalid(); return id; });
            if (new Set(result).size !== result.length) invalid();
        } else {
            result = requiredText(raw['value'], type === 'date' ? 10 : 2000);
            if (type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result)) invalid();
            if (type === 'text') result = redactOutboundText(result);
        }
        return { columnId, type, value: result };
    });
}
function wire(field: Field): Record<string, unknown> {
    const base = { column_id: field.columnId };
    if (field.type === 'text') return { ...base, rich_text: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: field.value }] }] }] };
    if (field.type === 'checkbox') return { ...base, checkbox: field.value };
    return { ...base, [field.type]: field.type === 'user' ? field.value : [field.value] };
}
function plainRich(value: unknown): string | undefined {
    if (!Array.isArray(value) || value.length !== 1) return undefined;
    const block = record(value[0]); const sections = block?.['elements'];
    if (block?.['type'] !== 'rich_text' || !Array.isArray(sections) || sections.length !== 1) return undefined;
    const section = record(sections[0]); const elements = section?.['elements'];
    if (section?.['type'] !== 'rich_text_section' || !Array.isArray(elements) || elements.length > 2000) return undefined;
    let text = '';
    for (const node of elements) {
        const e = record(node);
        if (!e || e['type'] !== 'text' || typeof e['text'] !== 'string' || Object.keys(e).some(k => !['type', 'text', 'style'].includes(k))) return undefined;
        if (e['style'] !== undefined) { const style = record(e['style']); if (!style || Object.entries(style).some(([k, v]) => !['bold', 'italic', 'strike', 'code'].includes(k) || v !== false)) return undefined; }
        text += e['text']; if (text.length > 2000) return undefined;
    }
    return text;
}
function matches(item: unknown, listId: string, rowId: string, fields: Field[]): boolean {
    const row = record(item); const stored = row?.['fields'];
    if (row?.['id'] !== rowId || row['list_id'] !== listId || !Array.isArray(stored) || stored.length > 100) return false;
    return fields.every(field => {
        const found = stored.map(record).filter(f => f?.['column_id'] === field.columnId);
        if (found.length !== 1) return false;
        const value = found[0]!;
        if (field.type === 'text') return plainRich(value['rich_text']) === field.value;
        const expected = field.type === 'user' ? field.value : [field.value];
        return isDeepStrictEqual(value[field.type], expected);
    });
}
async function info(ctx: ActionContext, listId: string, rowId: string): Promise<Record<string, unknown> | undefined> {
    const read = await ctx.api('slackLists.items.info', { list_id: listId, id: rowId }); ctx.checkCurrent();
    const row = record(read.data?.['record']);
    return read.ok && row?.['id'] === rowId && row['list_id'] === listId ? row : undefined;
}
function schemaMatches(file: Record<string, unknown>, fields: Field[]): boolean {
    const schema = record(file['list_metadata'])?.['schema'];
    if (!Array.isArray(schema) || schema.length > 100) return false;
    return fields.every(field => {
        const columns = schema.map(record).filter(c => c?.['id'] === field.columnId);
        const allowed: Record<Field['type'], string[]> = { text: ['text'], number: ['number'], checkbox: ['checkbox', 'todo_completed', 'completed'], date: ['date', 'todo_due_date'], user: ['user', 'todo_assignee'] };
        return columns.length === 1 && allowed[field.type].includes(String(columns[0]?.['type']));
    });
}
function publicSchema(file: unknown): unknown[] {
    const schema = record(record(file)?.['list_metadata'])?.['schema'];
    if (!Array.isArray(schema) || schema.length > 100) return [];
    return schema.slice(0, 20).flatMap(value => {
        const column = record(value); const id = responseId(column?.['id']);
        if (!column || !id || typeof column['type'] !== 'string') return [];
        return [{ id, type: column['type'].slice(0, 32),
            name: typeof column['name'] === 'string' ? redactOutboundText(column['name']).slice(0, 64) : undefined,
            key: typeof column['key'] === 'string' ? redactOutboundText(column['key']).slice(0, 64) : undefined,
            primary: column['is_primary_column'] === true }];
    });
}
function readFields(value: unknown): { fields: unknown[]; unsupported: boolean } {
    if (!Array.isArray(value) || value.length > 100) return { fields: [], unsupported: true };
    const fields: unknown[] = []; let unsupported = false;
    for (const entry of value) {
        const field = record(entry); const columnId = responseId(field?.['column_id']);
        if (!field || !columnId) { unsupported = true; continue; }
        const keys = ['rich_text', 'number', 'checkbox', 'date', 'user'].filter(key => field[key] !== undefined);
        if (keys.length !== 1) { unsupported = true; continue; }
        const key = keys[0]!; const raw = field[key];
        if (key === 'rich_text') {
            const text = plainRich(raw);
            if (text === undefined) { unsupported = true; continue; }
            fields.push({ columnId, type: 'text', value: redactOutboundText(text) });
        } else if (Array.isArray(raw) && raw.length <= 20 && raw.every(v =>
            key === 'number' ? typeof v === 'number' && Number.isFinite(v) : key === 'checkbox' ? typeof v === 'boolean'
                : typeof v === 'string' && (key === 'user' ? /^[UW][A-Z0-9]+$/.test(v) : /^\d{4}-\d{2}-\d{2}$/.test(v)))) {
            fields.push({ columnId, type: key, value: raw });
        } else unsupported = true;
    }
    return { fields, unsupported };
}
export const listActions = [
    defineAction({ operation: 'list.create', scopes: ['lists:write', 'lists:read', ...aclScopes], methods: ['slackLists.create', 'slackLists.access.set', 'slackLists.items.list', ...aclMethods], mutates: true,
        parse(raw) { return { ...baseAction(raw, ['name'], true), name: redactOutboundText(requiredText(raw['name'], 256)) }; },
        execute(ctx, args) {
            const ids: string[] = [];
            return preserve(ctx, ids, async () => {
                ctx.checkCurrent();
                const created = await ctx.api('slackLists.create', { name: args.name, schema: [{ key: 'name', name: 'Name', type: 'text', is_primary_column: true }] });
                const id = responseId(created.data?.['list_id']);
                if (id) { ids.push(id); ctx.remember('list', id); } ctx.checkCurrent();
                if (!created.ok || !id) return ctx.result('unknown', { creation: 'unconfirmed' }, ids);
                let sharing: 'acknowledged' | 'not_requested' = 'not_requested';
                if (!ctx.operator) {
                    if (!/^[UW][A-Z0-9]+$/.test(ctx.actor)) return acknowledgedFailure(ctx, ids, 'requester_identity_unavailable');
                    const shared = await ctx.api('slackLists.access.set', { list_id: id, access_level: 'write', user_ids: [ctx.actor] }); ctx.checkCurrent();
                    if (!shared.ok) return acknowledgedFailure(ctx, ids, 'sharing_unconfirmed');
                    sharing = 'acknowledged';
                }
                const file = await fileAccess(ctx, 'list', id, false);
                if (!file) return acknowledgedFailure(ctx, ids, 'requester_access_unverified');
                const read = await ctx.api('slackLists.items.list', { list_id: id, include_list: true, limit: 100, archived: false }); ctx.checkCurrent();
                const list = record(read.data?.['list']);
                return ctx.result('partial', { creation: 'acknowledged', sharing, requesterView: 'not_checked',
                    metadata: read.ok && list?.['id'] === id && list['title'] === args.name ? 'verified' : 'not_checked',
                    columns: publicSchema(file), schemaCompleteness: 'partial' }, ids);
            });
        } }),
    defineAction({ operation: 'list.read', scopes: ['lists:read', ...aclScopes], methods: ['slackLists.items.list', ...aclMethods], mutates: false,
        parse(raw) { return { ...baseAction(raw, ['listId', 'cursor', 'limit'], false), listId: opaqueId(raw['listId']), cursor: optionalText(raw['cursor'], 2048), limit: raw['limit'] === undefined ? 100 : boundedInteger(raw['limit'], 1, 100) }; },
        execute(ctx, args) { return preserve(ctx, [], async () => {
            const file = await fileAccess(ctx, 'list', args.listId, false);
            if (!file) return ctx.fail('resource_requester_access_denied', 403);
            const read = await ctx.api('slackLists.items.list', { list_id: args.listId, include_list: true, limit: args.limit, archived: false, ...(args.cursor ? { cursor: args.cursor } : {}) }); ctx.checkCurrent();
            if (!read.ok || !Array.isArray(read.data?.['items']) || read.data['items'].length > args.limit) return ctx.fail('list_read_unavailable', 502);
            if (!await fileAccess(ctx, 'list', args.listId, false)) return ctx.fail('resource_requester_access_denied', 403);
            const items = read.data['items'].map(record);
            if (items.some(row => !row || row['list_id'] !== args.listId || !responseId(row['id']))) return ctx.fail('list_read_invalid', 502);
            // Project supported typed fields only; cap the complete action receipt independently.
            const cursor = record(read.data['response_metadata'])?.['next_cursor'];
            if (typeof cursor !== 'string' || cursor.length > 2048) return ctx.fail('list_cursor_unavailable', 502);
            const projected: unknown[] = []; let bytes = 0; let truncated = false; let unsupported = false;
            for (const row of items) {
                const parsed = readFields(row!['fields']); unsupported ||= parsed.unsupported;
                const item = { id: row!['id'], fields: parsed.fields, updatedTimestamp: typeof row!['updated_timestamp'] === 'string' ? row!['updated_timestamp'].slice(0, 32) : undefined };
                bytes += Buffer.byteLength(JSON.stringify(item));
                if (bytes > 8000) { truncated = true; break; }
                projected.push(item);
            }
            return ctx.result('partial', { items: projected, columns: publicSchema(file), schemaCompleteness: 'partial', nextCursor: cursor, hasMore: cursor !== '', truncated, unsupported,
                content: 'partial', requesterView: 'not_checked' }, [args.listId]);
        }); } }),
    ...(['add', 'update'] as const).map(mode => defineAction({ operation: `list.item.${mode}`, scopes: ['lists:write', 'lists:read', ...aclScopes],
        methods: [...aclMethods, 'slackLists.items.info', mode === 'add' ? 'slackLists.items.create' : 'slackLists.items.update'], mutates: true,
        parse(raw) {
            return { ...baseAction(raw, mode === 'add' ? ['listId', 'fields'] : ['listId', 'rowId', 'fields', 'updatedTimestamp'], true),
                listId: opaqueId(raw['listId']), fields: parseFields(raw['fields']), rowId: mode === 'update' ? opaqueId(raw['rowId']) : undefined,
                updatedTimestamp: mode === 'update' ? optionalText(raw['updatedTimestamp'], 32) : undefined };
        },
        execute(ctx, args) {
            const ids: string[] = [];
            return preserve(ctx, ids, async () => {
                let file = await fileAccess(ctx, 'list', args.listId, true);
                if (!file) return ctx.fail('resource_requester_write_denied', 403);
                if (!schemaMatches(file, args.fields)) return ctx.fail('list_schema_unsupported', 400);
                if (args.rowId) {
                    const before = await info(ctx, args.listId, args.rowId);
                    if (!before) return ctx.fail('list_row_unavailable', 404);
                    if (args.updatedTimestamp !== undefined && before['updated_timestamp'] !== args.updatedTimestamp) return ctx.fail('list_row_changed', 409);
                    // Recheck ACL after the precondition await, immediately before dispatch.
                    file = await fileAccess(ctx, 'list', args.listId, true);
                    if (!file || !schemaMatches(file, args.fields)) return ctx.fail('resource_requester_write_denied', 403);
                }
                ctx.checkCurrent();
                const beforeDispatch = async () => {
                    const fresh = await fileAccess(ctx, 'list', args.listId, true);
                    if (!fresh || !schemaMatches(fresh, args.fields)) throw slackToolDenied('resource_requester_write_denied', 403);
                    ctx.checkCurrent();
                };
                let rowId = args.rowId;
                if (mode === 'add') {
                    const created = await ctx.api('slackLists.items.create', { list_id: args.listId, initial_fields: args.fields.map(wire) }, beforeDispatch);
                    const item = record(created.data?.['item']); rowId = responseId(item?.['id']);
                    if (rowId) { ids.push(args.listId, rowId); if (item?.['list_id'] === args.listId) ctx.remember('list.item', rowId, { listId: args.listId }); } ctx.checkCurrent();
                    if (!created.ok || !rowId || item?.['list_id'] !== args.listId) return ctx.result('unknown', { creation: 'unconfirmed' }, ids);
                } else {
                    ids.push(args.listId, rowId!);
                    const updated = await ctx.api('slackLists.items.update', { list_id: args.listId, cells: args.fields.map(field => ({ ...wire(field), row_id: rowId })) }, beforeDispatch); ctx.checkCurrent();
                    if (!updated.ok) return ctx.result('unknown', { update: 'unconfirmed' }, ids);
                }
                const after = await info(ctx, args.listId, rowId!);
                if (!after) return acknowledgedFailure(ctx, ids, 'readback_unavailable');
                if (!await fileAccess(ctx, 'list', args.listId, true)) return acknowledgedFailure(ctx, ids, 'requester_access_changed');
                if (!matches(after, args.listId, rowId!, args.fields)) return ctx.fail('list_typed_content_mismatch', 502, ids);
                return ctx.result('verified', { mutation: 'acknowledged', typedContent: 'verified', requesterAcl: 'write', requesterView: 'not_checked',
                    updatedTimestamp: typeof after['updated_timestamp'] === 'string' ? after['updated_timestamp'] : undefined }, ids);
            });
        } })),
];
