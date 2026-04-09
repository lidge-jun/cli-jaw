// ─── Smoke Response Detector ─────────────────────────
// Detects when a CLI outputs an intermediate "I'll spawn a subagent" message
// instead of completing actual work. Used by auto-continuation (spawn.ts).

const SMOKE_PATTERNS: RegExp[] = [
    // English patterns
    /\b(?:spawn|launch|dispatch|delegate|start)\w*\s+(?:a\s+)?(?:sub-?\s*agent|agent|background\s+agent)/i,
    /\b(?:wait|waiting)\s+(?:for|on)\s+(?:the\s+)?(?:sub-?\s*agent|agent|response|result|completion)/i,
    /\bI'?ll\s+continue\s+(?:once|when|after)\s+(?:the\s+)?(?:sub-?\s*agent|agent|response|result)/i,
    /\b(?:sub-?\s*agent|agent)\s+(?:has been|is being)\s+(?:spawn|launch|dispatch|start)/i,
    /\bcontinue\s+(?:processing|working|with)\s+(?:once|when|after)\s+(?:it|the agent|the sub-?\s*agent)\s+(?:respond|return|finish|complete)/i,

    // Korean patterns
    /서브\s*에이전트.*(?:호출|실행|보내|생성)/,
    /에이전트.*(?:응답|완료).*(?:기다|대기|계속)/,
    /(?:응답|결과).*(?:돌아오면|받으면).*계속/,
];

const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 2000;

export interface SmokeDetectionResult {
    isSmoke: boolean;
    confidence: 'high' | 'medium' | 'low';
    matchedPattern: string | null;
    reason: string;
}

/**
 * Detect if the CLI output is a smoke response (subagent spawn intention, no real work).
 */
export function detectSmokeResponse(
    text: string,
    toolLog: any[],
    exitCode: number | null,
    cli: string,
): SmokeDetectionResult {
    const trimmed = (text || '').trim();

    if (!trimmed || trimmed.length < MIN_TEXT_LENGTH) {
        return { isSmoke: false, confidence: 'low', matchedPattern: null, reason: 'text too short' };
    }

    if (trimmed.length > MAX_TEXT_LENGTH) {
        return { isSmoke: false, confidence: 'low', matchedPattern: null, reason: 'text too long for smoke' };
    }

    if (exitCode !== 0 && exitCode !== null) {
        return { isSmoke: false, confidence: 'low', matchedPattern: null, reason: 'non-zero exit' };
    }

    let matchedPattern: string | null = null;
    for (const pattern of SMOKE_PATTERNS) {
        if (pattern.test(trimmed)) {
            matchedPattern = pattern.source;
            break;
        }
    }

    if (!matchedPattern) {
        return { isSmoke: false, confidence: 'low', matchedPattern: null, reason: 'no pattern match' };
    }

    // "Real activity" = tool types representing actual work:
    //   'tool' (file edits, bash commands), 'search' (web_search, codebase_search)
    // Excluded: 'thinking' (reasoning only, no side effects)
    const ACTIVITY_TYPES = new Set(['tool', 'search']);
    const hasRealActivity = toolLog.some(t => ACTIVITY_TYPES.has(t.toolType));
    const hasThinkingOnly = toolLog.length > 0 && toolLog.every(t => t.toolType === 'thinking');

    // Medium confidence: thinking-only — checked FIRST (weaker signal)
    if (hasThinkingOnly) {
        return {
            isSmoke: true,
            confidence: 'medium',
            matchedPattern,
            reason: `pattern matched, thinking only — no tool execution (cli=${cli})`,
        };
    }

    // High confidence: zero real activity
    if (!hasRealActivity) {
        return {
            isSmoke: true,
            confidence: 'high',
            matchedPattern,
            reason: `pattern matched, zero real activity (cli=${cli})`,
        };
    }

    // Low confidence: real work was done — likely partial
    return {
        isSmoke: false,
        confidence: 'low',
        matchedPattern,
        reason: `pattern matched but real activity present — likely partial work (cli=${cli})`,
    };
}

/**
 * Build a continuation prompt for re-invocation after smoke detection.
 */
export function buildContinuationPrompt(
    originalPrompt: string,
    smokeText: string,
): string {
    return `## Previous Attempt Failed — Complete the Work Directly

Your previous response was:
> ${smokeText.slice(0, 500)}

This was incomplete — you stated an intention to delegate to a subagent,
but that mechanism is not available in this environment.

**Do the work yourself. Do NOT delegate or spawn agents.**

## Original Task (complete this now)
${originalPrompt}

## Instructions
1. Read the relevant files directly
2. Make the changes yourself
3. Run any necessary commands
4. Provide the complete result

Do NOT mention spawning agents or delegating. Just do it.`;
}

/**
 * Codex-specific: check if NDJSON events indicate a smoke turn.
 * A smoke turn = only agent_message items, no command_execution items.
 */
export function isCodexSmokeTurn(events: Array<{ type: string; item?: any }>): boolean {
    const completed = events.filter(e => e.type === 'item.completed');
    if (completed.length === 0) return false;

    const hasCommand = completed.some(e => e.item?.type === 'command_execution');
    const hasMessage = completed.some(e => e.item?.type === 'agent_message');

    return hasMessage && !hasCommand;
}
