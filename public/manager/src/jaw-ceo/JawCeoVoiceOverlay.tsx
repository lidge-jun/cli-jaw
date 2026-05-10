import type { JawCeoVoiceStatus } from './types';

function statusLabel(status: JawCeoVoiceStatus): string {
    if (status === 'connecting') return 'Connecting voice';
    if (status === 'silent') return 'Listening';
    return 'Voice active';
}

export function JawCeoVoiceOverlay(props: {
    status: JawCeoVoiceStatus;
    selectedPort: number | null;
    lastEventType: string | null;
    lastTranscript: string | null;
    onStop: () => void;
}) {
    if (props.status !== 'connecting' && props.status !== 'active' && props.status !== 'silent') return null;
    const label = statusLabel(props.status);
    const target = props.selectedPort == null ? 'Dashboard' : `Worker :${props.selectedPort}`;
    return (
        <div className={`jaw-ceo-voice-overlay status-${props.status}`} role="status" aria-live="polite">
            <div className="jaw-ceo-voice-overlay-card">
                <div className="jaw-ceo-voice-wave" aria-hidden="true"><span /><span /><span /></div>
                <div className="jaw-ceo-voice-overlay-copy">
                    <strong>{label}</strong>
                    <span>{props.status === 'silent' ? 'No speech detected. Session is still open.' : target}</span>
                    {props.lastTranscript ? <small>{props.lastTranscript}</small> : props.lastEventType ? <small>{props.lastEventType}</small> : null}
                </div>
                <button type="button" className="jaw-ceo-voice-stop" aria-label="Stop Jaw CEO voice" onClick={props.onStop}>
                    Stop
                </button>
            </div>
        </div>
    );
}
