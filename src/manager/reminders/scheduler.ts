import type { Observability } from '../observability.js';
import { classifyReminderDue } from './due-time.js';
import { dispatchReminderNotification, type ReminderDispatcherOptions } from './dispatcher.js';
import { RemindersStore } from './store.js';

export type RemindersSchedulerOptions = {
    intervalMs?: number;
    store?: RemindersStore;
    observability?: Pick<Observability, 'publish'>;
    log?: (message: string) => void;
    dispatcher?: ReminderDispatcherOptions['send'];
    now?: () => Date;
};

export function startRemindersScheduler(options: RemindersSchedulerOptions = {}): () => void {
    const store = options.store ?? new RemindersStore();
    const intervalMs = Math.max(1_000, options.intervalMs ?? 30_000);
    const log = options.log ?? (() => {});
    const now = options.now ?? (() => new Date());
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;

    async function tick(): Promise<void> {
        if (running || stopped) return;
        running = true;
        const tickNow = now();
        try {
            const reminders = store.listDueReminders(tickNow.toISOString());
            for (const reminder of reminders) {
                const decision = classifyReminderDue(reminder, tickNow);
                if (decision.status === 'invalid_remind_at') {
                    store.markNotificationAttempt(reminder.id, 'invalid_remind_at', decision.error, tickNow.toISOString());
                    options.observability?.publish({
                        kind: 'reminder-delivery',
                        reminderId: reminder.id,
                        status: 'invalid_remind_at',
                        error: decision.error,
                        at: tickNow.toISOString(),
                    });
                    log(`[reminders-scheduler] invalid_remind_at ${reminder.id}: ${decision.error}`);
                    continue;
                }
                if (decision.status !== 'due') continue;
                const dispatchOptions: ReminderDispatcherOptions = { log, now };
                if (options.dispatcher) dispatchOptions.send = options.dispatcher;
                if (options.observability) dispatchOptions.observability = options.observability;
                const result = await dispatchReminderNotification(reminder, dispatchOptions);
                store.markNotificationAttempt(reminder.id, result.status, result.error, result.at);
            }
        } catch (error) {
            log(`[reminders-scheduler] tick failed: ${(error as Error).message}`);
        } finally {
            running = false;
        }
    }

    function schedule(): void {
        if (stopped) return;
        timer = setTimeout(() => {
            void tick().finally(schedule);
        }, intervalMs);
        if (typeof timer.unref === 'function') timer.unref();
    }

    schedule();
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}
