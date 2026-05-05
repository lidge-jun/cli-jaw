// ─── Shared types for src/cli/ slash-command surface ─────────
// Internal to src/cli/. Do NOT import from src/agent/, src/routes/, or bin/.

import type { CliCommandContext } from './command-context.js';

export type SlashIface = 'cli' | 'web' | 'telegram' | 'discord';

export interface SlashResult {
    ok?: boolean;
    type?: string;
    code?: string;
    steerPrompt?: string;
    text?: string;
    [k: string]: unknown;
}

export type SlashHandler = (
    args: string[],
    ctx: CliCommandContext,
) => Promise<SlashResult> | SlashResult;

export interface SlashChoice {
    value: string;
    label?: string;
    desc?: string;
    name?: string;
}

export type SlashArgumentCompleter = (
    ctx: CompletionCtx,
    argv?: string[],
    partial?: string,
) => SlashChoice[] | Promise<SlashChoice[]>;

// Lightweight context passed to argument-completion functions. Distinct from
// CliCommandContext: completions can be invoked without a full command runtime
// (e.g., from autocomplete preview), so the shape is a permissive subset.
export interface CompletionCtx {
    locale?: string;
    settings?: {
        cli?: string;
        perCli?: Record<string, unknown>;
        [k: string]: unknown;
    };
    [k: string]: unknown;
}

export interface SlashCommand {
    name: string;
    aliases?: readonly string[];
    descKey?: string;
    tgDescKey?: string;
    desc?: string;
    args?: string;
    category?: string;
    interfaces: readonly string[];
    hidden?: boolean;
    handler: SlashHandler | ((...args: unknown[]) => unknown);
    getArgumentCompletions?: SlashArgumentCompleter;
}

export type ParsedSlashCommand =
    | { type: 'known'; cmd: SlashCommand; args: string[]; name: string }
    | { type: 'unknown'; name: string; args: string[] }
    | null;

// Overlay item shape used by autocomplete + palette overlays in src/cli/tui/.
// bin/commands/tui/overlays.ts may pass a richer shape; reconcile in P10b.
export interface OverlayItem {
    name: string;
    desc?: string;
    args?: string;
    category?: string;
    command?: string;
    commandDesc?: string;
    insertText?: string;
    kind?: string;
    [k: string]: unknown;
}
