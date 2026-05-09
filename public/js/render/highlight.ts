// ── Highlight.js language registry and helpers ──
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';
import { escapeHtml } from './html.js';

let highlightLanguagesReady = false;

export function ensureHighlightLanguages(): void {
    if (highlightLanguagesReady) return;
    highlightLanguagesReady = true;
    hljs.registerLanguage('javascript', javascript);
    hljs.registerLanguage('js', javascript);
    hljs.registerLanguage('typescript', typescript);
    hljs.registerLanguage('ts', typescript);
    hljs.registerLanguage('python', python);
    hljs.registerLanguage('py', python);
    hljs.registerLanguage('bash', bash);
    hljs.registerLanguage('shell', shell);
    hljs.registerLanguage('sh', shell);
    hljs.registerLanguage('json', json);
    hljs.registerLanguage('css', css);
    hljs.registerLanguage('xml', xml);
    hljs.registerLanguage('html', xml);
    hljs.registerLanguage('markdown', markdown);
    hljs.registerLanguage('md', markdown);
    hljs.registerLanguage('yaml', yaml);
    hljs.registerLanguage('yml', yaml);
    hljs.registerLanguage('sql', sql);
    hljs.registerLanguage('rust', rust);
    hljs.registerLanguage('rs', rust);
    hljs.registerLanguage('go', go);
    hljs.registerLanguage('java', java);
    hljs.registerLanguage('cpp', cpp);
    hljs.registerLanguage('c', cpp);
    hljs.registerLanguage('diff', diff);
    hljs.registerLanguage('plaintext', plaintext);
    hljs.registerLanguage('text', plaintext);
}

export function highlightCode(text: string, lang?: string): string {
    ensureHighlightLanguages();
    if (lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(text, { language: lang }).value; }
        catch { return escapeHtml(text); }
    }
    try { return hljs.highlightAuto(text).value; }
    catch { return escapeHtml(text); }
}

// ── Rehighlight all code blocks ──
export function rehighlightAll(scope?: HTMLElement | Document): void {
    ensureHighlightLanguages();
    const root = scope || document;
    root.querySelectorAll('.code-block pre code, .code-block-wrapper pre code').forEach(el => {
        if ((el as HTMLElement).dataset['highlighted'] === 'yes') return;
        const lang = [...el.classList].find(c => c.startsWith('language-'))?.replace('language-', '');
        const raw = el.textContent || '';
        try {
            if (lang && hljs.getLanguage(lang)) {
                el.innerHTML = hljs.highlight(raw, { language: lang }).value;
            } else {
                el.innerHTML = hljs.highlightAuto(raw).value;
            }
            (el as HTMLElement).dataset['highlighted'] = 'yes';
        } catch { /* ignore */ }
    });
}
