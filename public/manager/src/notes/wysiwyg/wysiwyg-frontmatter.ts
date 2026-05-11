import { isMap, parseDocument } from 'yaml';

export type WysiwygFrontmatterData = {
    aliases: string[];
    tags: string[];
    created: string | null;
    raw: string;
    error: string | null;
    editable: boolean;
    document: ReturnType<typeof parseDocument> | null;
};

export type WysiwygFrontmatterDocument = {
    frontmatter: WysiwygFrontmatterData | null;
    body: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function dedupeStable(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}

export function normalizeWysiwygMetadataList(
    value: unknown,
    options: { splitString?: boolean; stripHash?: boolean } = {},
): string[] {
    const normalize = (item: string): string => {
        const trimmed = item.trim();
        return options.stripHash && trimmed.startsWith('#') ? trimmed.slice(1).trim() : trimmed;
    };
    if (typeof value === 'string') {
        const parts = options.splitString ? value.split(/\s+/u) : [value];
        return dedupeStable(parts.map(normalize).filter(Boolean));
    }
    if (!Array.isArray(value)) return [];
    return dedupeStable(value.filter((item): item is string => typeof item === 'string').map(normalize).filter(Boolean));
}

function mapValue(document: ReturnType<typeof parseDocument>, key: string): unknown {
    if (!isMap(document.contents)) return undefined;
    return document.get(key);
}

function nonEditableFrontmatter(raw: string, body: string, error: string): WysiwygFrontmatterDocument {
    return {
        frontmatter: {
            raw,
            aliases: [],
            tags: [],
            created: null,
            error,
            editable: false,
            document: null,
        },
        body,
    };
}

export function splitWysiwygFrontmatter(markdown: string): WysiwygFrontmatterDocument {
    const match = markdown.match(FRONTMATTER_RE);
    if (!match) return { frontmatter: null, body: markdown };
    const raw = match[0];
    const body = markdown.slice(raw.length);
    const source = match[1] ?? '';
    try {
        const document = parseDocument(source);
        if (document.errors.length > 0) {
            return nonEditableFrontmatter(raw, body, document.errors[0]?.message ?? 'Invalid frontmatter');
        }
        if (!isMap(document.contents)) {
            return nonEditableFrontmatter(raw, body, 'Frontmatter must be a YAML mapping to edit here');
        }
        return {
            frontmatter: {
                raw,
                aliases: dedupeStable([
                    ...normalizeWysiwygMetadataList(mapValue(document, 'aliases')),
                    ...normalizeWysiwygMetadataList(mapValue(document, 'alias')),
                ]),
                tags: normalizeWysiwygMetadataList(mapValue(document, 'tags'), { splitString: true, stripHash: true }),
                created: typeof mapValue(document, 'created') === 'string'
                    ? String(mapValue(document, 'created')).trim() || null
                    : null,
                error: null,
                editable: true,
                document,
            },
            body,
        };
    } catch (error) {
        return nonEditableFrontmatter(raw, body, error instanceof Error ? error.message : 'Invalid frontmatter');
    }
}

export function composeWysiwygFrontmatter(frontmatter: WysiwygFrontmatterData | null, body: string): string {
    if (!frontmatter) return body;
    return `${frontmatter.raw}${body}`;
}

export function createEmptyWysiwygFrontmatter(): WysiwygFrontmatterData {
    const raw = '---\naliases: []\ntags: []\n---\n';
    const document = parseDocument('aliases: []\ntags: []\n');
    return {
        aliases: [],
        tags: [],
        created: null,
        raw,
        error: null,
        editable: true,
        document,
    };
}

export function updateWysiwygFrontmatter(
    current: WysiwygFrontmatterData | null,
    patch: Partial<Pick<WysiwygFrontmatterData, 'aliases' | 'tags' | 'created'>>,
): WysiwygFrontmatterData | null {
    if (!current || current.error || !current.editable || !current.document || !isMap(current.document.contents)) return current;
    const document = current.document.clone();
    const next = {
        aliases: patch.aliases ?? current.aliases,
        tags: patch.tags ?? current.tags,
        created: patch.created ?? current.created,
    };
    if (next.aliases.length > 0) document.set('aliases', next.aliases);
    else document.delete('aliases');
    document.delete('alias');
    if (next.tags.length > 0) document.set('tags', next.tags);
    else document.delete('tags');
    if (next.created) document.set('created', next.created);
    else document.delete('created');
    return {
        ...current,
        ...next,
        document,
        raw: `---\n${document.toString().trimEnd()}\n---\n`,
    };
}
