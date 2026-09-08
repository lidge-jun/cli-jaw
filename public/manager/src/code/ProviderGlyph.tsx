/**
 * Runtime glyphs for the composer's icon-only runtime trigger.
 *
 * These are decorative: the accessible name lives on the button that wraps
 * them, never in the SVG. Drawn locally rather than pulled from an icon set so
 * the four runtimes stay visually distinct at 16px without adding a dependency.
 */
import type { CodeProviderId } from '../../../../src/code-mode/wire';

const PATHS: Record<CodeProviderId, string> = {
    // Codex: terminal chevron + prompt rule.
    'codex-app': 'M4.2 5.6 8.1 9.5 4.2 13.4M9.4 13.6h5.4',
    // Claude: the radial burst, reduced to four strokes.
    claude: 'M10 3.4v5.2M10 11.4v5.2M3.4 10h5.2M11.4 10h5.2',
    // Cursor: a caret.
    cursor: 'M5.2 3.6 14.8 10l-4.3 1.4L8.9 16z',
    // Grok: crossed slashes.
    grok: 'M5 15 15 5M9.6 15 15 9.6M5 9.9 9.9 5',
};

const FILLED: ReadonlySet<CodeProviderId> = new Set(['cursor']);

export function ProviderGlyph({ provider }: { provider: CodeProviderId }) {
    const path = PATHS[provider];
    const filled = FILLED.has(provider);
    return <svg className="code-provider-glyph" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path d={path} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}

export function SendGlyph() {
    return <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M10 16V4.6M5.2 9.4 10 4.4l4.8 5" fill="none" stroke="currentColor"
            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}

export function StopGlyph() {
    return <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="6" y="6" width="8" height="8" rx="1.6" fill="currentColor" />
    </svg>;
}

export function MicGlyph({ muted }: { muted?: boolean }) {
    return <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M10 3.6a2 2 0 0 1 2 2v4.2a2 2 0 0 1-4 0V5.6a2 2 0 0 1 2-2ZM5.4 9.6a4.6 4.6 0 0 0 9.2 0M10 14.4V16.4"
            fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        {muted && <path d="M4.6 4.6 15.4 15.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>;
}

export function CheckGlyph() {
    return <svg className="code-footer-check" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="m4.8 10.4 3.3 3.3 7.1-7.4" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}
