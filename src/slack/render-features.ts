import { marked, type Tokens } from 'marked';

const LANGUAGES: Record<string, string> = { python: 'python', py: 'python', javascript: 'javascript', js: 'javascript', typescript: 'typescript', ts: 'typescript', json: 'json' };

/** Semantic features that can be checked in persisted Slack blocks. Table
 * cells retain their separate table contract; do not let their styles satisfy
 * an unrelated prose feature elsewhere in the message. */
export function storedRichFeatures(blocks: unknown): string[] {
    const found = new Set<string>();
    const pending: unknown[] = Array.isArray(blocks) ? [...blocks] : [];
    while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object') continue;
        const node = value as Record<string, unknown>;
        if (node['type'] === 'table') continue;
        const type = node['type'];
        if (type === 'header') found.add('heading');
        if (type === 'divider') found.add('divider');
        if (type === 'image') found.add('image');
        if (type === 'link') found.add('link');
        if (type === 'rich_text_quote') found.add('quote');
        if (type === 'rich_text_preformatted') {
            found.add('code');
            const language = LANGUAGES[String(node['language']).toLowerCase()];
            if (language) found.add(`language:${language}`);
        }
        if (type === 'rich_text_list') {
            found.add(node['style'] === 'ordered' ? 'ordered_list' : 'bullet_list');
            if (Number(node['indent']) > 0) found.add('nested_list');
            if (node['checklist']) found.add('checklist');
        }
        if (typeof node['checked'] === 'boolean') found.add(node['checked'] ? 'checked' : 'unchecked');
        if (node['style'] && typeof node['style'] === 'object') {
            const style = node['style'] as Record<string, unknown>;
            for (const key of ['bold', 'italic', 'strike']) if (style[key]) found.add(key);
            if (style['code']) found.add('inline_code');
        }
        for (const key of ['elements', 'blocks']) if (Array.isArray(node[key])) pending.push(...node[key]);
    }
    return [...found].sort();
}

export function expectedRichFeatures(blocks: unknown): string[] {
    const found = new Set(storedRichFeatures(blocks));
    if (!Array.isArray(blocks)) return [...found];
    for (const block of blocks) {
        if (block?.type !== 'markdown' || typeof block.text !== 'string') continue;
        const tokens = marked.lexer(block.text, { gfm: true });
        for (const root of tokens) {
            if (root.type === 'table') continue;
            marked.walkTokens([root], token => {
                const map: Record<string, string> = { heading: 'heading', hr: 'divider', strong: 'bold', em: 'italic', del: 'strike', codespan: 'inline_code', link: 'link', image: 'link', blockquote: 'quote', code: 'code' };
                const feature = map[token.type];
                if (feature) found.add(feature);
                if (token.type === 'code') {
                    const language = LANGUAGES[((token as Tokens.Code).lang ?? '').split(/\s+/)[0]!.toLowerCase()];
                    if (language) found.add(`language:${language}`);
                }
                if (token.type === 'list') {
                    const list = token as Tokens.List;
                    found.add(list.ordered ? 'ordered_list' : 'bullet_list');
                    for (const item of list.items) {
                        if (item.task) { found.add('checklist'); found.add(item.checked ? 'checked' : 'unchecked'); }
                        if (item.tokens.some(t => t.type === 'list')) found.add('nested_list');
                    }
                }
            });
        }
    }
    return [...found].sort();
}
