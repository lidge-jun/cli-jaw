export interface LongRunningToolTimeout {
    timeoutMs: number;
    commandKind: string;
}

const WEB_AI_COMMAND_PATTERN =
    /(?:^|[\s'"();|&])((?:(?:\S+\/)?agbrowse\s+web-ai|(?:\S+\/)?(?:cli-jaw|jaw)\s+browser\s+web-ai)\s+(query|poll))\b/i;

const TIMEOUT_PATTERN = /--timeout(?:=|\s+)(\d+(?:\.\d+)?)(ms|s|m)?\b/i;

export function detectLongRunningToolTimeout(command: string): LongRunningToolTimeout | null {
    const webAiMatch = WEB_AI_COMMAND_PATTERN.exec(command);
    if (!webAiMatch || webAiMatch.index < 0) return null;
    const commandKind = webAiMatch[1];
    if (!commandKind) return null;

    const searchFrom = command.slice(webAiMatch.index);
    const timeoutMatch = TIMEOUT_PATTERN.exec(searchFrom);
    if (!timeoutMatch) return null;

    const rawValue = Number(timeoutMatch[1]);
    if (!Number.isFinite(rawValue) || rawValue <= 0) return null;

    const unit = (timeoutMatch[2] || 's').toLowerCase();
    const multiplier = unit === 'ms' ? 1 : unit === 'm' ? 60_000 : 1_000;
    const timeoutMs = Math.round(rawValue * multiplier);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;

    return {
        timeoutMs,
        commandKind: commandKind.replace(/\s+/g, ' '),
    };
}
