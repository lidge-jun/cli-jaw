import { posix, win32 } from 'node:path';
import { redactOutboundText } from '../messaging/redact.js';
const MAX_PATH_INPUT = 4096;
const MAX_FILE_LABEL = 100;

function safePath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_INPUT
        && value === value.trim()
        && value.split(/[\\/]/).every(part => part === part.trim())
        && !/[\p{Cc}\p{Cf}\p{Cs}<>|&`$*?!@#%{}\[\]();="']/u.test(value)
        && !/^[a-z][a-z\d+.-]*:\/\//i.test(value)
        && !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value)
        && !/[~]/.test(value)
        && !/[:]/.test(value.replace(/^[A-Za-z]:[\\/]/, ''))
        && !/(?:xox[baprs]-|xapp-|sk-|gh[pousr]_|github_pat_)/i.test(value)
        && redactOutboundText(value) === value;
}

/** Already projected labels are rechecked immediately before entering the model. */
export function sanitizeSlackFileLabel(value: unknown): string | undefined {
    if (!safePath(value) || [...value].length > MAX_FILE_LABEL || posix.isAbsolute(value)
        || win32.isAbsolute(value) || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..')) return undefined;
    return value;
}

export function projectSlackFilePath(raw: unknown, workingDir?: string): string | undefined {
    if (!safePath(raw)) return undefined;
    const windows = /^[A-Za-z]:[\\/]/.test(raw) || raw.includes('\\')
        || (typeof workingDir === 'string' && /^[A-Za-z]:[\\/]/.test(workingDir));
    const path = windows ? win32 : posix;
    let label = path.basename(raw);
    if (typeof workingDir === 'string' && path.isAbsolute(workingDir)
        && !/[\p{Cc}\p{Cf}]/u.test(workingDir) && workingDir.length <= MAX_PATH_INPUT) {
        const relative = path.relative(workingDir, path.resolve(workingDir, raw));
        if (relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) label = relative;
    }
    label = label.replace(/\\/g, '/');
    if ([...label].length > MAX_FILE_LABEL) label = `…${[...label].slice(-(MAX_FILE_LABEL - 1)).join('')}`;
    return sanitizeSlackFileLabel(label);
}

const fileTools = new Set(['read', 'read_file', 'readfile', 'write', 'write_file', 'writefile', 'edit', 'edit_file', 'editfile']);

export function projectSlackToolFile(data: Record<string, unknown>, name: unknown, workingDir?: string, allowPrintDetail = false): string | undefined {
    if (typeof name !== 'string' || name.length > 256 || !fileTools.has(name.trim().toLowerCase())) return undefined;
    let input: unknown = data['input'];
    if (typeof input === 'string') {
        if (input.length > MAX_PATH_INPUT) return undefined;
        try { input = JSON.parse(input); } catch { return undefined; }
    }
    const object = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : data;
    const paths = ['file_path', 'path', 'filename'].filter(key => Object.hasOwn(object, key)).map(key => object[key]);
    // Conflicting structured addresses are not evidence of one file.
    const raw = paths.length ? paths.every(path => path === paths[0]) ? paths[0] : undefined
        : allowPrintDetail && data['input'] === undefined ? data['detail'] : undefined;
    if (typeof raw !== 'string') return undefined;
    // Spaces need a structured address or an absolute single-path detail;
    // unstructured relative prose is not evidence of a file.
    if (!paths.length && /\s/.test(raw) && !posix.isAbsolute(raw) && !win32.isAbsolute(raw)) return undefined;
    return projectSlackFilePath(raw, workingDir);
}
