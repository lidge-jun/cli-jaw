// Phase 5 — fallback heartbeat prompt template editor.
//
// Owns the local content draft + the per-section "Save template"
// button. Mirrors HeartbeatJobsSection's pattern: dirty-store sync
// for shell awareness, page-level save handler skips this key.

import { useCallback, useEffect, useState } from 'react';
import type { DirtyStore, SettingsClient } from '../../types';
import { PageError, PageOffline } from '../page-shell';
import type { SnapshotState } from '../page-shell';

type Props = {
    port: number;
    client: SettingsClient;
    dirty: DirtyStore;
    snapshot: SnapshotState<{ content?: string }>;
};

export function HeartbeatMarkdownSection({ port, client, dirty, snapshot }: Props) {
    const [content, setContent] = useState('');
    const [original, setOriginal] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (snapshot.kind !== 'ready') return;
        const next = snapshot.data.content ?? '';
        setContent(next);
        setOriginal(next);
    }, [snapshot]);

    useEffect(() => {
        dirty.set('heartbeat.md', { value: content, original, valid: true });
    }, [content, original, dirty]);

    useEffect(() => {
        return () => {
            dirty.remove('heartbeat.md');
        };
    }, [dirty]);

    const onSave = useCallback(async () => {
        setSaving(true);
        setError(null);
        try {
            await client.put('/api/heartbeat-md', { content });
            setOriginal(content);
            dirty.remove('heartbeat.md');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }, [client, dirty, content]);

    if (snapshot.kind === 'loading') {
        return <p className="settings-section-hint">Loading template…</p>;
    }
    if (snapshot.kind === 'offline') return <PageOffline port={port} />;
    if (snapshot.kind === 'error') return <PageError message={snapshot.message} />;

    const dirtyFlag = dirty.pending.has('heartbeat.md');

    return (
        <>
            <label className="settings-field settings-field-textarea" htmlFor="hb-md">
                <span className="settings-field-label">Template</span>
                <textarea
                    id="hb-md"
                    rows={10}
                    spellCheck={false}
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    style={{ fontFamily: 'ui-monospace, monospace' }}
                />
            </label>
            <div className="settings-heartbeat-md-footer">
                <button
                    type="button"
                    className="settings-action settings-action-save"
                    onClick={() => void onSave()}
                    disabled={saving || !dirtyFlag}
                >
                    {saving ? 'Saving…' : 'Save template'}
                </button>
            </div>
            {error ? (
                <p className="settings-field-error" role="alert">
                    {error}
                </p>
            ) : null}
        </>
    );
}
