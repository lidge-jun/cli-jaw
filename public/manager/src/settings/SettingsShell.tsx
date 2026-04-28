import {
    Suspense,
    lazy,
    useCallback,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { SettingsCategoryId, SettingsPageProps, DirtyStore } from './types';
import { SettingsSidebar } from './SettingsSidebar';
import { createDirtyStore } from './dirty-store';
import { createSettingsClient } from './settings-client';

const PAGE_REGISTRY: Record<
    SettingsCategoryId,
    LazyExoticComponent<ComponentType<SettingsPageProps>> | undefined
> = {
    'identity-preview': lazy(() => import('./pages/IdentityPreview')),
    profile: undefined,
    display: undefined,
    model: undefined,
    'channels-telegram': undefined,
    'channels-discord': undefined,
    speech: undefined,
    heartbeat: undefined,
    memory: undefined,
    employees: undefined,
    network: undefined,
    permissions: undefined,
    prompts: undefined,
    mcp: undefined,
    browser: undefined,
    'dashboard-meta': undefined,
};

type Props = { port: number; instanceUrl: string };

function useDirtyStore(): DirtyStore {
    const ref = useRef<DirtyStore | null>(null);
    if (ref.current === null) ref.current = createDirtyStore();
    return ref.current;
}

function useDirtyFlag(store: DirtyStore): boolean {
    return useSyncExternalStore(
        useCallback((listener) => store.subscribe(listener), [store]),
        useCallback(() => store.isDirty(), [store]),
        useCallback(() => false, []),
    );
}

export function SettingsShell({ port, instanceUrl }: Props) {
    const [activeId, setActiveId] = useState<SettingsCategoryId>('identity-preview');
    const dirty = useDirtyStore();
    const isDirty = useDirtyFlag(dirty);
    const client = useMemo(() => createSettingsClient(port), [port]);

    const onSelect = useCallback(
        (next: SettingsCategoryId) => {
            if (next === activeId) return;
            if (dirty.isDirty() && !window.confirm('Discard unsaved changes?')) return;
            dirty.clear();
            setActiveId(next);
        },
        [activeId, dirty],
    );

    const onDiscard = useCallback(() => {
        dirty.clear();
    }, [dirty]);

    const onSave = useCallback(() => {
        // Phase 1 has no editable fields; placeholder for the action row.
        // Phase 2+ will collect dirty.saveBundle() and PUT through the client.
        dirty.clear();
    }, [dirty]);

    const Page = PAGE_REGISTRY[activeId];

    return (
        <div className="settings-shell">
            <SettingsSidebar activeId={activeId} onSelect={onSelect} />
            <section className="settings-page" aria-live="polite">
                <Suspense fallback={<div className="settings-loading">Loading…</div>}>
                    {Page ? (
                        <Page
                            port={port}
                            instanceUrl={instanceUrl}
                            client={client}
                            dirty={dirty}
                        />
                    ) : (
                        <div className="settings-placeholder">
                            This page lands in a later phase.
                        </div>
                    )}
                </Suspense>
                {isDirty && (
                    <div
                        className="settings-action-row"
                        role="group"
                        aria-label="Unsaved changes"
                    >
                        <button
                            type="button"
                            className="settings-action settings-action-discard"
                            onClick={onDiscard}
                        >
                            Discard
                        </button>
                        <button
                            type="button"
                            className="settings-action settings-action-save"
                            onClick={onSave}
                        >
                            Save
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}
