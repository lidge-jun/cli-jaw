import type { ReactNode } from 'react';
import type { DashboardDetailTab } from '../types';

type WorkbenchProps = {
    mode: DashboardDetailTab;
    onModeChange: (mode: DashboardDetailTab) => void;
    header: ReactNode;
    modeActions?: ReactNode;
    overview: ReactNode;
    preview: ReactNode;
    logs: ReactNode;
    active: boolean;
};

const MODES: DashboardDetailTab[] = ['overview', 'preview', 'logs'];

function modeLabel(mode: DashboardDetailTab): string {
    return mode[0].toUpperCase() + mode.slice(1);
}

export function Workbench(props: WorkbenchProps) {
    return (
        <section className={`workbench workbench-${props.mode}`} aria-label="Selected instance workbench">
            <div className="workbench-header">
                {props.header}
                <div className="workbench-mode-bar">
                    <div className="workbench-mode-tabs" role="tablist" aria-label="Workbench modes"
                        onKeyDown={(event) => {
                            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                            const index = MODES.indexOf(props.mode);
                            const next = MODES[(index + (event.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length]!;
                            event.preventDefault(); props.onModeChange(next);
                            (event.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`))?.focus();
                        }}>
                        {MODES.map(mode => (
                            <button
                                key={mode}
                                type="button"
                                role="tab"
                                id={`workbench-tab-${mode}`}
                                data-mode={mode}
                                aria-selected={props.mode === mode}
                                aria-controls={`workbench-panel-${mode}`}
                                tabIndex={props.mode === mode ? 0 : -1}
                                className={props.mode === mode ? 'is-active' : ''}
                                onClick={() => props.onModeChange(mode)}
                            >
                                {modeLabel(mode)}
                            </button>
                        ))}
                    </div>
                    {props.modeActions}
                </div>
            </div>
            <div className="workbench-body">
                {props.mode === 'overview' && (
                    <div key="overview" id="workbench-panel-overview" role="tabpanel" aria-labelledby="workbench-tab-overview" className="workbench-panel workbench-panel-overview">{props.overview}</div>
                )}
                <div
                    key="preview"
                    id="workbench-panel-preview"
                    role="tabpanel"
                    aria-labelledby="workbench-tab-preview"
                    className="workbench-panel workbench-panel-preview"
                    hidden={props.mode !== 'preview'}
                    aria-hidden={props.mode !== 'preview'}
                    data-preview-host="persistent"
                >
                    {props.preview}
                </div>
                {props.mode === 'logs' && (
                    <div key="logs" id="workbench-panel-logs" role="tabpanel" aria-labelledby="workbench-tab-logs" className="workbench-panel workbench-panel-logs">{props.logs}</div>
                )}
            </div>
        </section>
    );
}
