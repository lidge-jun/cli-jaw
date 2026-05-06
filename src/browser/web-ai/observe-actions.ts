/**
 * G02 — observe-actions: ranked candidate-action API derived from a web-AI
 * accessibility snapshot. Mirrors agbrowse `web-ai/observe-actions.mjs`.
 *
 * Pure function. No hosted/cloud, no stealth, no CAPTCHA bypass, no external CDP.
 */

export interface InteractiveRef {
    role: string;
    name?: string;
    occurrenceIndex?: number;
    disabled?: boolean;
    readonly?: boolean;
    required?: boolean;
    checked?: boolean;
    selected?: boolean;
}

export interface WebAiSnapshotLike {
    snapshotId?: string | null;
    url?: string | null;
    refs: Record<string, InteractiveRef>;
}

export type ObserveAction = 'click' | 'type' | 'select' | 'submit' | 'check' | 'read';

export interface ActionCandidate {
    ref: string;
    role: string;
    name: string;
    action: ObserveAction;
    method: string;
    args: Record<string, string>;
    confidence: number;
    signals: string[];
    riskFlags: string[];
    occurrenceIndex?: number;
}

export interface ObserveActionsResult {
    snapshotId: string | null;
    instruction: string;
    candidates: ActionCandidate[];
}

export interface ObserveActionsOptions {
    topN?: number;
    includeDisabled?: boolean;
}

const CLICKABLE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'option', 'switch']);
const TYPABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const CHECKABLE_ROLES = new Set(['checkbox', 'radio']);
const SELECTABLE_ROLES = new Set(['listbox', 'combobox']);
const READABLE_ROLES = new Set(['heading', 'paragraph', 'text', 'cell', 'row']);

const DESTRUCTIVE_PATTERNS = [
    /\b(delete|remove|drop|destroy|erase|wipe)\b/i,
    /\b(sign\s*out|log\s*out|disconnect)\b/i,
    /\b(cancel\s+subscription|unsubscribe)\b/i,
];
const AUTH_PATTERNS = [/\bpassword\b/i, /\b2fa\b/i, /\botp\b/i, /\bverification\s+code\b/i];
const UPLOAD_PATTERNS = [/\b(upload|attach|choose\s*file|browse)\b/i];

function tokenize(s: string): string[] {
    return String(s || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2);
}

function defaultActionForRole(role: string, name: string): ObserveAction {
    if (CHECKABLE_ROLES.has(role)) return 'check';
    if (role === 'listbox' || role === 'combobox') return 'select';
    if (TYPABLE_ROLES.has(role)) return 'type';
    if (CLICKABLE_ROLES.has(role)) {
        if (/\bsubmit\b/i.test(name) || /^submit$/i.test(name)) return 'submit';
        return 'click';
    }
    if (READABLE_ROLES.has(role)) return 'read';
    return 'click';
}

function riskFlagsFor(role: string, name: string): string[] {
    const flags: string[] = [];
    if (DESTRUCTIVE_PATTERNS.some((p) => p.test(name))) flags.push('destructive');
    if (role === 'link') flags.push('crossOrigin');
    if (AUTH_PATTERNS.some((p) => p.test(name))) flags.push('requiresAuth');
    if (UPLOAD_PATTERNS.some((p) => p.test(name))) flags.push('fileUpload');
    return flags;
}

function buildCandidate(
    ref: string,
    info: InteractiveRef,
    instructionTokens: Set<string>,
): ActionCandidate | null {
    const role = String(info.role || '');
    if (!role) return null;
    const name = String(info.name || '');
    const action = defaultActionForRole(role, name);
    const signals: string[] = [];
    let confidence = 0;

    if (CLICKABLE_ROLES.has(role)) {
        confidence += 0.35;
        signals.push(`role:${role}`);
    } else if (TYPABLE_ROLES.has(role)) {
        confidence += 0.3;
        signals.push(`role:${role}`);
    } else if (CHECKABLE_ROLES.has(role) || SELECTABLE_ROLES.has(role)) {
        confidence += 0.25;
        signals.push(`role:${role}`);
    } else if (READABLE_ROLES.has(role)) {
        confidence += 0.1;
        signals.push(`role:${role}(readable)`);
    } else {
        confidence += 0.15;
        signals.push(`role:${role}(generic)`);
    }

    if (name) {
        confidence += 0.15;
        signals.push('has-name');
    }

    const nameTokens = new Set(tokenize(name));
    if (instructionTokens.size > 0 && nameTokens.size > 0) {
        let overlap = 0;
        for (const t of instructionTokens) if (nameTokens.has(t)) overlap += 1;
        if (overlap > 0) {
            const ratio = overlap / instructionTokens.size;
            confidence += Math.min(0.45, ratio * 0.6);
            signals.push(`instruction-overlap:${overlap}/${instructionTokens.size}`);
        }
    }

    if (info.disabled) {
        confidence -= 0.4;
        signals.push('disabled');
    }
    if (info.readonly && action === 'type') {
        confidence -= 0.3;
        signals.push('readonly');
    }
    if (info.required) signals.push('required');

    confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(3))));

    const args: Record<string, string> = { snapshotId: '__SNAPSHOT_ID__', ref };
    let method: string;
    switch (action) {
        case 'click':
        case 'submit':
            method = 'browser_click_ref';
            break;
        case 'type':
            method = 'agbrowse type';
            break;
        case 'check':
            method = 'agbrowse check';
            break;
        case 'select':
            method = 'agbrowse select';
            break;
        case 'read':
        default:
            method = 'browser_snapshot (text from ref)';
            break;
    }

    const out: ActionCandidate = {
        ref,
        role,
        name,
        action,
        method,
        args,
        confidence,
        signals,
        riskFlags: riskFlagsFor(role, name),
    };
    if (typeof info.occurrenceIndex === 'number') out.occurrenceIndex = info.occurrenceIndex;
    return out;
}

export function buildObserveActions(
    snapshot: WebAiSnapshotLike,
    instruction = '',
    options: ObserveActionsOptions = {},
): ObserveActionsResult {
    const topN =
        typeof options.topN === 'number' && Number.isFinite(options.topN) && options.topN > 0
            ? options.topN
            : 8;
    const includeDisabled = options.includeDisabled === true;
    const instructionTokens = new Set(tokenize(instruction));
    const refs = (snapshot && snapshot.refs) || {};
    const candidates: ActionCandidate[] = [];
    for (const [ref, info] of Object.entries(refs)) {
        const cand = buildCandidate(ref, info || ({} as InteractiveRef), instructionTokens);
        if (!cand) continue;
        if (!includeDisabled && cand.signals.includes('disabled')) continue;
        candidates.push(cand);
    }
    candidates.sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return a.ref.localeCompare(b.ref, undefined, { numeric: true });
    });
    const top = candidates.slice(0, topN);
    const snapId = snapshot && snapshot['snapshotId'] ? snapshot['snapshotId'] : null;
    if (snapId) {
        for (const c of top) c.args['snapshotId'] = snapId;
    }
    return { snapshotId: snapId, instruction: String(instruction || ''), candidates: top };
}

export function formatObserveActions(result: ObserveActionsResult): string {
    if (!result.candidates.length) return 'observe-actions: no candidates from snapshot';
    const lines = [
        `observe-actions: ${result.candidates.length} candidate(s) for ${JSON.stringify(result.instruction)}`,
    ];
    for (const c of result.candidates) {
        const risk = c.riskFlags.length ? ` [${c.riskFlags.join(',')}]` : '';
        lines.push(
            `  ${c.ref}  conf=${c.confidence.toFixed(2)}  ${c.action}  role=${c.role}  name=${JSON.stringify(c.name)}${risk}`,
        );
    }
    return lines.join('\n');
}
