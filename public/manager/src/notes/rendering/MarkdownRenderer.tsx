import { createElement, isValidElement, useMemo } from 'react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { CodeBlock } from './CodeBlock';
import { MermaidBlock } from './MermaidBlock';
import {
    isSafeExternalHref,
    markdownSanitizeSchema,
    notesImageSrc,
    safeMarkdownUrl,
} from './markdown-render-security';
import { buildWikiLinkLookup, splitChildrenWithWikiLinks, type WikiLinkContext } from '../wiki-link-rendering';
import type { NotesNoteLinkRef, NotesNoteMetadata } from '../notes-types';

type MarkdownRendererProps = {
    markdown: string;
    outgoing?: NotesNoteLinkRef[] | undefined;
    notes?: readonly NotesNoteMetadata[] | undefined;
    onWikiLinkNavigate?: ((path: string) => void) | undefined;
};

type MarkdownAnchorProps = ComponentProps<'a'> & {
    node?: unknown;
};

type WikiContainerTag =
    | 'p'
    | 'li'
    | 'h1'
    | 'h2'
    | 'h3'
    | 'h4'
    | 'h5'
    | 'h6'
    | 'blockquote'
    | 'td'
    | 'th'
    | 'em'
    | 'strong'
    | 'del';

type WikiContainerProps = {
    children?: ReactNode;
    className?: string | undefined;
    id?: string | undefined;
    style?: CSSProperties | undefined;
    node?: unknown;
};

function textFromNode(node: ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textFromNode).join('');
    if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
    return '';
}

function languageFromCodeNode(node: ReactNode): string {
    if (!isValidElement<{ className?: string }>(node)) return 'text';
    const className = node.props.className ?? '';
    const match = className.match(/language-([^\s]+)/);
    return match?.[1] ?? 'text';
}

const NOOP_NAVIGATE = (_path: string): void => {};

export function MarkdownRenderer(props: MarkdownRendererProps) {
    const wikiCtx = useMemo<WikiLinkContext>(() => ({
        lookup: buildWikiLinkLookup(props.outgoing),
        outgoing: props.outgoing,
        notes: props.notes,
        onNavigate: props.onWikiLinkNavigate ?? NOOP_NAVIGATE,
    }), [props.outgoing, props.notes, props.onWikiLinkNavigate]);

    const wikiTransform = (tag: WikiContainerTag) => (containerProps: WikiContainerProps) => {
        const { children, node: _node, className, id, style } = containerProps;
        const transformed = splitChildrenWithWikiLinks(children, wikiCtx, tag);
        return createElement(tag, { className, id, style }, transformed);
    };

    return (
        <ReactMarkdown
            skipHtml
            urlTransform={safeMarkdownUrl}
            remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
            rehypePlugins={[
                [rehypeSanitize, markdownSanitizeSchema],
                rehypeKatex,
            ]}
            components={{
                a: ({ href, children, node: _node, ...anchorProps }: MarkdownAnchorProps) => {
                    const safeHref = typeof href === 'string' && isSafeExternalHref(href) ? href : undefined;
                    const external = Boolean(safeHref && /^https?:\/\//i.test(safeHref));
                    return (
                        <a
                            {...anchorProps}
                            href={safeHref}
                            target={external ? '_blank' : undefined}
                            rel={external ? 'noreferrer noopener' : undefined}
                        >
                            {children}
                        </a>
                    );
                },
                code: ({ className, children }: ComponentProps<'code'>) => (
                    <code className={className}>{children}</code>
                ),
                pre: ({ children }) => {
                    const language = languageFromCodeNode(children);
                    const code = textFromNode(children).replace(/\n$/, '');
                    if (language === 'mermaid') return <MermaidBlock code={code} />;
                    return <CodeBlock code={code} language={language} />;
                },
                img: ({ src, alt, ...imageProps }: ComponentProps<'img'>) => {
                    const safeSrc = typeof src === 'string' ? notesImageSrc(src) : '';
                    if (!safeSrc) return null;
                    return <img {...imageProps} src={safeSrc} alt={alt ?? ''} loading="lazy" />;
                },
                p: wikiTransform('p'),
                li: wikiTransform('li'),
                h1: wikiTransform('h1'),
                h2: wikiTransform('h2'),
                h3: wikiTransform('h3'),
                h4: wikiTransform('h4'),
                h5: wikiTransform('h5'),
                h6: wikiTransform('h6'),
                blockquote: wikiTransform('blockquote'),
                td: wikiTransform('td'),
                th: wikiTransform('th'),
                em: wikiTransform('em'),
                strong: wikiTransform('strong'),
                del: wikiTransform('del'),
            }}
        >
            {props.markdown}
        </ReactMarkdown>
    );
}
