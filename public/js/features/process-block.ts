// ── Process Block ──
// Collapsible panel showing tool/thinking activity during agent responses.

import { escapeHtml } from '../render.js';

export interface ProcessStep {
    id: string;
    type: 'tool' | 'thinking' | 'search';
    icon: string;
    label: string;
    detail?: string;
    status: 'running' | 'done' | 'error';
    startTime: number;
}

export interface ProcessBlockState {
    element: HTMLElement;
    steps: ProcessStep[];
    collapsed: boolean;
}

function buildSummaryText(steps: ProcessStep[]): string {
    const counts: Record<string, number> = {};
    for (const s of steps) {
        const key = s.type === 'thinking' ? '💭 Thinking'
            : s.type === 'search' ? '🔍 Search'
            : '🔧';
        counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
        .map(([k, n]) => n > 1 ? `${k}×${n}` : k)
        .join(' + ');
}

function renderStep(step: ProcessStep): string {
    const dotClass = `process-step-dot ${step.status}`;
    const badgeClass = `process-step-badge ${step.type}`;
    const badgeText = step.type.toUpperCase();
    const label = escapeHtml(step.label);

    if (step.type === 'thinking' && step.detail) {
        const preview = escapeHtml(step.detail.slice(0, 80));
        const hasMore = step.detail.length > 80;
        return `<div class="process-step" data-step-id="${step.id}" data-type="thinking">
            <span class="${dotClass}"></span>
            <span class="${badgeClass}">${badgeText}</span>
            <span class="process-step-text">${preview}${hasMore ? '…' : ''}</span>
        </div>`;
    }

    const detail = step.detail ? `<span class="process-step-detail">${escapeHtml(step.detail)}</span>` : '';
    return `<div class="process-step" data-step-id="${step.id}" data-type="${step.type}">
        <span class="${dotClass}"></span>
        <span class="${badgeClass}">${badgeText}</span>
        <span class="process-step-label">${label}</span>
        ${detail}
    </div>`;
}

function updateSummary(pb: ProcessBlockState): void {
    const summaryText = pb.element.querySelector('.process-summary-text');
    if (summaryText) summaryText.textContent = buildSummaryText(pb.steps);

    const anyRunning = pb.steps.some(s => s.status === 'running');
    const dot = pb.element.querySelector('.process-dot');
    if (dot) {
        dot.classList.toggle('running', anyRunning);
        dot.classList.toggle('done', !anyRunning);
    }

    const elapsed = pb.steps.length > 0
        ? Math.round((Date.now() - pb.steps[0].startTime) / 1000)
        : 0;
    const dur = pb.element.querySelector('.process-duration');
    if (dur) dur.textContent = elapsed > 0 ? `${elapsed}s` : '';
}

export function createProcessBlock(parentEl: HTMLElement): ProcessBlockState {
    const el = document.createElement('div');
    el.className = 'process-block';
    el.innerHTML = `<button class="process-summary" aria-expanded="true"><span class="process-dot running"></span><span class="process-summary-text"></span><span class="process-duration"></span><span class="process-chevron">▾</span></button><div class="process-details"><div class="process-steps-inner"></div></div>`;

    const btn = el.querySelector('.process-summary') as HTMLButtonElement;
    btn.addEventListener('click', () => {
        const collapsed = el.classList.toggle('collapsed');
        btn.setAttribute('aria-expanded', String(!collapsed));
        const chevron = el.querySelector('.process-chevron');
        if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
    });

    const content = parentEl.querySelector('.msg-content');
    if (content) content.before(el);
    else parentEl.appendChild(el);

    return { element: el, steps: [], collapsed: false };
}

export function addStep(pb: ProcessBlockState, step: ProcessStep): void {
    pb.steps.push(step);
    const inner = pb.element.querySelector('.process-steps-inner');
    if (inner) inner.insertAdjacentHTML('beforeend', renderStep(step));
    updateSummary(pb);
}

export function updateStepStatus(pb: ProcessBlockState, stepId: string, status: ProcessStep['status']): void {
    const step = pb.steps.find(s => s.id === stepId);
    if (!step) return;
    step.status = status;
    const stepEl = pb.element.querySelector(`[data-step-id="${stepId}"]`);
    if (stepEl) {
        const dot = stepEl.querySelector('.process-step-dot');
        if (dot) { dot.className = `process-step-dot ${status}`; }
    }
    updateSummary(pb);
}

export function collapseBlock(pb: ProcessBlockState): void {
    pb.collapsed = true;
    pb.element.classList.add('collapsed');
    const btn = pb.element.querySelector('.process-summary');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    const chevron = pb.element.querySelector('.process-chevron');
    if (chevron) chevron.textContent = '▸';

    for (const step of pb.steps) {
        if (step.status === 'running') step.status = 'done';
    }
    pb.element.querySelectorAll('.process-step-dot.running').forEach(dot => {
        dot.classList.remove('running');
        dot.classList.add('done');
    });
    updateSummary(pb);
}
