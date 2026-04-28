import { useEffect, useState } from 'react';
import type { SettingsPageProps } from '../types';
import { SettingsRequestError } from '../settings-client';

type LoadState =
    | { kind: 'loading' }
    | { kind: 'ready'; cli: string }
    | { kind: 'offline' }
    | { kind: 'error'; message: string };

type SettingsResponse = {
    cli?: unknown;
    [key: string]: unknown;
};

export default function IdentityPreview({ port, client }: SettingsPageProps) {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    useEffect(() => {
        let cancelled = false;
        setState({ kind: 'loading' });

        client
            .get<SettingsResponse | string>('/api/settings')
            .then((res) => {
                if (cancelled) return;
                if (typeof res === 'string') {
                    setState({ kind: 'offline' });
                    return;
                }
                if (!res || typeof res !== 'object') {
                    setState({ kind: 'offline' });
                    return;
                }
                const cli = typeof res.cli === 'string' ? res.cli : '';
                setState({ kind: 'ready', cli });
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                if (err instanceof SettingsRequestError) {
                    if (err.status === 401 || err.status === 403) {
                        setState({
                            kind: 'error',
                            message:
                                'Instance requires auth. Open its native UI to grant access.',
                        });
                        return;
                    }
                    if (err.status >= 500 || err.status === 0) {
                        setState({ kind: 'offline' });
                        return;
                    }
                    setState({ kind: 'error', message: err.message });
                    return;
                }
                setState({
                    kind: 'error',
                    message: err instanceof Error ? err.message : String(err),
                });
            });

        return () => {
            cancelled = true;
        };
    }, [client, port]);

    return (
        <article className="settings-section settings-identity-preview">
            <header className="settings-section-header">
                <h2>Identity (preview)</h2>
                <p className="settings-section-hint">
                    Smoke test for Phase 1: read-only view of the instance's CLI.
                </p>
            </header>
            {state.kind === 'loading' && (
                <div className="settings-loading">Loading instance settings…</div>
            )}
            {state.kind === 'offline' && (
                <div className="settings-error" role="alert">
                    Instance offline or proxy error. The dashboard could not reach
                    <code> /i/{port}/api/settings</code>.
                </div>
            )}
            {state.kind === 'error' && (
                <div className="settings-error" role="alert">
                    {state.message}
                </div>
            )}
            {state.kind === 'ready' && (
                <dl className="settings-readonly-grid">
                    <dt>CLI</dt>
                    <dd>
                        <code>{state.cli || '(not set)'}</code>
                    </dd>
                </dl>
            )}
        </article>
    );
}
