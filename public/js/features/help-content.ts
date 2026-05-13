// Contextual help topic registry. Keep this module data-only so tests can import it safely.

export type HelpTopicId =
    | 'activeCli'
    | 'model'
    | 'effort'
    | 'permissions'
    | 'flushAgent'
    | 'employees'
    | 'skills'
    | 'activeChannel'
    | 'telegram'
    | 'discord'
    | 'fallbackOrder'
    | 'mcp'
    | 'memory'
    | 'stt'
    | 'promptTemplates'
    | 'chatInput'
    | 'orchestration'
    | 'attachments'
    | 'diagrams'
    | 'keyboardShortcuts';

export interface HelpTopic {
    titleKey: string;
    introKey: string;
    effectKey: string;
    useWhenKeys: string[];
    howToKeys: string[];
    exampleKeys: string[];
    avoidWhenKeys?: string[];
    relatedKeys?: string[];
}

export const HELP_TOPICS: Record<HelpTopicId, HelpTopic> = {
    activeCli: topic('activeCli', 2, 1, 2),
    model: topic('model', 2, 1, 1),
    effort: topic('effort', 2, 1, 1),
    permissions: topic('permissions', 2, 1, 1),
    flushAgent: topic('flushAgent', 2, 1, 1),
    employees: topic('employees', 3, 3, 2),
    skills: topic('skills', 2, 1, 1),
    activeChannel: topic('activeChannel', 2, 1, 1),
    telegram: topic('telegram', 2, 1, 2),
    discord: topic('discord', 2, 1, 2),
    fallbackOrder: topic('fallbackOrder', 2, 1, 1),
    mcp: topic('mcp', 2, 1, 1),
    memory: topic('memory', 2, 1, 2),
    stt: topic('stt', 2, 1, 1),
    promptTemplates: topic('promptTemplates', 2, 1, 1),
    chatInput: topic('chatInput', 3, 2, 2),
    orchestration: topic('orchestration', 3, 2, 2),
    attachments: topic('attachments', 3, 2, 2),
    diagrams: topic('diagrams', 3, 2, 2),
    keyboardShortcuts: topic('keyboardShortcuts', 3, 2, 2, 3, 2),
};

export function isHelpTopicId(value: string | null | undefined): value is HelpTopicId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HELP_TOPICS, value);
}

function topic(
    id: HelpTopicId,
    useCount: number,
    avoidCount: number,
    relatedCount: number,
    howToCount = 2,
    exampleCount = 1,
): HelpTopic {
    return {
        titleKey: `help.${id}.title`,
        introKey: `help.${id}.intro`,
        effectKey: `help.${id}.effect`,
        useWhenKeys: rangeKeys(`help.${id}.use`, useCount),
        howToKeys: rangeKeys(`help.${id}.howTo`, howToCount),
        exampleKeys: rangeKeys(`help.${id}.example`, exampleCount),
        avoidWhenKeys: rangeKeys(`help.${id}.avoid`, avoidCount),
        relatedKeys: rangeKeys(`help.${id}.related`, relatedCount),
    };
}

function rangeKeys(prefix: string, count: number): string[] {
    return Array.from({ length: count }, (_, i) => `${prefix}.${i + 1}`);
}
