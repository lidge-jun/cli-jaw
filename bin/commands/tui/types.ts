/**
 * TUI shared types, constants, and helpers.
 */
import type { TuiStore } from '../../../src/cli/tui/store.js';
import type { IdeType } from '../../../src/ide/diff.js';
import type WebSocket from 'ws';

// ─── ANSI color codes ────────────────────────
export const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

export const cliLabel: Record<string, string> = {
    claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI',
    opencode: 'OpenCode', copilot: 'Copilot',
};
export const cliColor: Record<string, string> = {
    claude: c.magenta, codex: c.red, gemini: c.blue,
    opencode: c.yellow, copilot: c.cyan,
};

export const ESC_WAIT_MS = 70;

// ─── Terminal dimension helpers ──────────────
export const W = () => Math.max(20, Math.min((process.stdout.columns || 60) - 4, 60));
export const hrLine = () => '-'.repeat(W());
export const getRows = () => process.stdout.rows || 24;

export function renderCommandText(text: string) {
    return String(text || '').replace(/\n/g, '\n  ');
}

// ─── Shared state interface ──────────────────
export interface TuiContext {
    ws: WebSocket;
    apiUrl: string;

    info: { cli: string; workingDir: string; model: string };
    accent: string;
    label: string;
    dir: string;
    runtimeLocale: string;
    tuiConfig: { pasteCollapseLines: number; pasteCollapseChars: number; [k: string]: unknown };
    values: { port: string; raw: boolean; simple: boolean };
    isRaw: boolean;

    store: TuiStore;

    overlayBoxHeight: number;
    inputActive: boolean;
    streaming: boolean;
    commandRunning: boolean;
    escPending: boolean;
    escTimer: ReturnType<typeof setTimeout> | null;
    prevLineCount: number;
    resizeTimer: ReturnType<typeof setTimeout> | null;

    ideEnabled: boolean;
    idePopEnabled: boolean;
    preFileSetQueue: Map<string, string>[];
    chatCwd: string;
    isGit: boolean;
    detectedIde: IdeType;

    promptPrefix: string;
    footer: string;
}
