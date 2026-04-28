// Phase 2 — Profile page: cli, workingDir, locale, showReasoning, avatars.

import { useCallback, useEffect, useState } from 'react';
import type { SettingsPageProps, DirtyEntry } from '../types';
import { TextField, SelectField, ToggleField } from '../fields';
import {
    SettingsSection,
    PageError,
    PageLoading,
    PageOffline,
    usePageSnapshot,
} from './page-shell';
import { AvatarCard } from './components/AvatarCard';
import { expandPatch } from './path-utils';

type ProfileSnapshot = {
    cli?: string;
    workingDir?: string;
    locale?: string;
    showReasoning?: boolean;
    perCli?: Record<string, unknown>;
    [key: string]: unknown;
};

const LOCALE_OPTIONS = [
    { value: 'ko', label: '한국어 (ko)' },
    { value: 'en', label: 'English (en)' },
    { value: 'ja', label: '日本語 (ja)' },
    { value: 'zh', label: '中文 (zh)' },
];

export default function Profile({ port, client, dirty, registerSave }: SettingsPageProps) {
    const { state, refresh, setData } = usePageSnapshot<ProfileSnapshot>(client, '/api/settings');

    // Local field state mirrors snapshot + pending edits so dirty entries survive
    // re-renders without re-reading from snapshot on every keystroke.
    const [draft, setDraft] = useState<ProfileSnapshot>({});

    useEffect(() => {
        if (state.kind === 'ready') setDraft(state.data);
    }, [state]);

    useEffect(() => {
        return () => {
            // Clear dirty entries owned by this page on unmount so a stale draft
            // can't leak into another category's save bundle.
            for (const key of Array.from(dirty.pending.keys())) {
                if (key === 'cli' || key === 'workingDir' || key === 'locale' || key === 'showReasoning') {
                    dirty.remove(key);
                }
            }
        };
    }, [dirty]);

    const setEntry = useCallback(
        (key: string, entry: DirtyEntry) => dirty.set(key, entry),
        [dirty],
    );

    const onSave = useCallback(async () => {
        const bundle = dirty.saveBundle();
        if (Object.keys(bundle).length === 0) return;
        const patch = expandPatch(bundle);
        const updated = await client.put<ProfileSnapshot>('/api/settings', patch);
        const fresh = (updated && typeof updated === 'object' && 'data' in updated
            ? (updated as { data: ProfileSnapshot }).data
            : updated) as ProfileSnapshot;
        dirty.clear();
        setDraft(fresh);
        setData(fresh);
        await refresh();
    }, [client, dirty, refresh, setData]);

    useEffect(() => {
        if (!registerSave) return;
        registerSave(onSave);
        return () => registerSave(null);
    }, [registerSave, onSave]);

    if (state.kind === 'loading') return <PageLoading />;
    if (state.kind === 'offline') return <PageOffline port={port} />;
    if (state.kind === 'error') return <PageError message={state.message} />;

    const original = state.data;
    const cliOptions = Object.keys(original.perCli || {}).map((cli) => ({ value: cli, label: cli }));

    return (
        <form
            className="settings-page-form"
            onSubmit={(event) => {
                event.preventDefault();
                void onSave();
            }}
        >
            <SettingsSection
                title="Profile"
                hint="Identity for this instance — applies to both UI and CLI."
            >
                <SelectField
                    id="profile-cli"
                    label="Active CLI"
                    value={draft.cli ?? original.cli ?? ''}
                    options={cliOptions.length > 0 ? cliOptions : [{ value: '', label: '(none)' }]}
                    onChange={(next) => {
                        setDraft({ ...draft, cli: next });
                        setEntry('cli', { value: next, original: original.cli ?? '', valid: true });
                    }}
                />
                <TextField
                    id="profile-workingDir"
                    label="Working directory"
                    value={draft.workingDir ?? original.workingDir ?? ''}
                    error={(draft.workingDir ?? original.workingDir ?? '').trim() ? null : 'Required'}
                    onChange={(next) => {
                        setDraft({ ...draft, workingDir: next });
                        setEntry('workingDir', {
                            value: next,
                            original: original.workingDir ?? '',
                            valid: next.trim().length > 0,
                        });
                    }}
                    placeholder="/path/to/project"
                />
                <SelectField
                    id="profile-locale"
                    label="Locale"
                    value={draft.locale ?? original.locale ?? 'ko'}
                    options={LOCALE_OPTIONS}
                    onChange={(next) => {
                        setDraft({ ...draft, locale: next });
                        setEntry('locale', { value: next, original: original.locale ?? 'ko', valid: true });
                    }}
                />
                <ToggleField
                    id="profile-showReasoning"
                    label="Show reasoning traces"
                    value={Boolean(draft.showReasoning ?? original.showReasoning)}
                    onChange={(next) => {
                        setDraft({ ...draft, showReasoning: next });
                        setEntry('showReasoning', {
                            value: next,
                            original: Boolean(original.showReasoning),
                            valid: true,
                        });
                    }}
                />
            </SettingsSection>

            <SettingsSection title="Avatars" hint="Uploads write to the instance's home folder.">
                <AvatarCard kind="agent" port={port} />
                <AvatarCard kind="user" port={port} />
            </SettingsSection>
        </form>
    );
}
