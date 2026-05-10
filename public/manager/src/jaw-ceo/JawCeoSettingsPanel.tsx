import { useEffect, useState } from 'react';
import { fetchJawCeoSettings, updateJawCeoSettings } from './api';
import type { JawCeoVoiceSettings } from './types';

function keyLabel(settings: JawCeoVoiceSettings | null): string {
    if (settings?.openaiKeyInvalid) return 'Invalid saved key';
    if (!settings?.openaiKeySet) return 'No key saved';
    const suffix = settings.openaiKeyLast4 ? `•••• ${settings.openaiKeyLast4}` : 'saved';
    if (settings.openaiKeySource === 'env') return `Env key ${suffix}`;
    if (settings.openaiKeySource === 'deps') return `Runtime key ${suffix}`;
    return `Saved key ${suffix}`;
}

export function JawCeoSettingsPanel() {
    const [settings, setSettings] = useState<JawCeoVoiceSettings | null>(null);
    const [keyInput, setKeyInput] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const canClearSaved = Boolean(settings?.openaiKeyInvalid || (settings?.openaiKeySet && settings.openaiKeySource !== 'env'));

    useEffect(() => {
        let cancelled = false;
        void fetchJawCeoSettings()
            .then(next => {
                if (!cancelled) setSettings(next);
            })
            .catch(err => {
                if (!cancelled) setError((err as Error).message);
            });
        return () => { cancelled = true; };
    }, []);

    async function saveKey(): Promise<void> {
        const trimmed = keyInput.trim();
        if (!trimmed) return;
        setSaving(true);
        try {
            const next = await updateJawCeoSettings({ openaiApiKey: trimmed });
            setSettings(next);
            setKeyInput('');
            setError(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    }

    async function clearKey(): Promise<void> {
        setSaving(true);
        try {
            const next = await updateJawCeoSettings({ clearOpenAiApiKey: true });
            setSettings(next);
            setKeyInput('');
            setError(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="jaw-ceo-settings-panel" aria-label="Jaw CEO settings">
            <form className="jaw-ceo-settings-form" onSubmit={(event) => { event.preventDefault(); void saveKey(); }}>
                <div className="jaw-ceo-settings-status">
                    <strong>Realtime voice</strong>
                    <span>{keyLabel(settings)}</span>
                </div>
                <label>
                    <span>OpenAI API key</span>
                    <input
                        value={keyInput}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={settings?.openaiKeySet ? 'sk-... replace saved key' : 'sk-...'}
                        onChange={event => setKeyInput(event.target.value)}
                    />
                </label>
                <div className="jaw-ceo-settings-meta">
                    <span>{settings?.model || 'gpt-realtime-2'}</span>
                    <span>{settings?.voice || 'marin'}</span>
                </div>
                {settings?.openaiKeyInvalid ? <p className="jaw-ceo-inline-error">Saved value is not an OpenAI API key. Paste a key that starts with sk-.</p> : null}
                {error ? <p className="jaw-ceo-inline-error">{error}</p> : null}
                <div className="jaw-ceo-form-row">
                    <button type="button" disabled={saving || !canClearSaved} onClick={() => void clearKey()}>Clear saved</button>
                    <button type="submit" disabled={saving || !keyInput.trim()}>{saving ? 'Saving' : 'Save key'}</button>
                </div>
            </form>
        </section>
    );
}
