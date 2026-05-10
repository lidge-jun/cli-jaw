import path from 'node:path';
import {
    canAutoResumeVoiceForCompletion as canAutoResumeVoiceForCompletionImpl,
    cancelConfirmation as cancelConfirmationImpl,
    closeVoiceSession as closeVoiceSessionImpl,
    confirmConfirmation as confirmConfirmationImpl,
    createConfirmation as createConfirmationImpl,
    editDocs as editDocsImpl,
    query as queryImpl,
    registerVoiceSession as registerVoiceSessionImpl,
    runLifecycleTool as runLifecycleToolImpl,
} from './coordinator-admin.js';
import {
    continueCompletion as continueCompletionImpl,
    ingestManagerEvent as ingestManagerEventImpl,
    refreshEvents as refreshEventsImpl,
    summarizeCompletion as summarizeCompletionImpl,
    updatePendingStatus as updatePendingStatusImpl,
} from './coordinator-completions.js';
import { executeRealtimeTool as executeRealtimeToolImpl } from './coordinator-realtime-tools.js';
import type {
    JawCeoCoordinatorContext,
    JawCeoCoordinatorDeps,
    JawCeoMessageInput,
    JawCeoVoiceSessionRecord,
} from './coordinator-types.js';
import { getInstanceActivity, inspectInstance, listInstances, message, sendMessage, watchCompletion } from './coordinator-workers.js';
import { buildJawCeoDocsEditPolicy, type JawCeoDocsEditPolicy } from './docs-edit.js';
import { createJawCeoStore, type JawCeoStore } from './store.js';
import { loadJawCeoTranscript, persistJawCeoTranscript } from './transcript-persistence.js';
import type {
    JawCeoCompletion,
    JawCeoLatestMessageFallback,
    JawCeoManagerEvent,
    JawCeoPublicState,
    JawCeoResponseMode,
    JawCeoToolResult,
    JawCeoWatch,
    JawCeoWatchReason,
} from './types.js';

export type {
    JawCeoCoordinatorDeps,
    JawCeoLifecycleAction,
    JawCeoMessageInput,
    JawCeoVoiceSessionRecord,
} from './coordinator-types.js';

const DEFAULT_DASHBOARD_NOTES_ROOT = path.join(process.env["HOME"] || process.cwd(), '.cli-jaw-dashboard', 'notes');

export class JawCeoCoordinator {
    readonly store: JawCeoStore;
    readonly repoRoot: string;
    readonly docsPolicy: JawCeoDocsEditPolicy;
    private readonly deps: JawCeoCoordinatorDeps;
    private readonly now: () => Date;
    private readonly voiceSessions = new Map<string, JawCeoVoiceSessionRecord>();

    constructor(deps: JawCeoCoordinatorDeps) {
        this.deps = deps;
        this.now = deps.now ?? (() => new Date());
        this.store = deps.store || createJawCeoStore({
            now: this.now,
            initialTranscript: loadJawCeoTranscript(),
            onTranscriptAppend: entry => persistJawCeoTranscript(entry),
        });
        this.repoRoot = path.resolve(deps.repoRoot);
        this.docsPolicy = buildJawCeoDocsEditPolicy({
            repoRoot: this.repoRoot,
            dashboardNotesRoot: deps.dashboardNotesRoot || DEFAULT_DASHBOARD_NOTES_ROOT,
        });
    }

    private context(): JawCeoCoordinatorContext {
        return {
            store: this.store,
            repoRoot: this.repoRoot,
            docsPolicy: this.docsPolicy,
            deps: this.deps,
            now: this.now,
            voiceSessions: this.voiceSessions,
        };
    }

    state(): JawCeoPublicState {
        return this.store.getState();
    }

    updatePresence(args: {
        selectedPort?: number | null | undefined;
        frontendPresence?: 'active' | 'visible' | 'hidden' | 'gone' | undefined;
        autoRead?: boolean | undefined;
    }): JawCeoPublicState {
        this.store.updateSession({
            ...(args.selectedPort !== undefined ? { selectedPort: args.selectedPort } : {}),
            ...(args.frontendPresence !== undefined ? { frontendPresence: args.frontendPresence } : {}),
            ...(args.autoRead !== undefined ? { autoRead: args.autoRead } : {}),
        });
        return this.state();
    }

    async listInstances(args: { includeHidden?: boolean | undefined } = {}) {
        return await listInstances(this.context(), args);
    }

    async inspectInstance(args: { port: number; depth: 'summary' | 'latest' | 'recent' }): Promise<JawCeoToolResult> {
        return await inspectInstance(this.context(), args);
    }

    async getInstanceActivity(args: { port: number; limit?: number | undefined }): Promise<JawCeoToolResult> {
        return await getInstanceActivity(this.context(), args);
    }

    async message(input: JawCeoMessageInput): Promise<JawCeoToolResult<{ response: string; pending: JawCeoCompletion[] }>> {
        return await message(this.context(), input);
    }

    async watchCompletion(args: {
        port: number;
        dispatchRef: string;
        reason: JawCeoWatchReason;
        latestMessageFallback: JawCeoLatestMessageFallback;
        sessionId?: string | undefined;
        autoRead?: boolean | undefined;
    }): Promise<JawCeoToolResult<JawCeoWatch>> {
        return await watchCompletion(this.context(), args);
    }

    async sendMessage(args: {
        port: number;
        message: string;
        dispatchRef?: string | undefined;
        sourceChannel: 'ceo_text' | 'ceo_voice';
        responseMode: JawCeoResponseMode;
        watchCompletion: boolean;
        reason?: string | undefined;
    }): Promise<JawCeoToolResult> {
        return await sendMessage(this.context(), args);
    }

    ingestManagerEvent(event: JawCeoManagerEvent): { ok: true; completion?: JawCeoCompletion } | { ok: false; code: string; message: string } {
        return ingestManagerEventImpl(this.context(), event);
    }

    async refreshEvents(args: { ports?: number[] | undefined; events?: JawCeoManagerEvent[] | undefined; sinceCursor?: string | undefined }): Promise<{ pending: JawCeoCompletion[]; cursor: string }> {
        return await refreshEventsImpl(this.context(), args);
    }

    continueCompletion(completionKey: string, mode: JawCeoResponseMode = 'text'): JawCeoToolResult {
        return continueCompletionImpl(this.context(), completionKey, mode);
    }

    summarizeCompletion(completionKey: string, format: 'short' | 'detailed' = 'short'): JawCeoToolResult {
        return summarizeCompletionImpl(this.context(), completionKey, format);
    }

    updatePendingStatus(completionKey: string, status: 'acknowledged' | 'dismissed' | 'spoken'): JawCeoToolResult {
        return updatePendingStatusImpl(this.context(), completionKey, status);
    }

    async query(args: {
        source: 'dashboard' | 'cli_readonly' | 'web' | 'github_read';
        query: string;
        port?: number | undefined;
        limit?: number | undefined;
    }): Promise<JawCeoToolResult> {
        return await queryImpl(this.context(), args);
    }

    async editDocs(args: {
        path: string;
        operation: 'append_section' | 'replace_section' | 'apply_patch';
        content: string;
        reason: string;
    }): Promise<JawCeoToolResult> {
        return await editDocsImpl(this.context(), args);
    }

    createConfirmation(args: {
        action: string;
        targetPort?: number | undefined;
        sessionId?: string | undefined;
        argsHash?: string | undefined;
        expiresInMs?: number | undefined;
    }): JawCeoToolResult {
        return createConfirmationImpl(this.context(), args);
    }

    confirmConfirmation(confirmationId: string, args: { sessionId?: string | undefined; reason?: string | undefined } = {}): JawCeoToolResult {
        return confirmConfirmationImpl(this.context(), confirmationId, args);
    }

    cancelConfirmation(confirmationId: string, reason?: string | undefined): JawCeoToolResult {
        return cancelConfirmationImpl(this.context(), confirmationId, reason);
    }

    async runLifecycleTool(args: {
        action: 'instance.start' | 'instance.restart' | 'instance.stop' | 'instance.request_perm';
        port: number;
        reason: string;
        permission?: string | undefined;
        confirmationRecordId?: string | undefined;
    }): Promise<JawCeoToolResult> {
        return await runLifecycleToolImpl(this.context(), args);
    }

    canAutoResumeVoiceForCompletion(completion: JawCeoCompletion, documentVisible: boolean): boolean {
        return canAutoResumeVoiceForCompletionImpl(this.context(), completion, documentVisible);
    }

    registerVoiceSession(record: JawCeoVoiceSessionRecord): void {
        registerVoiceSessionImpl(this.context(), record);
    }

    closeVoiceSession(sessionId: string): JawCeoToolResult {
        return closeVoiceSessionImpl(this.context(), sessionId);
    }

    async executeRealtimeTool(name: string, rawArgs: unknown): Promise<JawCeoToolResult> {
        return await executeRealtimeToolImpl(this.context(), name, rawArgs);
    }
}
