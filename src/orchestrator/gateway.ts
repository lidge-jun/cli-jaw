// ─── submitMessage gateway ──────────────────────────
// Unified message submission for all interfaces (WebUI, REST, Telegram).
// Replaces duplicated intent/queue/orchestrate logic in server.ts + bot.ts.

import { activeProcess, enqueueMessage, messageQueue } from '../agent/spawn.js';
import { insertMessage } from '../core/db.js';
import { broadcast } from '../core/bus.js';
import {
    orchestrate, orchestrateContinue, orchestrateReset,
    isContinueIntent, isResetIntent,
} from './pipeline.js';

export type SubmitResult = {
    action: 'started' | 'queued' | 'rejected';
    reason?: string;
    pending?: number;
};

export function submitMessage(
    text: string,
    meta: { origin: 'web' | 'cli' | 'telegram'; displayText?: string },
): SubmitResult {
    const trimmed = text.trim();
    if (!trimmed) return { action: 'rejected', reason: 'empty' };

    const display = meta.displayText || trimmed;

    // ── continue intent ──
    if (isContinueIntent(trimmed)) {
        if (activeProcess) return { action: 'rejected', reason: 'busy' };
        insertMessage.run('user', display, meta.origin, '');
        broadcast('new_message', { role: 'user', content: display, source: meta.origin });
        orchestrateContinue({ origin: meta.origin });
        return { action: 'started' };
    }

    // ── reset intent ──
    if (isResetIntent(trimmed)) {
        if (activeProcess) return { action: 'rejected', reason: 'busy' };
        insertMessage.run('user', display, meta.origin, '');
        broadcast('new_message', { role: 'user', content: display, source: meta.origin });
        orchestrateReset({ origin: meta.origin });
        return { action: 'started' };
    }

    // ── busy → enqueue only ──
    // NOTE: insertMessage is NOT called here — processQueue() handles it.
    // This fixes the dual-insert bug where bot.ts called both enqueue + insert.
    if (activeProcess) {
        enqueueMessage(trimmed, meta.origin);
        broadcast('new_message', { role: 'user', content: display, source: meta.origin });
        return { action: 'queued', pending: messageQueue.length };
    }

    // ── idle → start immediately ──
    insertMessage.run('user', display, meta.origin, '');
    broadcast('new_message', { role: 'user', content: display, source: meta.origin });
    orchestrate(trimmed, { origin: meta.origin });
    return { action: 'started' };
}
