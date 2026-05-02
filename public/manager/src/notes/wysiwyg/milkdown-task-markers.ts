const escapedTaskMarkerPattern = /^([ \t]*[-*+][ \t]+)\\?\[([ xX])\\?\]([ \t]*)/gm;
const canonicalTaskMarkerPattern = /^([ \t]*[-*+][ \t]+)\[([ xX])\]([ \t]*)/gm;
const footnoteDefinitionPattern = /^([ \t]*)\[\^([^\]\n]+)\]:/gm;
const escapedFootnoteDefinitionPattern = /^([ \t]*)\\\[\^([^\]\n]+)\]:/gm;
const footnoteReferencePattern = /(^|[^\]\\])\[\^([^\]\n]+)\]/g;
const escapedFootnoteReferencePattern = /(^|[^\\])\\\[\^([^\]\n]+)\]/g;

export function protectUnsupportedGfmForMilkdown(markdown: string): string {
    return markdown
        .replace(canonicalTaskMarkerPattern, '$1\\[$2\\]$3')
        .replace(footnoteDefinitionPattern, '$1\\[^$2]:')
        .replace(footnoteReferencePattern, '$1\\[^$2]');
}

export function normalizeEscapedTaskMarkers(markdown: string): string {
    // Keep protected task and footnote markers canonical after Milkdown edits.
    return markdown
        .replace(escapedTaskMarkerPattern, '$1[$2]$3')
        .replace(escapedFootnoteDefinitionPattern, '$1[^$2]:')
        .replace(escapedFootnoteReferencePattern, '$1[^$2]');
}
