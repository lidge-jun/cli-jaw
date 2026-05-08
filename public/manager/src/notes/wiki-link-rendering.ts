import { Children, createElement, isValidElement, type MouseEvent, type ReactNode } from 'react';
import type { NotesNoteLinkRef } from './notes-types';

export const WIKI_LINK_RE = /\[\[([^\[\]\n]+)\]\]/g;
const WIKI_LINK_TOKEN_RE = /^\[\[([^\[\]\n]+)\]\]$/;

export type ParsedWikiLinkToken = {
    raw: string;
    inner: string;
    target: string;
    heading: string | null;
    displayText: string | null;
};

export function parseWikiLinkToken(raw: string): ParsedWikiLinkToken | null {
    const match = raw.match(WIKI_LINK_TOKEN_RE);
    if (!match) return null;
    const inner = match[1]?.trim() ?? '';
    if (!inner) return null;
    const [targetPart, displayPart] = inner.split('|', 2);
    const [target, heading] = (targetPart ?? '').split('#', 2);
    const normalizedTarget = target?.trim() ?? '';
    if (!normalizedTarget) return null;
    return {
        raw,
        inner,
        target: normalizedTarget,
        heading: heading?.trim() || null,
        displayText: displayPart?.trim() || null,
    };
}

export function buildWikiLinkLookup(outgoing: NotesNoteLinkRef[] | undefined | null): Map<string, NotesNoteLinkRef> {
    const map = new Map<string, NotesNoteLinkRef>();
    if (!outgoing) return map;
    for (const link of outgoing) {
        if (!map.has(link.raw)) map.set(link.raw, link);
    }
    return map;
}

export function wikiLinkDisplayText(link: NotesNoteLinkRef, raw: string): string {
    const parsed = parseWikiLinkToken(raw);
    return link.displayText || parsed?.displayText || parsed?.inner || link.target || raw;
}

export function wikiLinkReasonLabel(link: NotesNoteLinkRef): string {
    if (link.reason === 'ambiguous') return 'Ambiguous link target';
    if (link.reason === 'invalid_target') return 'Invalid link target';
    return 'No matching note';
}

export type WikiLinkContext = {
    lookup: Map<string, NotesNoteLinkRef>;
    onNavigate: (path: string) => void;
};

function transformString(text: string, ctx: WikiLinkContext, keyPrefix: string): ReactNode[] {
    if (!text || ctx.lookup.size === 0) return [text];
    WIKI_LINK_RE.lastIndex = 0;
    const result: ReactNode[] = [];
    let cursor = 0;
    let index = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKI_LINK_RE.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const link = ctx.lookup.get(match[0]);
        if (!link) continue;
        if (start > cursor) result.push(text.slice(cursor, start));
        const display = wikiLinkDisplayText(link, match[0]);
        const key = `${keyPrefix}-wl-${index++}`;
        if (link.status === 'resolved' && link.resolvedPath) {
            const target = link.resolvedPath;
            result.push(
                createElement(
                    'a',
                    {
                        key,
                        className: 'notes-wikilink',
                        href: `#${encodeURIComponent(target)}`,
                        title: target,
                        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
                            event.preventDefault();
                            ctx.onNavigate(target);
                        },
                    },
                    display,
                ),
            );
        } else {
            const reasonLabel = wikiLinkReasonLabel(link);
            result.push(
                createElement(
                    'span',
                    {
                        key,
                        className: 'notes-wikilink is-broken',
                        title: reasonLabel,
                        'aria-label': `Broken wikilink: ${match[1]}`,
                    },
                    display,
                ),
            );
        }
        cursor = end;
    }
    if (cursor === 0) return [text];
    if (cursor < text.length) result.push(text.slice(cursor));
    return result;
}

export function splitTextWithWikiLinks(
    text: string,
    lookup: Map<string, NotesNoteLinkRef>,
    onNavigate: (path: string) => void,
): ReactNode[] {
    return transformString(text, { lookup, onNavigate }, 'text');
}

export function splitChildrenWithWikiLinks(children: ReactNode, ctx: WikiLinkContext, keyPrefix: string): ReactNode {
    if (ctx.lookup.size === 0) return children;
    const out: ReactNode[] = [];
    let stringIndex = 0;
    Children.forEach(children, (child, i) => {
        if (typeof child === 'string') {
            const segments = transformString(child, ctx, `${keyPrefix}-${stringIndex++}-${i}`);
            for (const seg of segments) out.push(seg);
            return;
        }
        if (typeof child === 'number' || typeof child === 'boolean' || child === null || child === undefined) {
            out.push(child);
            return;
        }
        if (isValidElement(child)) {
            out.push(child);
            return;
        }
        out.push(child);
    });
    return out;
}
