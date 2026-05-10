import type { JawCeoDocsEditPolicy } from './docs-edit.js';
import type { JawCeoStore } from './store.js';
import type {
    JawCeoInputMode,
    JawCeoLatestMessageSnapshot,
    JawCeoResponseMode,
} from './types.js';

export type JawCeoLifecycleAction = 'start' | 'stop' | 'restart' | 'perm';

export type JawCeoCoordinatorDeps = {
    repoRoot: string;
    dashboardNotesRoot?: string | undefined;
    store?: JawCeoStore | undefined;
    listInstances?: (() => Promise<import('./types.js').JawCeoInstanceSummary[]>) | undefined;
    fetchLatestMessage?: ((port: number) => Promise<JawCeoLatestMessageSnapshot | null>) | undefined;
    sendWorkerMessage?: (args: {
        port: number;
        prompt: string;
        sourceChannel: 'ceo_text' | 'ceo_voice';
        responseMode: JawCeoResponseMode;
    }) => Promise<{ ok: boolean; status?: number | undefined; message?: string | undefined; data?: unknown }>;
    runLifecycleAction?: (args: {
        action: JawCeoLifecycleAction;
        port: number;
        reason: string;
    }) => Promise<{ ok: boolean; status?: string | undefined; message: string; data?: unknown }>;
    now?: (() => Date) | undefined;
};

export type JawCeoMessageInput = {
    sessionId?: string | undefined;
    inputMode?: JawCeoInputMode | undefined;
    responseMode?: JawCeoResponseMode | undefined;
    text: string;
    selectedPort?: number | null | undefined;
};

export type JawCeoVoiceSessionRecord = {
    sessionId: string;
    callId: string;
    close(): void;
};

export type JawCeoCoordinatorContext = {
    store: JawCeoStore;
    repoRoot: string;
    docsPolicy: JawCeoDocsEditPolicy;
    deps: JawCeoCoordinatorDeps;
    now: () => Date;
    voiceSessions: Map<string, JawCeoVoiceSessionRecord>;
};
