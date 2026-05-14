import { useCallback, useEffect, useRef, useState } from 'react';

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

const API = '/api/dashboard/memory';

type Step = 'provider' | 'apikey' | 'test' | 'indexing' | 'active';
const STEPS: Step[] = ['provider', 'apikey', 'test', 'indexing', 'active'];
const STEP_LABELS: Record<Step, string> = {
    provider: 'Provider',
    apikey: 'API Key',
    test: 'Test connection',
    indexing: 'Indexing',
    active: 'Active',
};

const PROVIDERS = [
    { value: '', label: '(select)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'voyage', label: 'Voyage AI' },
    { value: 'vertex', label: 'Vertex AI' },
    { value: 'local', label: 'Local (Ollama)' },
];

const SEARCH_MODES = [
    { value: 'hybrid', label: 'Hybrid (FTS5 + Embedding)' },
    { value: 'embedding', label: 'Embedding only' },
    { value: 'fts5', label: 'FTS5 only (no vectors)' },
];

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
}

function resolveStep(config: EmbedConfig | null, state: EmbedState | null, testOk: boolean | null): Step {
    if (!config?.provider) return 'provider';
    if (config.provider !== 'local' && !config.apiKey) return 'apikey';
    if (state?.state === 'ACTIVE_HYBRID' || state?.state === 'ACTIVE_EMBEDDING') return 'active';
    if (state?.state === 'INDEXING') return 'indexing';
    if (!testOk) return 'test';
    if (!state?.active && (state?.indexedChunks ?? 0) < (state?.totalChunks ?? 1)) return 'indexing';
    return 'active';
}

function StepIndicator({ current }: { current: Step }) {
    const currentIdx = STEPS.indexOf(current);
    return (
        <div className="embed-stepper" role="list">
            {STEPS.map((s, i) => {
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

export function DashboardEmbeddingSection() {
    const [config, setConfig] = useState<EmbedConfig | null>(null);
    const [state, setState] = useState<EmbedState | null>(null);
    const [estimate, setEstimate] = useState<Estimate | null>(null);
    const [loading, setLoading] = useState(true);

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

    const refresh = useCallback(async () => {
        try {
            const [cfgRes, stRes, estRes] = await Promise.all([
                apiFetch<{ ok: boolean; config: EmbedConfig | null }>('/embed-config'),
                apiFetch<{ ok: boolean; status: EmbedState }>('/embed-state'),
                apiFetch<{ ok: boolean } & Estimate>('/embed-estimate'),
            ]);
            setConfig(cfgRes.config);
            setState(stRes.status);
            const { ok: _, ...rest } = estRes;
            setEstimate(rest);
        } catch {
            setError('Failed to load embedding state');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    useEffect(() => {
        if (!config) return;
        setProvider(config.provider || '');
        setApiKey(config.apiKey || '');
        setSearchMode(config.searchMode || 'hybrid');
        setBaseUrl(config.baseUrl || '');
    }, [config]);

    const currentStep = resolveStep(config, state, testOk);

    const saveConfig = useCallback(async (patch: Partial<EmbedConfig>) => {
        setSaving(true);
        setError(null);
        try {
            await apiFetch('/embed-config', { method: 'POST', body: JSON.stringify(patch) });
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }, [refresh]);

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
            const res = await apiFetch<{ ok: boolean; testResult?: string; testError?: string }>(
                '/embed-config',
                { method: 'POST', body: JSON.stringify({ provider, apiKey, test: true }) },
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
    }, [provider, apiKey]);

    const onStartIndexing = useCallback(async () => {
        setIndexing(true);
        setIndexProgress({ done: 0, total: 0 });
        setError(null);
        const ac = new AbortController();
        abortRef.current = ac;
        try {
            const resp = await fetch(`${API}/reindex-stream`, { signal: ac.signal, credentials: 'same-origin' });
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
                            await refresh();
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
            await refresh();
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setError(err instanceof Error ? err.message : String(err));
            }
            setIndexing(false);
        }
    }, [refresh]);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    if (loading) return <p className="dashboard-settings-row-description">Loading...</p>;

    const needsReindex = state?.state === 'NEEDS_REINDEX';
    const isActive = state?.state === 'ACTIVE_HYBRID' || state?.state === 'ACTIVE_EMBEDDING';

    return (
        <div className="dashboard-embed-section">
            <StepIndicator current={currentStep} />

            <fieldset className="dashboard-embed-fieldset">
                <legend>Provider</legend>
                <div className="dashboard-embed-field">
                    <label htmlFor="embed-provider">Provider</label>
                    <select id="embed-provider" value={provider} onChange={e => { setProvider(e.target.value); setTestOk(null); }}>
                        {PROVIDERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <div className="dashboard-embed-field">
                    <label htmlFor="embed-search-mode">Search mode</label>
                    <select id="embed-search-mode" value={searchMode} onChange={e => setSearchMode(e.target.value)}>
                        {SEARCH_MODES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                {(provider === 'local' || provider === 'vertex') && (
                    <div className="dashboard-embed-field">
                        <label htmlFor="embed-base-url">{provider === 'vertex' ? 'Project ID / Region' : 'Base URL'}</label>
                        <input id="embed-base-url" type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={provider === 'local' ? 'http://localhost:11434' : 'project-id/us-central1'} />
                    </div>
                )}
                <button type="button" className="dashboard-embed-btn" disabled={!provider || saving} onClick={onProviderSave}>
                    {saving ? 'Saving...' : 'Save provider'}
                </button>
            </fieldset>

            <fieldset className="dashboard-embed-fieldset">
                <legend>API Key</legend>
                {provider === 'local' ? (
                    <p className="dashboard-settings-row-description">Local provider uses Ollama — no API key needed.</p>
                ) : (
                    <>
                        <div className="dashboard-embed-field">
                            <label htmlFor="embed-api-key">API Key</label>
                            <input id="embed-api-key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." disabled={!provider} />
                        </div>
                        <button type="button" className="dashboard-embed-btn" disabled={!apiKey || saving} onClick={onKeySave}>Save key</button>
                    </>
                )}
            </fieldset>

            <fieldset className="dashboard-embed-fieldset">
                <legend>Connection test</legend>
                <button type="button" className="dashboard-embed-btn" disabled={!provider || (!apiKey && provider !== 'local')} onClick={() => void onTestConnection()}>
                    Test connection
                </button>
                {testMsg && (
                    <p className={testOk ? 'dashboard-embed-ok' : 'dashboard-embed-err'} role="status">
                        {testOk ? '✓ ' : '✗ '}{testMsg}
                    </p>
                )}
            </fieldset>

            <fieldset className="dashboard-embed-fieldset">
                <legend>
                    Indexing
                    {estimate && <small> — {estimate.totalChunks} chunks · ~{estimate.batches} batches · ~{Math.ceil(estimate.estimatedSeconds)}s · ${estimate.estimatedCost.toFixed(4)}</small>}
                </legend>
                {indexing ? (
                    <div className="embed-progress">
                        <div className="embed-progress-bar">
                            <div className="embed-progress-fill" style={{ width: indexProgress.total > 0 ? `${Math.round((indexProgress.done / indexProgress.total) * 100)}%` : '0%' }} />
                        </div>
                        <span className="dashboard-settings-row-description">{indexProgress.done}/{indexProgress.total} batches</span>
                    </div>
                ) : (
                    <button type="button" className="dashboard-embed-btn" disabled={!testOk && !isActive && !needsReindex} onClick={() => void onStartIndexing()}>
                        {needsReindex ? 'Re-index (provider changed)' : isActive ? 'Re-index' : 'Start indexing'}
                    </button>
                )}
            </fieldset>

            <fieldset className="dashboard-embed-fieldset">
                <legend>Status</legend>
                {state ? (
                    <dl className="embed-status-grid">
                        <dt>State</dt><dd><code>{state.state}</code></dd>
                        <dt>Mode</dt><dd>{state.mode}</dd>
                        <dt>Provider</dt><dd>{state.provider || '-'} / {state.model || '-'}</dd>
                        <dt>Indexed</dt><dd>{state.indexedChunks} chunks</dd>
                        <dt>DB size</dt><dd>{state.dbSizeBytes > 0 ? `${(state.dbSizeBytes / 1024 / 1024).toFixed(1)} MB` : '-'}</dd>
                        <dt>Last sync</dt><dd>{state.lastSyncAt || 'never'}</dd>
                        <dt>Fallback</dt><dd>{state.fallback ? `Yes (${state.reason})` : 'No'}</dd>
                    </dl>
                ) : (
                    <p className="dashboard-settings-row-description">No state available</p>
                )}
            </fieldset>

            {error && <p className="dashboard-embed-err" role="alert">{error}</p>}
        </div>
    );
}
