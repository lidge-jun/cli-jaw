// Phase 8 — single MCP server card. The MCP page composes a list of these
// over the `servers` map returned by `/api/mcp`. Pure presentation; the
// parent owns the canonical server map and the dirty entry.
//
// The shape is defensive: `args` may be missing on legacy entries (treated
// as `[]`), `env` may be missing or null. We only persist back a clean
// `McpServer` so loadUnifiedMcp/saveUnifiedMcp round-trip stays stable.

import type { McpServer } from '../mcp-helpers';
import {
    formatArgsText,
    formatEnvText,
    parseArgsText,
    parseEnvText,
} from '../mcp-helpers';

type Props = {
    name: string;
    server: McpServer;
    onRename: (nextName: string) => void;
    onChange: (next: McpServer) => void;
    onRemove: () => void;
    nameError?: string | null;
};

export function McpServerCard({
    name,
    server,
    onRename,
    onChange,
    onRemove,
    nameError,
}: Props) {
    const id = `mcp-${name || 'unnamed'}`;
    const argsText = formatArgsText(server.args);
    const envText = formatEnvText(server.env);

    return (
        <article className="mcp-server-card" aria-label={`MCP server ${name || '(unnamed)'}`}>
            <header className="mcp-server-card-header">
                <label className="settings-field settings-field-text" htmlFor={`${id}-name`}>
                    <span className="settings-field-label">Server name</span>
                    <input
                        id={`${id}-name`}
                        type="text"
                        value={name}
                        spellCheck={false}
                        placeholder="my-server"
                        aria-invalid={Boolean(nameError)}
                        onChange={(event) => onRename(event.target.value)}
                    />
                    {nameError ? (
                        <span className="settings-field-error" role="alert">
                            {nameError}
                        </span>
                    ) : null}
                </label>
                <button
                    type="button"
                    className="settings-action settings-action-discard"
                    onClick={onRemove}
                    aria-label={`Remove ${name || 'server'}`}
                >
                    Remove
                </button>
            </header>

            <label className="settings-field settings-field-text" htmlFor={`${id}-command`}>
                <span className="settings-field-label">Command</span>
                <input
                    id={`${id}-command`}
                    type="text"
                    value={server.command || ''}
                    placeholder="npx"
                    spellCheck={false}
                    onChange={(event) =>
                        onChange({ ...server, command: event.target.value })
                    }
                />
            </label>

            <label className="settings-field settings-field-text" htmlFor={`${id}-args`}>
                <span className="settings-field-label">
                    Args (one per line, or comma-separated)
                </span>
                <textarea
                    id={`${id}-args`}
                    value={argsText}
                    rows={3}
                    spellCheck={false}
                    onChange={(event) =>
                        onChange({ ...server, args: parseArgsText(event.target.value) })
                    }
                />
            </label>

            <label className="settings-field settings-field-text" htmlFor={`${id}-env`}>
                <span className="settings-field-label">Env (KEY=value per line)</span>
                <textarea
                    id={`${id}-env`}
                    value={envText}
                    rows={3}
                    spellCheck={false}
                    onChange={(event) =>
                        onChange({ ...server, env: parseEnvText(event.target.value) })
                    }
                />
            </label>

            <label className="settings-field settings-field-toggle" htmlFor={`${id}-autostart`}>
                <input
                    id={`${id}-autostart`}
                    type="checkbox"
                    checked={Boolean(server.autostart)}
                    onChange={(event) =>
                        onChange({ ...server, autostart: event.target.checked })
                    }
                />
                <span className="settings-field-label">Autostart</span>
            </label>
        </article>
    );
}
