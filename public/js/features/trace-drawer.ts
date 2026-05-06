import { api } from '../api.js';
import { escapeHtml } from '../render.js';

interface TraceSummary {
    id: string; cli: string; model: string; agentLabel: string; status: string;
    rawRetentionStatus: string; eventCount: number; byteCount: number; startedAt: number;
}
interface TraceEventListItem {
    seq: number; source: string; event_type?: string; eventType?: string; preview?: string;
    bytes?: number; retention_status?: string; retentionStatus?: string; created_at?: number; createdAt?: number;
}
interface TraceEventDetail extends TraceEventListItem { runId: string; raw: string; }
interface TraceEventsPage { total: number; events: TraceEventListItem[]; }

const PAGE_SIZE = 80;
let currentRunId = '';
let loadedCount = 0;
let totalCount = 0;
let loading = false;

function eventTypeOf(event: TraceEventListItem): string { return event.eventType || event.event_type || 'event'; }

function ensureDrawer(): HTMLElement {
    let overlay = document.getElementById('traceDrawerOverlay') as HTMLElement | null;
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'traceDrawerOverlay';
    overlay.className = 'trace-drawer-overlay';
    overlay.innerHTML = `<aside class="trace-drawer" role="dialog" aria-modal="true" aria-labelledby="traceDrawerTitle">
        <header class="trace-drawer-header">
            <div><p class="trace-drawer-kicker">Raw trace</p><h2 id="traceDrawerTitle">Trace</h2></div>
            <button class="trace-drawer-close" type="button" aria-label="Close trace drawer">×</button>
        </header>
        <section class="trace-drawer-meta" id="traceDrawerMeta"></section>
        <section class="trace-drawer-body">
            <div class="trace-event-list" id="traceEventList"></div>
            <pre class="trace-event-raw" id="traceEventRaw">Select an event.</pre>
        </section>
        <footer class="trace-drawer-footer"><button class="trace-load-more" type="button">Load more</button></footer>
    </aside>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (target === overlay || target.closest('.trace-drawer-close')) closeTraceDrawer();
        const row = target.closest('.trace-event-row') as HTMLElement | null;
        if (row) void loadEventDetail(row.dataset['runId'] || '', Number(row.dataset['seq'] || 0));
        if (target.closest('.trace-load-more')) void loadNextPage();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && overlay?.classList.contains('open')) closeTraceDrawer();
    });
    return overlay;
}

function setRaw(text: string): void {
    const raw = document.getElementById('traceEventRaw');
    if (raw) raw.textContent = text;
}
function closeTraceDrawer(): void { document.getElementById('traceDrawerOverlay')?.classList.remove('open'); }

function renderSummary(summary: TraceSummary): void {
    const title = document.getElementById('traceDrawerTitle');
    if (title) title.textContent = `${summary.cli || 'agent'} trace`;
    const meta = document.getElementById('traceDrawerMeta');
    if (!meta) return;
    meta.innerHTML = [
        ['run', summary.id], ['model', summary.model || '-'], ['agent', summary.agentLabel || '-'],
        ['status', summary.status], ['events', `${summary.eventCount}`], ['bytes', `${summary.byteCount}`],
        ['retention', summary.rawRetentionStatus],
    ].map(([label, value]) => `<span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`).join('');
}

function renderEventRows(events: TraceEventListItem[]): void {
    const list = document.getElementById('traceEventList');
    if (!list) return;
    const html = events.map(event => {
        const seq = Number(event.seq || 0);
        return `<button class="trace-event-row" type="button" data-run-id="${escapeHtml(currentRunId)}" data-seq="${seq}">
            <span class="trace-event-seq">#${seq}</span><span class="trace-event-source">${escapeHtml(event.source || 'trace')}</span>
            <span class="trace-event-type">${escapeHtml(eventTypeOf(event))}</span><span class="trace-event-preview">${escapeHtml(event.preview || '')}</span>
        </button>`;
    }).join('');
    list.insertAdjacentHTML('beforeend', html);
}

async function loadNextPage(): Promise<void> {
    if (!currentRunId || loading || (loadedCount >= totalCount && totalCount > 0)) return;
    loading = true;
    const page = await api<TraceEventsPage>(`/api/traces/${encodeURIComponent(currentRunId)}/events?offset=${loadedCount}&limit=${PAGE_SIZE}`);
    loading = false;
    if (!page) { setRaw('Trace events could not be loaded.'); return; }
    totalCount = page.total || 0;
    loadedCount += page.events.length;
    renderEventRows(page.events);
    const more = document.querySelector('.trace-load-more') as HTMLButtonElement | null;
    if (more) more.disabled = loadedCount >= totalCount;
}

async function loadEventDetail(runId: string, seq: number): Promise<void> {
    if (!runId || !Number.isInteger(seq) || seq < 1) return;
    setRaw('Loading event...');
    const detail = await api<TraceEventDetail>(`/api/traces/${encodeURIComponent(runId)}/events/${seq}`);
    setRaw(detail?.raw || (detail ? '(empty trace event)' : 'Trace event could not be loaded.'));
}

export async function openTraceDrawer(runId: string, seq?: number): Promise<void> {
    const overlay = ensureDrawer();
    currentRunId = runId;
    loadedCount = 0;
    totalCount = 0;
    const list = document.getElementById('traceEventList');
    if (list) list.innerHTML = '';
    setRaw('Loading trace...');
    overlay.classList.add('open');
    const summary = await api<TraceSummary>(`/api/traces/${encodeURIComponent(runId)}`);
    if (!summary) { setRaw('Trace is unavailable or internal-only.'); return; }
    renderSummary(summary);
    totalCount = summary.eventCount || 0;
    await loadNextPage();
    if (seq) await loadEventDetail(runId, seq);
}
