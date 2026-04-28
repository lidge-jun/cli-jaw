// Phase 8 — MCP page: structured editor for server cards plus an Advanced
// JSON view, plus action buttons for sync/install/reset against the
// unified MCP config (`/api/mcp`).
//
// The page owns one synthetic dirty-store key (`mcp.config`) carrying the
// full normalized config. Save PUTs back with `toPersistShape` to keep the
// on-disk JSON minimal. Render-time validation (duplicate names, missing
// commands, malformed env) gates the dirty entry's `valid` flag — invalid
// configs cannot save.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SettingsPageProps } from '../types';
import { JsonEditorField } from '../fields';
import {
    PageError,
    PageLoading,
    PageOffline,
    SettingsSection,
    usePageSnapshot,
} from './page-shell';
import { InlineWarn } from './components/InlineWarn';
import { McpServerCard } from './components/McpServerCard';
import {
    findDuplicateNames,
    makeEmptyServer,
    newServerName,
    normalizeMcpConfig,
    toPersistShape,
    validateServer,
    type McpConfig,
    type McpServer,
} from './mcp-helpers';

const DIRTY_KEY = 'mcp.config';

type ActionResult =
    | { kind: 'idle' }
    | { kind: 'pending'; label: string }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string };

type SyncResultsPayload = {
    ok?: boolean;
    results?: unknown;
    synced?: unknown;
    servers?: unknown;
};

export default function Mcp({ port, client, dirty, registerSave }: SettingsPageProps) {
    const { state, refresh, setData } = usePageSnapshot<unknown>(client, '/api/mcp');
    const [draft, setDraft] = useState<McpConfig>({ servers: {} });
    const [order, setOrder] = useState<string[]>([]);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [advancedValid, setAdvancedValid] = useState(true);
    const [actionState, setActionState] = useState<ActionResult>({ kind: 'idle' });
    const actionRunIdRef = useRef(0);

    const original = useMemo<McpConfig>(
        () => (state.kind === 'ready' ? normalizeMcpConfig(state.data) : { servers: {} }),
        [state],
    );

    useEffect(() => {
        if (state.kind === 'ready') {
            const normalized = normalizeMcpConfig(state.data);
            setDraft(normalized);
            setOrder(Object.keys(normalized.servers));
        }
    }, [state]);

    useEffect(() => {
        return () => {
            dirty.remove(DIRTY_KEY);
        };
    }, [dirty]);

    const names = useMemo(() => Object.keys(draft.servers), [draft]);
    const duplicates = useMemo(() => findDuplicateNames(names), [names]);
    const validations = useMemo(() => {
        return names.map((name) => ({
            name,
            result: validateServer(name, draft.servers[name] ?? makeEmptyServer()),
        }));
    }, [draft, names]);
    const hasFieldErrors = validations.some((v) => v.result.kind === 'invalid');
    const hasDupes = duplicates.size > 0;
    const isValid = !hasFieldErrors && !hasDupes && advancedValid;

    const writeDirty = useCallback(
        (next: McpConfig, valid: boolean) => {
            dirty.set(DIRTY_KEY, {
                value: toPersistShape(next),
                original: toPersistShape(original),
                valid,
            });
        },
        [dirty, original],
    );

    const updateDraft = useCallback(
        (next: McpConfig, nextOrder?: string[]) => {
            setDraft(next);
            if (nextOrder) setOrder(nextOrder);
            // Recompute validity on the next draft, not the stale `isValid`.
            const ns = nextOrder ?? Object.keys(next.servers);
            const dupes = findDuplicateNames(ns);
            const fieldOk = ns.every(
                (n) => validateServer(n, next.servers[n] ?? makeEmptyServer()).kind === 'ok',
            );
            writeDirty(next, fieldOk && dupes.size === 0 && advancedValid);
        },
        [advancedValid, writeDirty],
    );

    const onRenameServer = useCallback(
        (oldName: string, nextName: string) => {
            if (oldName === nextName) return;
            // Preserve insertion order; keep the same card in place even if the
            // new name collides with a later card (validation surfaces the dupe).
            const nextOrder = order.map((n) => (n === oldName ? nextName : n));
            const nextServers: Record<string, McpServer> = {};
            for (const n of nextOrder) {
                if (n === nextName) {
                    nextServers[n] = draft.servers[oldName] ?? makeEmptyServer();
                } else {
                    nextServers[n] = draft.servers[n] ?? makeEmptyServer();
                }
            }
            updateDraft({ ...draft, servers: nextServers }, nextOrder);
        },
        [draft, order, updateDraft],
    );

    const onChangeServer = useCallback(
        (name: string, next: McpServer) => {
            updateDraft(
                { ...draft, servers: { ...draft.servers, [name]: next } },
                order,
            );
        },
        [draft, order, updateDraft],
    );

    const onRemoveServer = useCallback(
        (name: string) => {
            const nextServers = { ...draft.servers };
            delete nextServers[name];
            const nextOrder = order.filter((n) => n !== name);
            updateDraft({ ...draft, servers: nextServers }, nextOrder);
        },
        [draft, order, updateDraft],
    );

    const onAddServer = useCallback(() => {
        const name = newServerName(order);
        updateDraft(
            { ...draft, servers: { ...draft.servers, [name]: makeEmptyServer() } },
            [...order, name],
        );
    }, [draft, order, updateDraft]);

    const onAdvancedChange = useCallback(
        (next: unknown, valid: boolean) => {
            setAdvancedValid(valid);
            if (!valid) {
                writeDirty(draft, false);
                return;
            }
            if (next && typeof next === 'object' && !Array.isArray(next)) {
                const normalized = normalizeMcpConfig(next);
                setDraft(normalized);
                setOrder(Object.keys(normalized.servers));
                const dupes = findDuplicateNames(Object.keys(normalized.servers));
                const fieldOk = Object.entries(normalized.servers).every(
                    ([n, srv]) => validateServer(n, srv).kind === 'ok',
                );
                writeDirty(normalized, fieldOk && dupes.size === 0);
            }
        },
        [draft, writeDirty],
    );

    const onSave = useCallback(async () => {
        const bundle = dirty.saveBundle();
        if (!(DIRTY_KEY in bundle)) return;
        const body = bundle[DIRTY_KEY];
        const updated = await client.put<unknown>('/api/mcp', body);
        // /api/mcp PUT returns `{ ok, servers: string[] }` — re-fetch to get the
        // canonical persisted shape rather than reusing the (possibly trimmed)
        // request body.
        dirty.clear();
        const fresh = await client.get<unknown>('/api/mcp').catch(() => updated);
        const normalized = normalizeMcpConfig(fresh);
        setDraft(normalized);
        setOrder(Object.keys(normalized.servers));
        setData(fresh);
        await refresh();
    }, [client, dirty, refresh, setData]);

    useEffect(() => {
        if (!registerSave) return;
        registerSave(onSave);
        return () => registerSave(null);
    }, [registerSave, onSave]);

    const runAction = useCallback(
        async (label: string, path: string) => {
            if (dirty.isDirty()) {
                if (
                    typeof window !== 'undefined' &&
                    !window.confirm(
                        `You have unsaved MCP edits. ${label} will use the on-disk config, not your unsaved changes. Continue?`,
                    )
                ) {
                    return;
                }
            }
            const runId = actionRunIdRef.current + 1;
            actionRunIdRef.current = runId;
            setActionState({ kind: 'pending', label });
            try {
                const result = await client.post<SyncResultsPayload>(path, {});
                if (actionRunIdRef.current !== runId) return;
                setActionState({
                    kind: 'success',
                    message: `${label} succeeded${result?.servers ? `: ${JSON.stringify(result.servers)}` : ''}`,
                });
            } catch (err: unknown) {
                if (actionRunIdRef.current !== runId) return;
                setActionState({
                    kind: 'error',
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        },
        [client, dirty],
    );

    if (state.kind === 'loading') return <PageLoading />;
    if (state.kind === 'offline') return <PageOffline port={port} />;
    if (state.kind === 'error') return <PageError message={state.message} />;

    const dupeNames = Array.from(duplicates).sort();

    return (
        <form className="settings-page-form" onSubmit={(event) => event.preventDefault()}>
            <SettingsSection
                title="MCP servers"
                hint="Edit each server's command/args/env. Save writes back to mcp.json; Sync pushes the saved config to all CLIs."
            >
                <div className="mcp-servers-list">
                    {order.length === 0 && (
                        <p className="settings-section-hint">
                            No servers configured. Add one or run <code>Reset to defaults</code>.
                        </p>
                    )}
                    {order.map((name) => {
                        const srv = draft.servers[name] ?? makeEmptyServer();
                        const lower = name.toLowerCase();
                        const isDupe = duplicates.has(lower);
                        const validation = validateServer(name, srv);
                        const error = isDupe
                            ? 'Duplicate server name (case-insensitive).'
                            : validation.kind === 'invalid'
                                ? validation.reason
                                : null;
                        return (
                            <McpServerCard
                                key={name}
                                name={name}
                                server={srv}
                                onRename={(next) => onRenameServer(name, next)}
                                onChange={(next) => onChangeServer(name, next)}
                                onRemove={() => onRemoveServer(name)}
                                nameError={error}
                            />
                        );
                    })}
                </div>
                <div className="mcp-servers-actions">
                    <button
                        type="button"
                        className="settings-action"
                        onClick={onAddServer}
                    >
                        Add server
                    </button>
                </div>
                {hasDupes && (
                    <InlineWarn role="alert">
                        Duplicate server name{dupeNames.length === 1 ? '' : 's'}: {dupeNames.join(', ')}.
                        Saving is blocked until names are unique.
                    </InlineWarn>
                )}
                {hasFieldErrors && !hasDupes && (
                    <InlineWarn role="alert">
                        Some servers have errors (missing command or invalid name).
                        Saving is blocked until they are fixed.
                    </InlineWarn>
                )}
            </SettingsSection>

            <SettingsSection
                title="Actions"
                hint="These act on the saved config. Save edits first if you want them included."
            >
                <div className="mcp-action-buttons">
                    <button
                        type="button"
                        className="settings-action"
                        disabled={actionState.kind === 'pending'}
                        onClick={() => void runAction('Sync to all CLIs', '/api/mcp/sync')}
                    >
                        Sync to all CLIs
                    </button>
                    <button
                        type="button"
                        className="settings-action"
                        disabled={actionState.kind === 'pending'}
                        onClick={() => void runAction('Install bundle', '/api/mcp/install')}
                    >
                        Install bundle
                    </button>
                    <button
                        type="button"
                        className="settings-action settings-action-discard"
                        disabled={actionState.kind === 'pending'}
                        onClick={() => {
                            if (
                                typeof window !== 'undefined' &&
                                !window.confirm(
                                    'Reset MCP config to defaults? Your custom servers will be removed.',
                                )
                            ) {
                                return;
                            }
                            void runAction('Reset to defaults', '/api/mcp/reset');
                        }}
                    >
                        Reset to defaults
                    </button>
                </div>
                {actionState.kind === 'pending' && (
                    <p className="settings-section-hint" role="status">
                        {actionState.label}…
                    </p>
                )}
                {actionState.kind === 'success' && (
                    <p className="settings-section-hint" role="status">
                        ✅ {actionState.message}
                    </p>
                )}
                {actionState.kind === 'error' && (
                    <InlineWarn role="alert">{actionState.message}</InlineWarn>
                )}
            </SettingsSection>

            <SettingsSection
                title="Advanced (raw JSON)"
                hint="Edit the entire config object. Useful for fields not surfaced in the structured editor."
            >
                <button
                    type="button"
                    className="settings-action"
                    onClick={() => setShowAdvanced((v) => !v)}
                    aria-expanded={showAdvanced}
                >
                    {showAdvanced ? 'Hide raw JSON' : 'Show raw JSON'}
                </button>
                {showAdvanced && (
                    <JsonEditorField
                        id="mcp-raw"
                        label="mcp.json"
                        value={toPersistShape(draft)}
                        rows={16}
                        onChange={onAdvancedChange}
                    />
                )}
                {!isValid && (
                    <p className="settings-section-hint">
                        Save is disabled while validation errors are present.
                    </p>
                )}
            </SettingsSection>
        </form>
    );
}
