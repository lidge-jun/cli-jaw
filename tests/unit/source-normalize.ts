import { readFileSync } from 'node:fs';

export function normalizeStrictPropertyAccess(source: string): string {
    return source
        .replace(/([A-Za-z_$][\w$]*|\]|\))\?\.\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]/g, '$1?.$2')
        .replace(/([A-Za-z_$][\w$]*|\]|\))!\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]/g, '$1!.$2')
        .replace(/([A-Za-z_$][\w$]*|\]|\))\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]/g, '$1.$2');
}

export function readSource(path: string, _encoding: BufferEncoding = 'utf8'): string {
    return normalizeStrictPropertyAccess(readFileSync(path, 'utf8'));
}
