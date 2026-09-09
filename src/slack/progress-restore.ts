import { t } from '../core/i18n.js';
import type { QueueNoticeStore } from '../messaging/queue-notice-store.js';
import type { SlackFetch } from './api.js';
import { createSlackNoticeTransport } from './notice-transport.js';

type RestoreOptions = {
    getStore: () => QueueNoticeStore | null;
    getToken: () => string | null;
    getGeneration: () => number;
    isLive: (requestId: string) => boolean;
    getLocale: () => string;
    registerDrain: (drain: (signal?: AbortSignal) => Promise<void>) => () => void;
    fetchImpl?: SlackFetch;
    onError?: () => void;
};

type Operation = { generation: number; controller: AbortController; promise: Promise<void> };

/** Captured restoration ownership; the bot owns admission and disposal ordering. */
export function createSlackProgressRestorer(options: RestoreOptions): {
    restore(): Promise<void>; abort(): void;
} {
    const operations = new Set<Operation>();
    let current: Operation | undefined;
    function abort(): void {
        for (const operation of operations) operation.controller.abort();
    }
    function restore(): Promise<void> {
        const generation = options.getGeneration();
        if (current?.generation === generation) return current.promise;
        abort();
        const store = options.getStore();
        const token = options.getToken();
        const locale = options.getLocale();
        const controller = new AbortController();
        const { signal } = controller;
        const isCurrent = () => !signal.aborted && options.getGeneration() === generation;
        // Guard each HTTP dispatch too: stop and edit are separate awaits inside transport.
        const fetchImpl: SlackFetch = (input, init) => {
            if (!isCurrent()) {
                controller.abort();
                return Promise.reject(new Error('slack_progress_restore_aborted'));
            }
            return (options.fetchImpl ?? fetch)(input, init);
        };
        async function work(): Promise<void> {
            if (!store || !token || !isCurrent()) return;
            const text = t('slack.progress.restored', {}, locale);
            for (const record of store.listRestorable('slack')) {
                if (!isCurrent()) return;
                if (!record.messageId || options.isLive(record.requestId)) continue;
                try {
                    if (!isCurrent()) return;
                    await createSlackNoticeTransport(token, record.target.targetId, record.messageId, { fetchImpl })
                        .edit(text, signal);
                    if (!isCurrent()) return;
                    if (!options.isLive(record.requestId)) store.close(record.requestId);
                } catch {
                    if (!isCurrent()) return;
                    options.onError?.();
                }
            }
        }
        // Defer work until both the single-flight owner and drain registration exist.
        let unregister = () => {};
        const operation: Operation = { generation, controller, promise: Promise.resolve() };
        operation.promise = Promise.resolve().then(work).finally(() => {
            operations.delete(operation);
            if (current === operation) current = undefined;
            unregister();
        });
        operations.add(operation);
        current = operation;
        try {
            unregister = options.registerDrain(() => {
                controller.abort();
                return operation.promise;
            });
        } catch {
            controller.abort();
            options.onError?.();
        }
        return operation.promise;
    }
    return { restore, abort };
}
