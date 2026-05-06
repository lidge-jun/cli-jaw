/**
 * G03 — action breadth catalog (TS port).
 * Mirrors agbrowse `web-ai/action-breadth.mjs`.
 *
 * No hosted/cloud, no stealth, no CAPTCHA bypass, no external CDP.
 */

export interface BrowserPrimitive {
    command: string;
    category: string;
    description: string;
    args: string[];
    flags?: string[];
    requiresRef?: string;
}

export const BROWSER_PRIMITIVES: readonly BrowserPrimitive[] = Object.freeze([
    { command: 'click', category: 'interact', description: 'click an element by ref', args: ['ref'], flags: ['--json'], requiresRef: 'yes' },
    { command: 'type', category: 'interact', description: 'type text into a focused element', args: ['ref', 'text'], flags: ['--json'], requiresRef: 'yes' },
    { command: 'press', category: 'interact', description: 'press a keyboard key on the focused element', args: ['key'] },
    { command: 'hover', category: 'interact', description: 'hover the pointer over an element ref', args: ['ref'], requiresRef: 'yes' },
    { command: 'select', category: 'form', description: 'select an option in a <select> element', args: ['ref', 'value'], flags: ['--json'], requiresRef: 'yes' },
    { command: 'check', category: 'form', description: 'set a checkbox or radio to checked', args: ['ref'], flags: ['--json'], requiresRef: 'yes' },
    { command: 'uncheck', category: 'form', description: 'set a checkbox to unchecked', args: ['ref'], flags: ['--json'], requiresRef: 'yes' },
    { command: 'upload', category: 'form', description: 'set files on a file input', args: ['ref', 'file...'], flags: ['--json'], requiresRef: 'yes' },
    { command: 'drag', category: 'pointer', description: 'drag from one ref onto another', args: ['fromRef', 'toRef'] },
    { command: 'mouse-click', category: 'pointer', description: 'click at coordinates (canvas/no-ref targets)', args: ['x', 'y'] },
    { command: 'move-mouse', category: 'pointer', description: 'move pointer to coordinates', args: ['x', 'y'] },
    { command: 'scroll', category: 'navigation', description: 'scroll the page or a scrollable container', args: ['direction|target'] },
    { command: 'wait-for', category: 'wait', description: 'wait for a condition (selector, text, network)', args: ['target'] },
    { command: 'wait-for-selector', category: 'wait', description: 'wait until a CSS selector resolves visibly', args: ['selector'] },
    { command: 'wait-for-text', category: 'wait', description: 'wait until text appears on the page', args: ['text'] },
    { command: 'wait', category: 'wait', description: 'wait a fixed duration in ms', args: ['ms'] },
    { command: 'navigate', category: 'navigation', description: 'navigate the active tab to a URL', args: ['url'] },
    { command: 'reload', category: 'navigation', description: 'reload the active tab', args: [] },
    { command: 'screenshot', category: 'capture', description: 'capture a screenshot of the active page', args: [] },
    { command: 'snapshot', category: 'capture', description: 'capture an interactive accessibility snapshot', args: [] },
    { command: 'evaluate', category: 'capture', description: 'evaluate JavaScript in the page (read-only context)', args: ['expr'] },
    { command: 'text', category: 'capture', description: 'extract text content of an element or the page', args: ['ref?'] },
] as const);

export function listPrimitiveCommands(): string[] {
    return BROWSER_PRIMITIVES.map((p) => p.command);
}

export function primitivesByCategory(): Record<string, BrowserPrimitive[]> {
    const out: Record<string, BrowserPrimitive[]> = {};
    for (const p of BROWSER_PRIMITIVES) {
        const group = out[p.category] ?? [];
        group.push(p);
        out[p.category] = group;
    }
    return out;
}

export interface PrimitiveCoverageReport {
    ok: boolean;
    found: string[];
    missing: string[];
    total: number;
}

export function auditPrimitiveCoverage(source: string): PrimitiveCoverageReport {
    const found: string[] = [];
    const missing: string[] = [];
    for (const p of BROWSER_PRIMITIVES) {
        const re = new RegExp(`case ['"]${p.command}['"]\\s*:`);
        if (re.test(source)) found.push(p.command);
        else missing.push(p.command);
    }
    return { ok: missing.length === 0, found, missing, total: BROWSER_PRIMITIVES.length };
}

export const BROWSER_PRIMITIVE_SCHEMA_VERSION = 'browser-primitives-v1' as const;
