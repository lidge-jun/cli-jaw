import { broadcast, addBroadcastListener } from '../core/bus.js';
import { settings } from '../core/config.js';
import { sendChannelOutput } from '../messaging/send.js';
import type { MessengerChannel } from '../messaging/types.js';

interface ErrorRecord {
    ts: number;
    type: string;
}

const errorHistory = new Map<string, ErrorRecord[]>();
let lastAlertAt = 0;

function getConfig() {
    const cfg = (settings as Record<string, unknown>)["alertEscalation"] as Record<string, unknown> | undefined || {};
    return {
        enabled: cfg["enabled"] !== false,
        threshold: (cfg["threshold"] as number) ?? 3,
        windowMs: (cfg["windowMs"] as number) ?? 600_000,
        cooldownMs: (cfg["cooldownMs"] as number) ?? 1_800_000,
        channels: (cfg["channels"] as string[]) ?? ['telegram'],
    };
}

export function recordError(cli: string, type: string): void {
    const cfg = getConfig();
    if (!cfg.enabled) return;

    const now = Date.now();
    const history = errorHistory.get(cli) || [];
    history.push({ ts: now, type });

    const cutoff = now - cfg.windowMs;
    const recent = history.filter(e => e.ts > cutoff);
    errorHistory.set(cli, recent);

    if (recent.length >= cfg.threshold && (now - lastAlertAt) > cfg.cooldownMs) {
        lastAlertAt = now;
        const lastType = recent[recent.length - 1]?.type || 'unknown';
        const msg = `🚨 jaw Alert: ${cli} 연속 실패\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `상태: ${lastType} ${recent.length}회 (${Math.round(cfg.windowMs / 60_000)}분)\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `조치: CLI 로그인 상태 확인 필요`;
        broadcast('alert_escalation', { cli, message: msg, channels: cfg.channels });
    }
}

export function clearErrors(cli: string): void {
    errorHistory.delete(cli);
}

let _alertDeliveryInit = false;

export function initAlertDelivery(): void {
    if (_alertDeliveryInit) return;
    _alertDeliveryInit = true;

    addBroadcastListener((type, data) => {
        if (type !== 'alert_escalation') return;
        const channels = (data["channels"] as string[]) ?? ['telegram'];
        const text = data["message"] as string;
        if (!text) return;

        for (const ch of channels) {
            if (ch !== 'telegram' && ch !== 'discord') continue;
            sendChannelOutput({ type: 'text', text, channel: ch as MessengerChannel }).catch((err) => {
                console.warn(`[jaw:alert] delivery to ${ch} failed:`, (err as Error).message);
            });
        }
    });
}
