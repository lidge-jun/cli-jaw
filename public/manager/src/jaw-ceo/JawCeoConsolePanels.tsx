import type { ReactElement } from 'react';
import type { JawCeoController } from './useJawCeo';
import type { JawCeoVoiceController } from './useJawCeoVoice';
import type { JawCeoAuditRecord, JawCeoCompletion, JawCeoResponseMode, JawCeoWatch } from './types';
import type { JawCeoConsoleModel } from './useJawCeoConsoleModel';
import { JawCeoSettingsPanel } from './JawCeoSettingsPanel';

type TimelineEntry =
    | { kind: 'chat'; id: string; at: string; role: 'user' | 'ceo' | 'tool'; text: string }
    | { kind: 'result'; id: string; at: string; completion: JawCeoCompletion }
    | { kind: 'watch'; id: string; at: string; watch: JawCeoWatch }
    | { kind: 'tool'; id: string; at: string; record: JawCeoAuditRecord }
    | { kind: 'live'; id: string; at: string; text: string; eventType: string | null };

type ActivityEntry = Extract<TimelineEntry, { kind: 'result' | 'watch' | 'tool' }>;
type RenderItem =
    | Extract<TimelineEntry, { kind: 'chat' | 'live' }>
    | { kind: 'activity-group'; id: string; at: string; entries: ActivityEntry[] };
type ActivityTone = 'tool' | 'thinking' | 'subagent';

function formatTime(raw: string): string {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleTimeString();
}

function completionLabel(completion: JawCeoCompletion): string {
    return completion.summary || `Worker :${completion.port} has a result ready.`;
}

function quickPrompts(selectedPort: number | null): Array<{ label: string; text: string }> {
    return [
        {
            label: selectedPort == null ? 'Inspect dashboard' : `Inspect :${selectedPort}`,
            text: selectedPort == null ? 'What needs attention on this dashboard right now?' : `What is worker :${selectedPort} doing right now?`,
        },
        { label: 'Summarize results', text: 'Summarize the worker results and tell me what needs action.' },
        {
            label: selectedPort == null ? 'Route work' : `Send to :${selectedPort}`,
            text: selectedPort == null ? 'Create or choose the right worker for this task: ' : `Send this task to worker :${selectedPort}: `,
        },
    ];
}

function buildTimeline(args: { model: JawCeoConsoleModel; ceo: JawCeoController; voice: JawCeoVoiceController }): TimelineEntry[] {
    const entries: TimelineEntry[] = [
        ...args.model.chat.map(entry => ({ kind: 'chat' as const, id: entry.id, at: entry.at, role: entry.role, text: entry.text })),
        ...args.ceo.pending
            .filter(completion => completion.status === 'pending' || completion.status === 'spoken')
            .map(completion => ({ kind: 'result' as const, id: `result-${completion.completionKey}`, at: completion.detectedAt, completion })),
        ...args.ceo.state.watches.map(watch => ({ kind: 'watch' as const, id: `watch-${watch.watchId}`, at: watch.createdAt, watch })),
        ...args.ceo.audit.slice(-24).map(record => ({ kind: 'tool' as const, id: `audit-${record.id}`, at: record.at, record })),
    ];
    entries.sort((a, b) => {
        const diff = Date.parse(a.at) - Date.parse(b.at);
        return diff === 0 ? a.id.localeCompare(b.id) : diff;
    });
    if (args.voice.lastTranscript) {
        entries.push({ kind: 'live', id: 'live-voice-transcript', at: new Date().toISOString(), text: args.voice.lastTranscript, eventType: args.voice.lastEventType });
    }
    return entries;
}

function groupTimeline(entries: TimelineEntry[]): RenderItem[] {
    const items: RenderItem[] = [];
    let group: ActivityEntry[] = [];
    function flush(): void {
        if (group.length === 0) return;
        items.push({ kind: 'activity-group', id: `activity-${group[0].id}-${group.length}`, at: group[0].at, entries: group });
        group = [];
    }
    for (const entry of entries) {
        if (entry.kind === 'chat' || entry.kind === 'live') {
            flush();
            items.push(entry);
        } else {
            group.push(entry);
        }
    }
    flush();
    return items;
}

function activityTone(entry: ActivityEntry): ActivityTone {
    if (entry.kind === 'result') return 'subagent';
    if (entry.kind === 'watch') return 'thinking';
    if (entry.record.kind === 'tool') return 'tool';
    if (entry.record.kind === 'completion') return 'subagent';
    return 'thinking';
}

function activityTitle(entry: ActivityEntry): string {
    if (entry.kind === 'result') return `Worker :${entry.completion.port} result`;
    if (entry.kind === 'watch') return `Listening to worker :${entry.watch.port}`;
    if (entry.record.kind === 'completion') return 'Worker completion';
    if (entry.record.kind === 'docs_edit') return 'Docs edit';
    if (entry.record.kind === 'lifecycle') return 'Lifecycle';
    if (entry.record.kind === 'policy') return 'Policy check';
    return entry.record.action || 'Tool use';
}

function activityPreview(entry: ActivityEntry): string {
    if (entry.kind === 'result') return entry.completion.resultText || completionLabel(entry.completion);
    if (entry.kind === 'watch') return `${entry.watch.reason} · fallback ${entry.watch.latestMessageFallback.mode}`;
    return entry.record.message;
}

function activityTime(entry: ActivityEntry): string {
    if (entry.kind === 'result') return entry.completion.detectedAt;
    if (entry.kind === 'watch') return entry.watch.createdAt;
    return entry.record.at;
}

function activityIsError(entry: ActivityEntry): boolean {
    return entry.kind === 'tool' && !entry.record.ok;
}

function activitySummary(entries: ActivityEntry[]): string {
    const counts = entries.reduce((acc, entry) => {
        acc[activityTone(entry)] += 1;
        return acc;
    }, { tool: 0, thinking: 0, subagent: 0 });
    return [
        counts.tool > 0 ? `Tool×${counts.tool}` : null,
        counts.thinking > 0 ? `Thinking×${counts.thinking}` : null,
        counts.subagent > 0 ? `Subagent×${counts.subagent}` : null,
    ].filter(Boolean).join(' + ');
}

function MessageText(props: { text: string }) {
    const lines = props.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return <p>...</p>;
    const blocks: ReactElement[] = [];
    let bullets: string[] = [];
    function flushBullets(): void {
        if (bullets.length === 0) return;
        blocks.push(<ul key={`ul-${blocks.length}`}>{bullets.map((bullet, index) => <li key={`${bullet}-${index}`}>{bullet}</li>)}</ul>);
        bullets = [];
    }
    lines.forEach((line, index) => {
        const bullet = line.match(/^[-*]\s+(.+)$/);
        if (bullet) {
            bullets.push(bullet[1]);
            return;
        }
        flushBullets();
        blocks.push(<p key={`p-${index}`}>{line}</p>);
    });
    flushBullets();
    return <>{blocks}</>;
}

function ActivityIcon(props: { tone: ActivityTone }) {
    if (props.tone === 'tool') {
        return (
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M10.5 2.5 13 5l-2.4 2.4-1.2-1.2-4.8 4.8-1.7.2.2-1.7 4.8-4.8-1.1-1.1L9.2 1.2l1.3 1.3Z" />
            </svg>
        );
    }
    if (props.tone === 'subagent') {
        return (
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 4.5h10v7H3z" />
                <path d="M6 4.5V3h4v1.5M5.2 8h.1M10.7 8h.1" />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 4.5h10v7H5.7L3 13.4z" />
        </svg>
    );
}

function ActivityGroup(props: {
    entries: ActivityEntry[];
    model: JawCeoConsoleModel;
    ceo: JawCeoController;
    voice: JawCeoVoiceController;
    onOpenWorker: (port: number, messageId?: number) => void;
}) {
    return (
        <section className="jaw-ceo-activity-shell" aria-label="CEO activity">
            <span className="jaw-ceo-activity-avatar" aria-hidden="true">CEO</span>
            <details className="jaw-ceo-activity-group" open>
                <summary>
                    <span className="jaw-ceo-activity-status" aria-hidden="true" />
                    <strong>{activitySummary(props.entries) || 'Activity'}</strong>
                </summary>
                <div className="jaw-ceo-activity-list">
                    {props.entries.map(entry => {
                        const tone = activityTone(entry);
                        return (
                            <article key={entry.id} className={`jaw-ceo-activity-row tone-${tone}${activityIsError(entry) ? ' is-error' : ''}`}>
                                <span className="jaw-ceo-activity-dot" aria-hidden="true" />
                                <span className="jaw-ceo-activity-icon"><ActivityIcon tone={tone} /></span>
                                <span className="jaw-ceo-activity-badge">{tone}</span>
                                <div className="jaw-ceo-activity-copy">
                                    <strong>{activityTitle(entry)}</strong>
                                    <p>{activityPreview(entry)}</p>
                                    <small>{formatTime(activityTime(entry))}</small>
                                </div>
                                {entry.kind === 'result' ? (
                                    <div className="jaw-ceo-activity-actions">
                                        <button type="button" onClick={() => props.onOpenWorker(entry.completion.port, entry.completion.messageId)}>Open</button>
                                        <button type="button" onClick={() => void props.model.summarize(entry.completion)}>Summary</button>
                                        <button type="button" onClick={() => void props.model.continueCompletion(entry.completion)}>Continue</button>
                                        <button type="button" onClick={() => void props.voice.speakCompletion(entry.completion)}>Speak</button>
                                        <button type="button" onClick={() => void props.ceo.ackCompletion(entry.completion.completionKey)}>Ack</button>
                                    </div>
                                ) : <span className="jaw-ceo-trace-chip">Trace</span>}
                            </article>
                        );
                    })}
                </div>
            </details>
        </section>
    );
}

function TimelineEntryView(props: {
    entry: RenderItem;
    model: JawCeoConsoleModel;
    ceo: JawCeoController;
    voice: JawCeoVoiceController;
    onOpenWorker: (port: number, messageId?: number) => void;
}) {
    const entry = props.entry;
    if (entry.kind === 'activity-group') {
        return <ActivityGroup entries={entry.entries} model={props.model} ceo={props.ceo} voice={props.voice} onOpenWorker={props.onOpenWorker} />;
    }
    if (entry.kind === 'chat') {
        return (
            <article className={`jaw-ceo-message-row role-${entry.role}`}>
                <span className="jaw-ceo-message-avatar" aria-hidden="true">{entry.role === 'user' ? 'You' : entry.role === 'ceo' ? 'CEO' : 'Log'}</span>
                <div className="jaw-ceo-message-bubble">
                    <div className="jaw-ceo-message-meta"><strong>{entry.role === 'user' ? 'You' : entry.role === 'ceo' ? 'Jaw CEO' : 'Tool output'}</strong><small>{formatTime(entry.at)}</small></div>
                    <div className="jaw-ceo-message-text"><MessageText text={entry.text} /></div>
                </div>
            </article>
        );
    }
    if (entry.kind === 'live') {
        return (
            <article className="jaw-ceo-message-row role-ceo is-live" aria-live="polite">
                <span className="jaw-ceo-message-avatar is-live" aria-hidden="true">CEO</span>
                <div className="jaw-ceo-message-bubble">
                    <div className="jaw-ceo-message-meta"><strong>Jaw CEO live</strong><small>{entry.eventType || 'realtime'}</small></div>
                    <div className="jaw-ceo-message-text"><MessageText text={entry.text} /></div>
                </div>
            </article>
        );
    }
    return null;
}

function ChatPanel(props: { model: JawCeoConsoleModel; ceo: JawCeoController; voice: JawCeoVoiceController; selectedPort: number | null; onOpenWorker: (port: number, messageId?: number) => void }) {
    const timeline = groupTimeline(buildTimeline({ model: props.model, ceo: props.ceo, voice: props.voice }));
    return (
        <section className="jaw-ceo-chat-panel" aria-label="Jaw CEO chat">
            <div className="jaw-ceo-chat-log jaw-ceo-timeline" aria-live="polite">
                {timeline.length === 0 ? (
                    <div className="jaw-ceo-empty-state">
                        <span className="jaw-ceo-empty-kicker">Ready</span>
                        <strong>{props.selectedPort == null ? 'Dashboard context' : `Worker :${props.selectedPort} selected`}</strong>
                        <div className="jaw-ceo-quick-prompts">
                            {quickPrompts(props.selectedPort).map(prompt => (
                                <button key={prompt.label} type="button" onClick={() => props.model.setMessage(prompt.text)}>{prompt.label}</button>
                            ))}
                        </div>
                    </div>
                ) : timeline.map(entry => <TimelineEntryView key={entry.id} entry={entry} model={props.model} ceo={props.ceo} voice={props.voice} onOpenWorker={props.onOpenWorker} />)}
            </div>
            <form className="jaw-ceo-message-form" onSubmit={(event) => void props.model.submitMessage(event)}>
                <textarea value={props.model.message} rows={3} placeholder="Send a task to the selected worker or ask about the dashboard." onChange={event => props.model.setMessage(event.target.value)} />
                <div className="jaw-ceo-form-row">
                    <select value={props.model.responseMode} aria-label="Response mode" onChange={event => props.model.setResponseMode(event.target.value as JawCeoResponseMode)}>
                        <option value="text">Text</option><option value="voice">Voice</option><option value="both">Both</option><option value="silent">Silent</option>
                    </select>
                    <button type="submit" disabled={props.ceo.busy || !props.model.message.trim()}>Send</button>
                </div>
            </form>
        </section>
    );
}

export function JawCeoConsoleBody(props: { model: JawCeoConsoleModel; ceo: JawCeoController; voice: JawCeoVoiceController; selectedPort: number | null; onOpenWorker: (port: number, messageId?: number) => void }) {
    if (props.model.tab === 'settings') return <JawCeoSettingsPanel />;
    return <ChatPanel model={props.model} ceo={props.ceo} voice={props.voice} selectedPort={props.selectedPort} onOpenWorker={props.onOpenWorker} />;
}
