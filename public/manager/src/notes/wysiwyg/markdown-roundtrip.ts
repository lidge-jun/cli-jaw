export type MarkdownRoundTripNormalizationPolicy = {
    normalizeLineEndings: true;
    stripBom: true;
    finalNewline: 'single';
    trimExtraTrailingBlankLines: true;
};

export const markdownRoundTripNormalizationPolicy: MarkdownRoundTripNormalizationPolicy = {
    normalizeLineEndings: true,
    stripBom: true,
    finalNewline: 'single',
    trimExtraTrailingBlankLines: true,
};

export function normalizeMarkdownForRoundTrip(markdown: string): string {
    const withoutBom = markdown.replace(/^\uFEFF/, '');
    const withLf = withoutBom.replace(/\r\n?/g, '\n');
    const trimmedTrailingBlankLines = withLf.replace(/\n*$/, '');
    if (trimmedTrailingBlankLines.length === 0) return '';
    return `${trimmedTrailingBlankLines}\n`;
}

export function markdownRoundTripEqual(actual: string, expected: string): boolean {
    return normalizeMarkdownForRoundTrip(actual) === normalizeMarkdownForRoundTrip(expected);
}

export function assertRoundTripEqual(actual: string, expected: string): void {
    if (!markdownRoundTripEqual(actual, expected)) {
        throw new Error('markdown round-trip output did not match expected fixture');
    }
}
