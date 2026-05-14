import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsPageProps } from '../types';
import { SecretField, SelectField } from '../fields';
import { SettingsSection, PageError, PageLoading, PageOffline, usePageSnapshot } from './page-shell';

type EmbedConfig = {
    enabled?: boolean;
    provider?: string;
    model?: string;
    apiKey?: string;
    searchMode?: string;
    baseUrl?: string;
};

type EmbedState = {
    state: string;
    enabled: boolean;
    active: boolean;
    mode: string;
    provider: string;
    model: string;
    indexedChunks: number;
    totalChunks: number;
    fallback: boolean;
    reason: string;
    lastSyncAt: string | null;
    dbSizeBytes: number;
};

type Estimate = {
    totalChunks: number;
    estimatedTokens: number;
    estimatedCost: number;
    batches: number;
    estimatedSeconds: number;
    provider: string;
};

type ConfigResponse = { ok: boolean; config: EmbedConfig | null };
type StateResponse = { ok: boolean; status: EmbedState };
type EstimateResponse = { ok: boolean } & Estimate;

type Step = 'provider' | 'apikey' | 'test' | 'indexing' | 'active';
const STEPS: Step[] = ['provider', 'apikey', 'test', 'indexing', 'active'];
const STEP_LABELS: Record<Step, string> = {
    provider: 'Provider',
    apikey: 'API Key',
    test: 'Test connection',
    indexing: 'Indexing',
    active: 'Active',
};

const PROVIDER_OPTIONS = [
    { value: '', label: '(select)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'voyage', label: 'Voyage AI' },
    { value: 'vertex', label: 'Vertex AI' },
    { value: 'local', label: 'Local (Ollama)' },
];

const SEARCH_MODE_OPTIONS = [
    { value: 'hybrid', label: 'Hybrid (FTS5 + Embedding)' },
    { value: 'embedding', label: 'Embedding only' },
    { value: 'fts5', label: 'FTS5 only (no vectors)' },
];

function resolveStep(config: EmbedConfig | null, state: EmbedState | null, testOk: boolean | null): Step {
    if (!config?.provider) return 'provider';
    if (config.provider !== 'local' && !config.apiKey) return 'apikey';
    if (state?.state === 'ACTIVE_HYBRID' || state?.state === 'ACTIVE_EMBEDDING') return 'active';
    if (state?.state === 'INDEXING') return 'indexing';
    if (!testOk) return 'test';
    if (!state?.active && (state?.indexedChunks ?? 0) < (state?.totalChunks ?? 1)) return 'indexing';
    return 'active';
}

function StepIndicator({ steps, current }: { steps: Step[]; current: Step }) {
    const currentIdx = steps.indexOf(current);
    return (
        <div className="embed-stepper" role="list">
            {steps.map((s, i) => {
                const done = i < currentIdx;
                const active = i === currentIdx;
                const cls = done ? 'embed-step is-done' : active ? 'embed-step is-active' : 'embed-step';
                return (
                    <div key={s} className={cls} role="listitem" aria-current={active ? 'step' : undefined}>
                        <span className="embed-step-badge">{done ? '✓' : i + 1}</span>
                        <span className="embed-step-label">{STEP_LABELS[s]}</span>
                    </div>
                );
            })}
        </div>
    );
}

export default function Embedding({ port, client }: SettingsPageProps) {
    const configSnap = usePageSnapshot<ConfigResponse>(client, '/api/dashboard/memory/embed-config');
    const stateSnap = usePageSnapshot<StateResponse>(client, '/api/dashboard/memory/embed-state');
    const estimateSnap = usePageSnapshot<EstimateResponse>(client, '/api/dashboard/memory/embed-estimate');

    const [provider, setProvider] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [searchMode, setSearchMode] = useState('hybrid');
    const [baseUrl, setBaseUrl] = useState('');
    const [testOk, setTestOk] = useState<boolean | null>(null);
    const [testMsg, setTestMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [indexing, setIndexing] = useState(false);
    const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (configSnap.state.kind !== 'ready' || !configSnap.state.data.config) return;
        const c = configSnap.state.data.config;
        setProvider(c.provider || '');
        setApiKey(c.apiKey || '');
        setSearchMode(c.searchMode || 'hybrid');
        setBaseUrl(c.baseUrl || '');
    }, [configSnap.state]);

    const config = configSnap.state.kind === 'ready' ? configSnap.state.data.config : null;
    const state = stateSnap.state.kind === 'ready' ? stateSnap.state.data.status : null;
    const estimate: Estimate | null = (() => {
        if (estimateSnap.state.kind !== 'ready') return null;
        const { ok: _, ...rest } = estimateSnap.state.data;
        return rest;
    })();

    const currentStep = resolveStep(config, state, testOk);

    const saveConfig = useCallback(async (patch: Partial<EmbedConfig>) => {
        setSaving(true);
        setError(null);
        try {
            await client.post('/api/dashboard/memory/embed-config', patch);
            await configSnap.refresh();
            await stateSnap.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }, [client, configSnap, stateSnap]);

    const onProviderSave = useCallback(() => {
        if (!provider) return;
        setTestOk(null);
        setTestMsg('');
        const patch: Partial<EmbedConfig> = { provider, searchMode };
        if (baseUrl) patch.baseUrl = baseUrl;
        void saveConfig(patch);
    }, [provider, searchMode, baseUrl, saveConfig]);

    const onKeySave = useCallback(() => {
        void saveConfig({ apiKey });
    }, [apiKey, saveConfig]);

    const onTestConnection = useCallback(async () => {
        setTestOk(null);
        setTestMsg('Testing...');
        setError(null);
        try {
            const res = await client.post<{ ok: boolean; testResult?: string; testError?: string }>(
                '/api/dashboard/memory/embed-config',
                { provider, apiKey, test: true },
            );
            if (res.testResult === 'ok') {
                setTestOk(true);
                setTestMsg('Connection successful');
            } else {
                setTestOk(false);
                setTestMsg(res.testError || 'Connection failed');
            }
        } catch (err) {
            setTestOk(false);
            setTestMsg(err instanceof Error ? err.message : String(err));
        }
    }, [client, provider, apiKey]);

    const onStartIndexing = useCallback(async () => {
        setIndexing(true);
        setIndexProgress({ done: 0, total: 0 });
        setError(null);
        const ac = new AbortController();
        abortRef.current = ac;
        try {
            const resp = await fetch(`/i/${port}/api/dashboard/memory/reindex-stream`, {
                signal: ac.signal,
            });
            if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const evt = JSON.parse(line.slice(6));
                        if (evt.complete) {
                            setIndexing(false);
                            await configSnap.refresh();
                            await stateSnap.refresh();
                            return;
                        }
                        if (evt.error) {
                            setError(String(evt.error));
                            setIndexing(false);
                            return;
                        }
                        if (typeof evt.done === 'number') {
                            setIndexProgress({ done: evt.done, total: evt.total || 0 });
                        }
                    } catch { /* skip malformed */ }
                }
            }
            setIndexing(false);
            await stateSnap.refresh();
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setError(err instanceof Error ? err.message : String(err));
            }
            setIndexing(false);
        }
    }, [port, configSnap, stateSnap]);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    if (configSnap.state.kind === 'loading') return <PageLoading />;
    if (configSnap.state.kind === 'offline') return <PageOffline port={port} />;
    if (configSnap.state.kind === 'error') return <PageError message={configSnap.state.message} />;

    const needsReindex = state?.state === 'NEEDS_REINDEX';
    const isActive = state?.state === 'ACTIVE_HYBRID' || state?.state === 'ACTIVE_EMBEDDING';

    return (
        <div className="settings-page-form">
            <StepIndicator steps={STEPS} current={currentStep} />

            <SettingsSection title="Provider" hint="Choose an embedding provider and search mode.">
                <SelectField
                    id="embed-provider"
                    label="Provider"
                    value={provider}
                    options={PROVIDER_OPTIONS}
                    onChange={(v) => { setProvider(v); setTestOk(null); }}
                />
                <SelectField
                    id="embed-search-mode"
                    label="Search mode"
                    value={searchMode}
                    options={[...SEARCH_MODE_OPTIONS]}
                    onChange={setSearchMode}
                />
                {(provider === 'local' || provider === 'vertex') && (
                    <SecretField
                        id="embed-base-url"
                        label={provider === 'vertex' ? 'Project ID / Region' : 'Base URL'}
                        value={baseUrl}
                        onChange={setBaseUrl}
                        placeholder={provider === 'local' ? 'http://localhost:11434' : 'project-id/us-central1'}
                        masked={false}
                    />
                )}
                <button
                    type="button"
                    className="settings-action settings-action-save"
                    disabled={!provider || saving}
                    onClick={onProviderSave}
                >
                    {saving ? 'Saving...' : 'Save provider'}
                </button>
            </SettingsSection>

            <SettingsSection title="API Key" hint={provider === 'local' ? 'Not required for local provider.' : 'Enter your API key for the selected provider.'}>
                {provider === 'local' ? (
                    <p className="settings-section-hint">Local provider uses Ollama — no API key needed.</p>
                ) : (
                    <>
                        <SecretField
                            id="embed-api-key"
                            label="API Key"
                            value={apiKey}
                            onChange={setApiKey}
                            placeholder="sk-..."
                            disabled={!provider}
                        />
                        <button
                            type="button"
                            className="settings-action settings-action-save"
                            disabled={!apiKey || saving}
                            onClick={onKeySave}
                        >
                            Save key
                        </button>
                    </>
                )}
            </SettingsSection>

            <SettingsSection title="Connection test" hint="Verify the provider responds correctly.">
                <button
                    type="button"
                    className="settings-action settings-action-save"
                    disabled={!provider || (!apiKey && provider !== 'local')}
                    onClick={() => void onTestConnection()}
                >
                    Test connection
                </button>
                {testMsg && (
                    <p className={testOk ? 'settings-section-hint' : 'settings-field-error'} role="status">
                        {testOk ? '✓ ' : '✗ '}{testMsg}
                    </p>
                )}
            </SettingsSection>

            <SettingsSection
                title="Indexing"
                hint={estimate
                    ? `${estimate.totalChunks} chunks · ~${estimate.batches} batches · ~${Math.ceil(estimate.estimatedSeconds)}s · $${estimate.estimatedCost.toFixed(4)}`
                    : 'Start indexing to build vector embeddings.'}
            >
                {indexing ? (
                    <div className="embed-progress">
                        <div className="embed-progress-bar">
                            <div
                                className="embed-progress-fill"
                                style={{ width: indexProgress.total > 0 ? `${Math.round((indexProgress.done / indexProgress.total) * 100)}%` : '0%' }}
                            />
                        </div>
                        <span className="settings-section-hint">
                            {indexProgress.done}/{indexProgress.total} batches
                        </span>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="settings-action settings-action-save"
                        disabled={!testOk && !isActive && !needsReindex}
                        onClick={() => void onStartIndexing()}
                    >
                        {needsReindex ? 'Re-index (provider changed)' : isActive ? 'Re-index' : 'Start indexing'}
                    </button>
                )}
            </SettingsSection>

            <SettingsSection title="Status" hint="Current embedding search state.">
                {state ? (
                    <dl className="embed-status-grid">
                        <dt>State</dt>
                        <dd><code>{state.state}</code></dd>
                        <dt>Mode</dt>
                        <dd>{state.mode}</dd>
                        <dt>Provider</dt>
                        <dd>{state.provider || '-'} / {state.model || '-'}</dd>
                        <dt>Indexed</dt>
                        <dd>{state.indexedChunks} chunks</dd>
                        <dt>DB size</dt>
                        <dd>{state.dbSizeBytes > 0 ? `${(state.dbSizeBytes / 1024 / 1024).toFixed(1)} MB` : '-'}</dd>
                        <dt>Last sync</dt>
                        <dd>{state.lastSyncAt || 'never'}</dd>
                        <dt>Fallback</dt>
                        <dd>{state.fallback ? `Yes (${state.reason})` : 'No'}</dd>
                    </dl>
                ) : (
                    <p className="settings-section-hint">Loading state...</p>
                )}
            </SettingsSection>

            {error && (
                <p className="settings-field-error" role="alert">{error}</p>
            )}
        </div>
    );
}
