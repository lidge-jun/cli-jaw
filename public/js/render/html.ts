// ── HTML and orchestration helpers ──
export function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Orchestration JSON stripping ──
// Only strip JSON blocks that contain orchestration-specific keys, not all JSON blocks
// Require keys unique to orchestration payloads (avoid generic words like "phase")
const ORCH_KEYS = /["'](?:subtasks|employee_config|agent_phases|orchestration_plan)["']\s*:/;
const PROMPT_LEAK_START = /(^|\n)(?:## Approved Plan \((?:authoritative|auto-injected by orchestrator)[^\n]*\)|\[PABCD — [A-Z]:[^\n]*\]|\[PLANNING MODE[^\n]*\]|\[PLAN AUDIT[^\n]*\]|The approved plan is already injected above)/m;

export function stripPromptLeakage(text: string): string {
    const match = PROMPT_LEAK_START.exec(text);
    if (!match || match.index < 0) return text;
    return text.slice(0, match.index).trim();
}

export function stripOrchestration(text: string): string {
    // Strip fenced JSON blocks only if they contain orchestration keys
    let cleaned = text.replace(/```json\n([\s\S]*?)\n```/g, (_match, inner) =>
        ORCH_KEYS.test(inner) ? '' : _match);
    // Strip inline orchestration objects containing subtasks array
    cleaned = cleaned.replace(/\{[^{}]*"subtasks"\s*:\s*\[[\s\S]*?\]\s*\}/g, '').trim();
    return stripPromptLeakage(cleaned);
}
