import path from 'node:path';

const ACTIVE_WINDOW_MS = 5 * 60_000;

const CONFIRMATION_REQUIRED_ACTIONS = new Set([
    'instance.stop',
    'instance.request_perm',
    'instance.cross_route',
    'destructive',
    'broad_action',
]);

const DOCS_CODE_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.scss', '.json', '.toml',
    '.yaml', '.yml', '.sh', '.bash', '.zsh', '.py', '.rs', '.go', '.java', '.lock',
]);

const DOCS_CODE_BASENAMES = new Set([
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'tsconfig.json',
    'vite.config.ts',
    'server.ts',
]);

export function canAutoVoiceResume(args: {
    lastUserActivityAt: string;
    documentVisible: boolean;
    autoRead: boolean;
    now?: Date | undefined;
}): boolean {
    if (!args.documentVisible || !args.autoRead) return false;
    const last = Date.parse(args.lastUserActivityAt);
    if (Number.isNaN(last)) return false;
    return (args.now ?? new Date()).getTime() - last <= ACTIVE_WINDOW_MS;
}

export function requireConfirmation(args: {
    action: string;
    argsHash?: string | undefined;
    targetPort?: number | undefined;
    sessionId?: string | undefined;
    confirmationRecordId?: string | undefined;
}): { ok: true } | { ok: false; code: string; message: string } {
    if (!CONFIRMATION_REQUIRED_ACTIONS.has(args.action)) return { ok: true };
    if (!args.confirmationRecordId) {
        return {
            ok: false,
            code: 'confirmation_required',
            message: `${args.action} requires an explicit confirmation token`,
        };
    }
    if (!args.argsHash || !args.sessionId) {
        return {
            ok: false,
            code: 'confirmation_context_missing',
            message: `${args.action} confirmation must include argsHash and sessionId`,
        };
    }
    return { ok: true };
}

export function assertDocsOnlyEdit(args: {
    path: string;
    allowedRoots: string[];
}): { ok: true } | { ok: false; code: string; message: string } {
    const target = path.resolve(args.path);
    const basename = path.basename(target);
    const ext = path.extname(target).toLowerCase();
    if (DOCS_CODE_BASENAMES.has(basename) || DOCS_CODE_EXTENSIONS.has(ext)) {
        return { ok: false, code: 'docs_edit_code_path_denied', message: 'CEO docs edit cannot touch code, config, script, or package metadata paths' };
    }
    if (ext !== '.md' && basename !== 'README.md') {
        return { ok: false, code: 'docs_edit_extension_denied', message: 'CEO docs edit is limited to markdown files and README.md' };
    }
    for (const root of args.allowedRoots) {
        const resolvedRoot = path.resolve(root);
        const relative = path.relative(resolvedRoot, target);
        if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
            return { ok: true };
        }
    }
    return { ok: false, code: 'docs_edit_root_denied', message: 'path is outside the Jaw CEO docs-edit allowlist' };
}

export function isReadonlyCliQueryAllowed(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed || /[;&|`$<>]/.test(trimmed)) return false;
    const allowedPrefixes = [
        'pwd',
        'ls',
        'rg',
        'sed',
        'nl',
        'wc',
        'git status',
        'git diff',
        'git show',
        'git log',
        'gh issue view',
        'gh issue list',
        'gh pr view',
        'gh pr list',
        'gh run list',
    ];
    return allowedPrefixes.some(prefix => trimmed === prefix || trimmed.startsWith(`${prefix} `));
}
