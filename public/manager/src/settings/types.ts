import type { ComponentType, LazyExoticComponent } from 'react';

export type SettingsCategoryId =
    | 'identity-preview'
    | 'profile'
    | 'display'
    | 'model'
    | 'channels-telegram'
    | 'channels-discord'
    | 'speech'
    | 'heartbeat'
    | 'memory'
    | 'employees'
    | 'network'
    | 'permissions'
    | 'prompts'
    | 'mcp'
    | 'browser'
    | 'dashboard-meta';

export type SettingsCategoryGroup =
    | 'core'
    | 'channels'
    | 'automation'
    | 'integrations'
    | 'meta';

export type SettingsCategory = {
    id: SettingsCategoryId;
    label: string;
    group: SettingsCategoryGroup;
    page: LazyExoticComponent<ComponentType<SettingsPageProps>>;
};

export type SettingsPageProps = {
    port: number;
    instanceUrl: string;
    client: SettingsClient;
    dirty: DirtyStore;
};

export type SettingsClient = {
    get<T>(path: string, init?: RequestInit): Promise<T>;
    put<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
    post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
};

export type DirtyEntry = {
    value: unknown;
    original: unknown;
    valid: boolean;
};

export type DirtyStore = {
    pending: Map<string, DirtyEntry>;
    isDirty(): boolean;
    set(key: string, entry: DirtyEntry): void;
    remove(key: string): void;
    clear(): void;
    saveBundle(): Record<string, unknown>;
    subscribe(listener: () => void): () => void;
};
