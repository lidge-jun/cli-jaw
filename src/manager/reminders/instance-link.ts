export type ReminderInstanceLinkInput = {
    instanceId: string;
    messageId: string;
    turnIndex?: number | null;
    port?: number | null;
    threadKey?: string | null;
    sourceText?: string | null;
};

export type ReminderInstanceLink = {
    instanceId: string;
    messageId: string;
    turnIndex: number | null;
    port: number | null;
    threadKey: string | null;
    sourceText: string | null;
};

function optionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text : null;
}

export function parseReminderInstanceLink(input: ReminderInstanceLinkInput): ReminderInstanceLink {
    const instanceId = String(input.instanceId || '').trim();
    const messageId = String(input.messageId || '').trim();
    if (!instanceId) throw new Error('instanceId required');
    if (!messageId) throw new Error('messageId required');
    const turnIndex = input.turnIndex ?? null;
    if (turnIndex !== null && (!Number.isInteger(turnIndex) || turnIndex < 0)) throw new Error('turnIndex must be a non-negative integer');
    const port = input.port ?? null;
    if (port !== null && (!Number.isInteger(port) || port < 1)) throw new Error('port must be a positive integer');
    return { instanceId, messageId, turnIndex, port, threadKey: optionalString(input.threadKey), sourceText: optionalString(input.sourceText) };
}
