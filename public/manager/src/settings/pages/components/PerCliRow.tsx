// Phase 2 — single CLI row (model + effort + fastMode).

import { TextField, SelectField, ToggleField } from '../../fields';
import type { DirtyEntry } from '../../types';

type CliMeta = {
    label: string;
    models: ReadonlyArray<string>;
    efforts: ReadonlyArray<string>;
};

type PerCliEntry = {
    model?: string;
    effort?: string;
    fastMode?: boolean;
    [key: string]: unknown;
};

type Props = {
    cli: string;
    meta: CliMeta;
    original: PerCliEntry;
    value: PerCliEntry;
    setValue: (next: PerCliEntry) => void;
    setEntry: (key: string, entry: DirtyEntry) => void;
};

function entryFor(value: unknown, original: unknown, valid = true): DirtyEntry {
    return { value, original, valid };
}

export function PerCliRow({ cli, meta, original, value, setValue, setEntry }: Props) {
    const modelDatalistId = `percli-${cli}-models`;

    return (
        <div className="settings-percli-row" data-cli={cli}>
            <h3 className="settings-percli-title">{meta.label}</h3>
            <div className="settings-percli-grid">
                <div className="settings-percli-model">
                    <TextField
                        id={`percli-${cli}-model`}
                        label="Model"
                        value={value.model ?? ''}
                        onChange={(next) => {
                            setValue({ ...value, model: next });
                            setEntry(`perCli.${cli}.model`, entryFor(next, original.model ?? ''));
                        }}
                        placeholder={meta.models[0] ?? 'model id'}
                    />
                    {meta.models.length > 0 ? (
                        <datalist id={modelDatalistId}>
                            {meta.models.map((m) => (
                                <option key={m} value={m} />
                            ))}
                        </datalist>
                    ) : null}
                </div>
                {meta.efforts.length > 0 ? (
                    <SelectField
                        id={`percli-${cli}-effort`}
                        label="Effort"
                        value={value.effort ?? ''}
                        options={[
                            { value: '', label: '(default)' },
                            ...meta.efforts.map((e) => ({ value: e, label: e })),
                        ]}
                        onChange={(next) => {
                            setValue({ ...value, effort: next });
                            setEntry(`perCli.${cli}.effort`, entryFor(next, original.effort ?? ''));
                        }}
                    />
                ) : null}
                <ToggleField
                    id={`percli-${cli}-fastmode`}
                    label="Fast mode"
                    value={Boolean(value.fastMode)}
                    onChange={(next) => {
                        setValue({ ...value, fastMode: next });
                        setEntry(`perCli.${cli}.fastMode`, entryFor(next, Boolean(original.fastMode)));
                    }}
                />
            </div>
        </div>
    );
}

export type { CliMeta, PerCliEntry };
