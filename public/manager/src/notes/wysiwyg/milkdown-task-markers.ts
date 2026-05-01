const escapedTaskMarkerPattern = /^([ \t]*[-*+][ \t]+)\\?\[([ xX])\\?\]([ \t]*)/gm;

export function normalizeEscapedTaskMarkers(markdown: string): string {
    // Keep typed task markers canonical after Milkdown escapes literal brackets.
    return markdown.replace(escapedTaskMarkerPattern, '$1[$2]$3');
}
