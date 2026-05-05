import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import type { Root, Text } from 'mdast';
import type { NoteLinkRef } from '../types.js';

const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml']);

type LineColumn = {
    line: number;
    column: number;
};

function lineStarts(source: string): number[] {
    const starts = [0];
    for (let index = 0; index < source.length; index++) {
        if (source[index] === '\n') starts.push(index + 1);
    }
    return starts;
}

function offsetToLineColumn(starts: number[], offset: number): LineColumn {
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const start = starts[mid] ?? 0;
        if (start <= offset) low = mid + 1;
        else high = mid - 1;
    }
    const lineIndex = Math.max(0, high);
    const start = starts[lineIndex] ?? 0;
    return {
        line: lineIndex + 1,
        column: offset - start + 1,
    };
}

function isEscaped(text: string, index: number): boolean {
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) {
        backslashes++;
    }
    return backslashes % 2 === 1;
}

function firstUnescaped(text: string, char: string): number {
    for (let index = 0; index < text.length; index++) {
        if (text[index] === char && !isEscaped(text, index)) return index;
    }
    return -1;
}

function parseInner(inner: string): { target: string; displayText?: string; heading?: string } {
    const pipe = firstUnescaped(inner, '|');
    const targetPart = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    const displayPart = pipe === -1 ? '' : inner.slice(pipe + 1).trim();
    const headingIndex = firstUnescaped(targetPart, '#');
    const target = (headingIndex === -1 ? targetPart : targetPart.slice(0, headingIndex)).trim();
    const heading = headingIndex === -1 ? '' : targetPart.slice(headingIndex + 1).trim();
    return {
        target,
        ...(displayPart ? { displayText: displayPart } : {}),
        ...(heading ? { heading } : {}),
    };
}

function scanTextNode(
    sourcePath: string,
    text: string,
    absoluteStart: number,
    starts: number[],
): NoteLinkRef[] {
    const refs: NoteLinkRef[] = [];
    let cursor = 0;
    while (cursor < text.length) {
        const open = text.indexOf('[[', cursor);
        if (open === -1) break;
        if (isEscaped(text, open)) {
            cursor = open + 2;
            continue;
        }
        const close = text.indexOf(']]', open + 2);
        if (close === -1) break;
        const startOffset = absoluteStart + open;
        const endOffset = absoluteStart + close + 2;
        const parsed = parseInner(text.slice(open + 2, close));
        const position = offsetToLineColumn(starts, startOffset);
        refs.push({
            sourcePath,
            raw: text.slice(open, close + 2),
            target: parsed.target,
            ...(parsed.displayText ? { displayText: parsed.displayText } : {}),
            ...(parsed.heading ? { heading: parsed.heading } : {}),
            line: position.line,
            column: position.column,
            startOffset,
            endOffset,
            status: 'missing',
            reason: 'not_found',
        });
        cursor = close + 2;
    }
    return refs;
}

export function extractWikiLinks(sourcePath: string, markdown: string): NoteLinkRef[] {
    const tree = markdownProcessor.parse(markdown) as Root;
    const starts = lineStarts(markdown);
    const refs: NoteLinkRef[] = [];
    visit(tree, 'text', (node: Text) => {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start === undefined || end === undefined) return;
        refs.push(...scanTextNode(sourcePath, markdown.slice(start, end), start, starts));
    });
    return refs;
}
