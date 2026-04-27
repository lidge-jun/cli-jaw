import type { MouseEvent } from 'react';
import type { DashboardInstance, DashboardLifecycleAction } from '../types';

type InstanceRowProps = {
    instance: DashboardInstance;
    selected: boolean;
    busy: boolean;
    label: string;
    uptime: string;
    density?: 'compact' | 'comfortable' | 'rail';
    priority?: 'active' | 'pinned' | 'normal' | 'hidden';
    transitioning?: DashboardLifecycleAction | null;
    onSelect: (instance: DashboardInstance) => void;
    onPreview: (instance: DashboardInstance) => void;
    onLifecycle: (action: DashboardLifecycleAction, instance: DashboardInstance) => void;
};

const TRANSITION_LABELS: Record<DashboardLifecycleAction, string> = {
    start: 'starting…',
    stop: 'stopping…',
    restart: 'restarting…',
};

function statusClass(status: DashboardInstance['status']): string {
    return `instance-status status-${status}`;
}

export function InstanceRow(props: InstanceRowProps) {
    const lifecycle = props.instance.lifecycle;
    const reason = lifecycle?.reason || props.instance.healthReason || 'ok';

    function stopAction(event: MouseEvent<HTMLElement>): void {
        event.stopPropagation();
    }

    const transitionLabel = props.transitioning ? TRANSITION_LABELS[props.transitioning] : null;
    const dotClass = `${statusClass(props.instance.status)}${transitionLabel ? ' is-transitioning' : ''}`;

    return (
        <article className={`instance-row density-${props.density || 'comfortable'} priority-${props.priority || 'normal'} ${props.selected ? 'is-selected' : ''}${transitionLabel ? ' is-transitioning-row' : ''}`}>
            <button
                className="instance-row-select"
                type="button"
                aria-pressed={props.selected}
                onClick={() => props.onSelect(props.instance)}
            >
                <div className="instance-row-main">
                    <span className={dotClass} aria-label={props.instance.status} />
                    <div className="instance-row-title">
                        <strong>{props.instance.favorite ? `Pinned ${props.label}` : props.label}</strong>
                        <span>
                            {transitionLabel
                                ? <em className="instance-row-transition">{transitionLabel}</em>
                                : (props.instance.group ? `${props.instance.group} · ${props.instance.workingDir || props.instance.url}` : props.instance.workingDir || props.instance.url)}
                        </span>
                    </div>
                    <span className="port">:{props.instance.port}</span>
                </div>
                <div className="instance-row-meta">
                    <span>{props.instance.currentCli || 'cli n/a'} / {props.instance.currentModel || 'model n/a'}</span>
                    <span>v{props.instance.version || 'n/a'} · {props.uptime}</span>
                    <span>{new Date(props.instance.lastCheckedAt).toLocaleTimeString()} · {reason}</span>
                </div>
            </button>
            <div className="instance-actions">
                <button
                    type="button"
                    onClick={(event) => {
                        stopAction(event);
                        props.onPreview(props.instance);
                    }}
                    disabled={!props.instance.ok}
                >
                    Preview
                </button>
                <a
                    className="open-link"
                    href={props.instance.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={stopAction}
                >
                    Open
                </a>
                <button
                    type="button"
                    onClick={(event) => {
                        stopAction(event);
                        props.onLifecycle('start', props.instance);
                    }}
                    disabled={!lifecycle?.canStart || props.busy}
                    title={lifecycle?.commandPreview.join(' ')}
                >
                    Start
                </button>
                <button
                    type="button"
                    onClick={(event) => {
                        stopAction(event);
                        props.onLifecycle('stop', props.instance);
                    }}
                    disabled={!lifecycle?.canStop || props.busy}
                >
                    Stop
                </button>
                <button
                    type="button"
                    onClick={(event) => {
                        stopAction(event);
                        props.onLifecycle('restart', props.instance);
                    }}
                    disabled={!lifecycle?.canRestart || props.busy}
                >
                    Restart
                </button>
            </div>
        </article>
    );
}
