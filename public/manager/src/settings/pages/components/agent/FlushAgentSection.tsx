import { SelectField } from '../../../fields';
import { SettingsSection } from '../../page-shell';

type FlushAgentSectionProps = {
    activeCli: string;
    flushCli: string;
    flushModel: string;
    cliOptions: ReadonlyArray<string>;
    modelOptions: ReadonlyArray<{ value: string; label: string }>;
    loading?: boolean;
    error?: string | null;
    onFlushCliChange(next: string): void;
    onFlushModelChange(next: string): void;
};

export function FlushAgentSection({
    activeCli,
    flushCli,
    flushModel,
    cliOptions,
    modelOptions,
    loading,
    error,
    onFlushCliChange,
    onFlushModelChange,
}: FlushAgentSectionProps) {
    const effectiveCli = flushCli || activeCli;
    return (
        <SettingsSection
            title="Flush Agent"
            hint="Separate summary agent used for context flush and compact work."
        >
            <details className="settings-agent-flush">
                <summary>
                    <span>Flush runtime</span>
                    <code>{effectiveCli || 'active'}{flushModel && flushModel !== 'default' ? ` / ${flushModel}` : ''}</code>
                </summary>
                {loading ? <p className="settings-agent-note">Loading flush settings...</p> : null}
                {error ? <p className="settings-field-error" role="alert">{error}</p> : null}
                <div className="settings-agent-runtime-grid">
                    <SelectField
                        id="agent-flush-cli"
                        label="Flush CLI"
                        value={flushCli}
                        options={[
                            { value: '', label: '(active CLI)' },
                            ...cliOptions.map((value) => ({ value, label: value })),
                        ]}
                        onChange={onFlushCliChange}
                    />
                    <SelectField
                        id="agent-flush-model"
                        label="Flush model"
                        value={flushModel}
                        options={[{ value: '', label: '(default)' }, ...modelOptions]}
                        onChange={onFlushModelChange}
                    />
                </div>
            </details>
        </SettingsSection>
    );
}
