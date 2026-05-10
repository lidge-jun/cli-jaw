import { randomUUID } from 'node:crypto';
import {
    JAW_CEO_ID,
    type JawCeoAuditKind,
    type JawCeoAuditRecord,
    type JawCeoCompletion,
    type JawCeoConfirmationRecord,
    type JawCeoPendingStatus,
    type JawCeoPublicState,
    type JawCeoSessionContext,
    type JawCeoVoiceRuntimeState,
    type JawCeoWatch,
} from './types.js';

export type JawCeoStore = ReturnType<typeof createJawCeoStore>;

export type JawCeoStoreOptions = {
    maxPending?: number;
    maxAudit?: number;
    now?: () => Date;
};

function iso(now: () => Date): string {
    return now().toISOString();
}

function createDefaultSession(now: () => Date): JawCeoSessionContext {
    const at = iso(now);
    return {
        sessionId: `${JAW_CEO_ID}-${randomUUID()}`,
        inputMode: 'text',
        responseMode: 'text',
        selectedPort: null,
        openedAt: at,
        lastUserActivityAt: at,
        voiceArmed: false,
        frontendPresence: 'visible',
        autoRead: false,
    };
}

function createDefaultVoiceState(): JawCeoVoiceRuntimeState {
    return {
        status: process.env["OPENAI_API_KEY"] ? 'idle' : 'disabled',
        sessionId: null,
        model: process.env["JAW_CEO_REALTIME_MODEL"] || 'gpt-realtime-2',
        voice: process.env["JAW_CEO_REALTIME_VOICE"] || 'marin',
        error: null,
    };
}

export function createJawCeoStore(options: JawCeoStoreOptions = {}) {
    const maxPending = Math.max(1, options.maxPending ?? 100);
    const maxAudit = Math.max(1, options.maxAudit ?? 300);
    const now = options.now ?? (() => new Date());
    let session = createDefaultSession(now);
    let voice = createDefaultVoiceState();
    const watches = new Map<string, JawCeoWatch>();
    const completions = new Map<string, JawCeoCompletion>();
    const completionAliases = new Map<string, string>();
    const audit: JawCeoAuditRecord[] = [];
    const confirmations = new Map<string, JawCeoConfirmationRecord>();

    function trimPending(): void {
        while (completions.size > maxPending) {
            const oldest = completions.keys().next().value as string | undefined;
            if (!oldest) break;
            completions.delete(oldest);
        }
    }

    function appendAudit(input: Omit<JawCeoAuditRecord, 'id' | 'at'> & { id?: string; at?: string }): JawCeoAuditRecord {
        const record: JawCeoAuditRecord = {
            id: input.id || `audit_${randomUUID()}`,
            at: input.at || iso(now),
            kind: input.kind,
            action: input.action,
            ok: input.ok,
            message: input.message,
            ...(input.port !== undefined ? { port: input.port } : {}),
            ...(input.meta !== undefined ? { meta: input.meta } : {}),
        };
        audit.push(record);
        while (audit.length > maxAudit) audit.shift();
        return record;
    }

    function resolveCompletionKey(key: string): string {
        return completionAliases.get(key) || key;
    }

    return {
        now,
        getState(): JawCeoPublicState {
            return {
                session: { ...session },
                watches: Array.from(watches.values()).map(watch => ({ ...watch })),
                pending: Array.from(completions.values()).map(completion => ({ ...completion })),
                auditTail: audit.slice(-50).map(record => ({ ...record })),
                voice: { ...voice },
            };
        },
        updateSession(patch: Partial<JawCeoSessionContext>): JawCeoSessionContext {
            session = {
                ...session,
                ...patch,
                lastUserActivityAt: patch.lastUserActivityAt || iso(now),
            };
            return { ...session };
        },
        getSession(): JawCeoSessionContext {
            return { ...session };
        },
        updateVoice(patch: Partial<JawCeoVoiceRuntimeState>): JawCeoVoiceRuntimeState {
            voice = { ...voice, ...patch };
            return { ...voice };
        },
        addWatch(watch: JawCeoWatch): JawCeoWatch {
            watches.set(watch.watchId, { ...watch });
            return { ...watch };
        },
        listWatches(): JawCeoWatch[] {
            return Array.from(watches.values()).map(watch => ({ ...watch }));
        },
        findWatch(watchId: string): JawCeoWatch | null {
            const watch = watches.get(watchId);
            return watch ? { ...watch } : null;
        },
        findWatchesByPort(port: number): JawCeoWatch[] {
            return Array.from(watches.values()).filter(watch => watch.port === port).map(watch => ({ ...watch }));
        },
        removeWatch(watchId: string): boolean {
            return watches.delete(watchId);
        },
        upsertCompletion(completion: JawCeoCompletion): JawCeoCompletion {
            const canonicalKey = resolveCompletionKey(completion.completionKey);
            const existing = completions.get(canonicalKey);
            if (existing) {
                const source = existing.source === 'latest_message_fallback' && completion.source !== 'latest_message_fallback'
                    ? completion.source
                    : existing.source;
                const aliases = new Set([...(existing.aliases || []), ...(completion.aliases || [])]);
                if (completion.completionKey !== canonicalKey) aliases.add(completion.completionKey);
                const merged: JawCeoCompletion = {
                    ...existing,
                    ...completion,
                    completionKey: canonicalKey,
                    source,
                    status: existing.status,
                    aliases: Array.from(aliases),
                };
                completions.set(canonicalKey, merged);
                return { ...merged };
            }
            completions.set(completion.completionKey, { ...completion });
            trimPending();
            return { ...completion };
        },
        aliasCompletion(aliasKey: string, canonicalKey: string): void {
            completionAliases.set(aliasKey, canonicalKey);
        },
        listPending(status?: JawCeoPendingStatus): JawCeoCompletion[] {
            const rows = Array.from(completions.values());
            return rows
                .filter(completion => status ? completion.status === status : completion.status === 'pending' || completion.status === 'spoken')
                .map(completion => ({ ...completion }));
        },
        getCompletion(completionKey: string): JawCeoCompletion | null {
            const completion = completions.get(resolveCompletionKey(completionKey));
            return completion ? { ...completion } : null;
        },
        updateCompletionStatus(completionKey: string, status: JawCeoPendingStatus): JawCeoCompletion | null {
            const canonicalKey = resolveCompletionKey(completionKey);
            const completion = completions.get(canonicalKey);
            if (!completion) return null;
            const next = { ...completion, status };
            completions.set(canonicalKey, next);
            return { ...next };
        },
        appendAudit,
        listAudit(limit = 50, filter?: { kind?: JawCeoAuditKind; port?: number }): JawCeoAuditRecord[] {
            const boundedLimit = Math.max(1, Math.min(300, limit));
            return audit
                .filter(record => !filter?.kind || record.kind === filter.kind)
                .filter(record => filter?.port === undefined || record.port === filter.port)
                .slice(-boundedLimit)
                .map(record => ({ ...record }));
        },
        addConfirmation(record: JawCeoConfirmationRecord): JawCeoConfirmationRecord {
            confirmations.set(record.id, { ...record });
            return { ...record };
        },
        getConfirmation(id: string): JawCeoConfirmationRecord | null {
            const record = confirmations.get(id);
            return record ? { ...record } : null;
        },
        updateConfirmation(id: string, patch: Partial<JawCeoConfirmationRecord>): JawCeoConfirmationRecord | null {
            const record = confirmations.get(id);
            if (!record) return null;
            const next = { ...record, ...patch };
            confirmations.set(id, next);
            return { ...next };
        },
    };
}
