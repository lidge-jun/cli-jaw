// ── Tool Use UI ──
// Phase 4/8: Tool call group rendering for agent messages
// Extracted from ui.ts for modularity.

import { escapeHtml } from '../render.js';

export interface ToolLogEntry {
    icon: string;
    label: string;
}

/** Build tool group HTML from finalized tool log entries */
export function buildToolGroupHtml(toolLog: ToolLogEntry[]): string {
    if (!toolLog || toolLog.length === 0) return '';

    const counts: Record<string, number> = {};
    toolLog.forEach(tl => {
        counts[tl.icon] = (counts[tl.icon] || 0) + 1;
    });

    const summaryParts = Object.entries(counts)
        .map(([icon, n]) => `${escapeHtml(icon)}×${n}`)
        .join(' ');

    const toolId = `td-${Date.now()}`;

    const logLines = toolLog.map(tl =>
        `<div class="tool-item"><div class="tool-item-header"><span class="tool-item-icon">${escapeHtml(tl.icon)}</span><span class="tool-item-label">${escapeHtml(tl.label)}</span></div></div>`
    ).join('');

    return `<div class="tool-group"><button class="tool-group-summary" aria-expanded="false" aria-controls="${toolId}"><span class="tool-status-dot done"></span><span class="tool-group-summary-text">${summaryParts}</span><span class="tool-group-chevron">▾</span></button><div class="tool-details collapsed" id="${toolId}">${logLines}</div></div>`;
}

/** Show live tool activity indicator inside the current agent message */
export function renderLiveToolActivity(msgDiv: HTMLElement, label: string): void {
    let liveEl = msgDiv.querySelector('.tool-activity-live') as HTMLElement | null;
    if (!liveEl) {
        liveEl = document.createElement('div');
        liveEl.className = 'tool-activity-live';
        const content = msgDiv.querySelector('.msg-content');
        if (content) content.before(liveEl);
    }
    liveEl.innerHTML = `<span class="tool-status-dot running"></span><span>${escapeHtml(label)}</span>`;
}

/** Clean up all live tool activity indicators */
export function cleanupToolElements(): void {
    document.querySelectorAll('.tool-activity-live').forEach(el => el.remove());
    document.querySelectorAll('.msg-system.tool-activity').forEach(el => el.remove());
}
