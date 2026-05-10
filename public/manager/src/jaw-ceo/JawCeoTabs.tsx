import type { JawCeoConsoleTab } from './types';

const TABS: Array<{ id: JawCeoConsoleTab; label: string }> = [
    { id: 'chat', label: 'Chat' },
    { id: 'settings', label: 'Settings' },
];

export function JawCeoTabs(props: {
    active: JawCeoConsoleTab;
    onChange: (tab: JawCeoConsoleTab) => void;
}) {
    return (
        <div className="jaw-ceo-tabs" role="tablist" aria-label="Jaw CEO console tabs">
            {TABS.map(tab => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    className={props.active === tab.id ? 'is-active' : ''}
                    aria-selected={props.active === tab.id}
                    onClick={() => props.onChange(tab.id)}
                >
                    <span>{tab.label}</span>
                </button>
            ))}
        </div>
    );
}
