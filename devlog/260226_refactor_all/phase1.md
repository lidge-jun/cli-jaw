# Phase 1: Interface Unify — submitMessage 게이트웨이 + TG 출력 통합 + CommandContext 통합

**Date**: 2026-02-26  
**Status**: 📋 구현 예정  
**변경 파일**: 7개 수정, 2개 신규  
**예상 라인**: +180, -150 (순 +30)

---

## Phase A: submitMessage 게이트웨이

### 목표

`server.ts` WS (L185-226) + REST (L421-451) + `bot.ts` tgOrchestrate (L283-308) 3곳의 중복 메시지 처리 로직을 `submitMessage()` 하나로 통합.

### [NEW] `src/orchestrator/gateway.ts`

```typescript
import { activeProcess, enqueueMessage, messageQueue } from '../agent/spawn.js';
import { insertMessage } from '../core/db.js';
import { broadcast } from '../core/bus.js';
import { orchestrate, orchestrateContinue, orchestrateReset, isContinueIntent, isResetIntent } from './pipeline.js';

export type SubmitResult = {
    action: 'started' | 'queued' | 'rejected';
    reason?: string;
    pending?: number;
};

export function submitMessage(
    text: string,
    meta: { origin: 'web' | 'cli' | 'telegram'; displayText?: string }
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

    // ── busy → enqueue only (insert는 processQueue에서) ──
    if (activeProcess) {
        enqueueMessage(trimmed, meta.origin);
        // ✅ insertMessage 안 함 → processQueue에서 1번만 insert → 이중 저장 해결
        broadcast('new_message', { role: 'user', content: display, source: meta.origin });
        return { action: 'queued', pending: messageQueue.length };
    }

    // ── idle → 즉시 실행 ──
    insertMessage.run('user', display, meta.origin, '');
    broadcast('new_message', { role: 'user', content: display, source: meta.origin });
    orchestrate(trimmed, { origin: meta.origin });
    return { action: 'started' };
}
```

### [MODIFY] `server.ts` L185-226 (WS handler)

```diff
 ws.on('message', (raw) => {
     try {
         const msg = JSON.parse(raw.toString());
         if (msg.type === 'send_message' && msg.text) {
             const text = String(msg.text || '').trim();
             if (!text) return;
             console.log(`[ws:in] ${text.slice(0, 80)}`);
-
-            // Continue intent는 큐에 넣지 않고 명시적으로 처리
-            if (isContinueIntent(text)) {
-                if (activeProcess) {
-                    broadcast('agent_done', {
-                        text: t('ws.agentBusy', {}, resolveRequestLocale(null, settings.locale)),
-                        error: true,
-                    });
-                } else {
-                    insertMessage.run('user', text, 'cli', '');
-                    broadcast('new_message', { role: 'user', content: text, source: 'cli' });
-                    orchestrateContinue({ origin: 'cli' });
-                }
-                return;
-            }
-
-            // Reset intent
-            if (isResetIntent(text)) {
-                if (activeProcess) {
-                    broadcast('agent_done', {
-                        text: t('ws.agentBusy', {}, resolveRequestLocale(null, settings.locale)),
-                        error: true,
-                    });
-                } else {
-                    insertMessage.run('user', text, 'cli', '');
-                    broadcast('new_message', { role: 'user', content: text, source: 'cli' });
-                    orchestrateReset({ origin: 'cli' });
-                }
-                return;
-            }
-
-            if (activeProcess) {
-                enqueueMessage(text, 'cli');
-            } else {
-                insertMessage.run('user', text, 'cli', '');
-                broadcast('new_message', { role: 'user', content: text, source: 'cli' });
-                orchestrate(text, { origin: 'cli' });
-            }
+
+            const result = submitMessage(text, { origin: 'cli' });
+            if (result.action === 'rejected' && result.reason === 'busy') {
+                broadcast('agent_done', {
+                    text: t('ws.agentBusy', {}, resolveRequestLocale(null, settings.locale)),
+                    error: true,
+                });
+            }
         }
         if (msg.type === 'stop') killAllAgents('ws');
     } catch (e) { console.warn('[ws:parse] message parse failed', { preview: String(raw).slice(0, 80) }); }
 });
```

### [MODIFY] `server.ts` L421-451 (REST /api/message)

```diff
 app.post('/api/message', (req, res) => {
     const { prompt } = req.body;
     if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });
-    const trimmed = prompt.trim();
-
-    // Continue intent는 큐에 넣지 않고 전용 경로로 처리
-    if (isContinueIntent(trimmed)) {
-        if (activeProcess) {
-            return res.status(409).json({ error: 'agent already running' });
-        }
-        orchestrateContinue({ origin: 'web' });
-        return res.json({ ok: true, continued: true });
-    }
-
-    // Reset intent
-    if (isResetIntent(trimmed)) {
-        if (activeProcess) {
-            return res.status(409).json({ error: 'agent already running' });
-        }
-        orchestrateReset({ origin: 'web' });
-        return res.json({ ok: true, reset: true });
-    }
-
-    if (activeProcess) {
-        enqueueMessage(trimmed, 'web');
-        return res.json({ ok: true, queued: true, pending: messageQueue.length });
-    }
-    insertMessage.run('user', trimmed, 'web', '');
-    broadcast('new_message', { role: 'user', content: trimmed, source: 'web' });
-    orchestrate(trimmed, { origin: 'web' });
-    res.json({ ok: true });
+
+    const result = submitMessage(prompt.trim(), { origin: 'web' });
+    if (result.action === 'rejected') {
+        return res.status(result.reason === 'busy' ? 409 : 400)
+            .json({ error: result.reason });
+    }
+    res.json({ ok: true, ...result });
 });
```

### [MODIFY] `bot.ts` L283-308 (tgOrchestrate busy 분기)

```diff
 async function tgOrchestrate(ctx: any, prompt: string, displayMsg: string) {
-    if (activeProcess) {
-        console.log('[tg:queue] agent busy, queueing message');
-        const { enqueueMessage } = await import('../agent/spawn.js');
-        enqueueMessage(prompt, 'telegram');
-        insertMessage.run('user', displayMsg, 'telegram', '');
-        broadcast('new_message', { role: 'user', content: displayMsg, source: 'telegram' });
-        await ctx.reply(t('tg.queued', { count: messageQueue.length }, currentLocale()));
+    const result = submitMessage(prompt, { origin: 'telegram', displayText: displayMsg });
+
+    if (result.action === 'queued') {
+        console.log(`[tg:queue] agent busy, queued (${result.pending} pending)`);
+        await ctx.reply(t('tg.queued', { count: result.pending }, currentLocale()));
 
         // 큐 처리 후 응답을 이 채팅으로 전달
         const queueHandler = (type: string, data: Record<string, any>) => {
@@ [큐 handler 동일 유지] @@
         };
         addBroadcastListener(queueHandler);
         setTimeout(() => removeBroadcastListener(queueHandler), 300000);
         return;
     }
 
+    if (result.action === 'rejected') {
+        await ctx.reply(`❌ ${result.reason}`);
+        return;
+    }
+
+    // ── result.action === 'started' → TG 출력 로직 진입 ──
     markChatActive(ctx.chat.id);
-    insertMessage.run('user', displayMsg, 'telegram', '');
-    broadcast('new_message', { role: 'user', content: displayMsg, source: 'telegram' });
 
     await ctx.replyWithChatAction('typing')
```

> [!IMPORTANT]
> **엣지케이스**: `submitMessage` 결과가 `queued`일 때 반드시 `return` 해야 TG 출력 로직으로 내려가지 않음.
> `rejected`도 마찬가지 — `continue` intent를 busy 중에 보냈을 때 TG에서 에러 메시지 노출.

### [MODIFY] `server.ts` import 추가

```diff
+import { submitMessage } from './src/orchestrator/gateway.js';
```

제거 가능 import (사용처 없어짐):
- `isContinueIntent`, `isResetIntent` — server.ts에서 직접 사용 안 함 (gateway.ts로 이동)
- `enqueueMessage` — server.ts에서 직접 사용 안 함

> [!WARNING]
> `server.ts` L454-468 `/api/orchestrate/continue|reset` 엔드포인트는 **submitMessage에 포함하지 않음**. 이 경로는 insertMessage 없이 orchestrate만 호출하는 전용 API.

### 엣지케이스

| # | 시나리오 | 현재 동작 | 변경 후 |
|---|---------|-----------|---------|
| E1 | 빈 문자열 전송 | WS: 무시, REST: 400, TG: 무시 | **통일**: `{ action: 'rejected', reason: 'empty' }` |
| E2 | busy + continue intent | WS: busy 에러 broadcast, REST: 409, TG: **큐잉(잘못됨)** | **통일**: `{ action: 'rejected', reason: 'busy' }` |
| E3 | busy + reset intent | 동일 | **통일**: `{ action: 'rejected', reason: 'busy' }` |
| E4 | busy + normal message | WS: enqueue 후 broadcast 없음, REST: enqueue+응답, TG: **enqueue+insert(이중)** | **통일**: enqueue만, insert 안 함 |
| E5 | idle + continue | WS: insert+orchestrateContinue, REST: orchestrateContinue(insert없음!), TG: insert+orchestrateAndCollect | **통일**: insert+orchestrateContinue |
| E6 | idle + normal | 동일 | 동일 |

> [!CAUTION]
> **E5 REST 버그 발견**: 현재 REST `/api/message`에서 `isContinueIntent` 분기는 `insertMessage` 없이 `orchestrateContinue`만 호출 → user 메시지가 DB에 안 남음. `submitMessage`로 통합 시 자동 수정.

---

## Phase B: orchestrateAndCollect 분리 + TG 출력 확장

### [NEW] `src/orchestrator/collect.ts`

`bot.ts:35-80` 에서 `orchestrateAndCollect`를 이동.

```typescript
import { addBroadcastListener, removeBroadcastListener } from '../core/bus.js';
import { orchestrate, orchestrateContinue, orchestrateReset, isContinueIntent, isResetIntent } from './pipeline.js';
import { t } from '../core/i18n.js';
import { normalizeLocale } from '../core/i18n.js';

export function orchestrateAndCollect(
    prompt: string,
    meta: Record<string, any> = {},
    locale: string = 'ko'
): Promise<string> {
    return new Promise((resolve) => {
        let collected = '';
        let timeout: ReturnType<typeof setTimeout>;
        const IDLE_TIMEOUT = 1200000;

        function resetTimeout() {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                removeBroadcastListener(handler);
                resolve(collected || t('tg.timeout', {}, locale));
            }, IDLE_TIMEOUT);
        }

        const handler = (type: string, data: Record<string, any>) => {
            if (['agent_chunk', 'agent_tool', 'agent_status',
                 'agent_done', 'agent_fallback',
                 'round_start', 'round_done'].includes(type)) {
                resetTimeout();
            }
            // ❌ agent_output 제거 — broadcast에서 해당 이벤트 발생 안 함 (dead branch)
            if (type === 'agent_done' && data.error && data.text) {
                collected = collected || data.text;
            }
            if (type === 'orchestrate_done') {
                if (meta?.origin && data?.origin && data.origin !== meta.origin) return;
                clearTimeout(timeout);
                removeBroadcastListener(handler);
                resolve(data.text || collected || t('tg.noResponse', {}, locale));
            }
        };
        addBroadcastListener(handler);
        const run = isResetIntent(prompt)
            ? orchestrateReset(meta)
            : isContinueIntent(prompt)
                ? orchestrateContinue(meta)
                : orchestrate(prompt, meta);
        Promise.resolve(run).catch(err => {
            clearTimeout(timeout);
            removeBroadcastListener(handler);
            resolve(`❌ ${err.message}`);
        });
        resetTimeout();
    });
}
```

> [!NOTE]
> `agent_output` 수신 분기 제거 — 현재 코드 전체에서 `broadcast('agent_output', ...)` 호출처 없음 (dead branch).

### [MODIFY] `bot.ts` L35-80

```diff
-export function orchestrateAndCollect(prompt: string, meta: Record<string, any> = {}) {
-    // ... 46줄 전체 제거
-}
+// Re-export for backward compatibility
+export { orchestrateAndCollect } from '../orchestrator/collect.js';
```

### [MODIFY] `heartbeat.ts` L5

```diff
-import { orchestrateAndCollect, markdownToTelegramHtml, chunkTelegramMessage, telegramBot, telegramActiveChatIds } from '../telegram/bot.js';
+import { orchestrateAndCollect } from '../orchestrator/collect.js';
+import { markdownToTelegramHtml, chunkTelegramMessage, telegramBot, telegramActiveChatIds } from '../telegram/bot.js';
```

### [MODIFY] `forwarder.ts` — 출력 이벤트 확장 (선택)

```diff
 export function createTelegramForwarder({
     bot, getLastChatId,
     shouldSkip = (_data: any) => false,
     log = (_info: any) => {},
     prefix = '📡 ',
+    handleTyping = false,
 }: Record<string, any> = {}) {
     return (type: string, data: Record<string, any>) => {
-        if (type !== 'agent_done' || !data?.text) return;
+        // typing 표시
+        if (handleTyping && type === 'agent_status' && data.status === 'running') {
+            const chatId = typeof getLastChatId === 'function' ? getLastChatId() : null;
+            if (chatId && !shouldSkip(data)) {
+                bot.api.sendChatAction(chatId, 'typing').catch(() => {});
+            }
+            return;
+        }
+
+        if (type !== 'agent_done' || !data?.text) return;
         if (data.error) return;
         if (shouldSkip(data)) return;
```

---

## Phase C: CommandContext 통합

### 목표

`makeWebCommandCtx` (server.ts:329-367) + `makeTelegramCommandCtx` (bot.ts:149-202) → 단일 팩토리.

### 차이 분석

| 기능 | Web | TG | 통합 방안 |
|------|:---:|:---:|-----------|
| `updateSettings` | 전체 patch 허용 | fallbackOrder만 허용 | **interface 기준 분기** |
| `getMcp` | `loadUnifiedMcp()` | `{ servers: {} }` | **통합: 항상 loadUnifiedMcp()** |
| `syncMcp` | `syncToAll(...)` | `{ results: {} }` | **통합: 항상 syncToAll()** |
| `installMcp` | 설치+동기화 | `{ results: {} }` | **통합: 항상 설치** |
| `resetSkills` | copyDefaultSkills+regenerate | **없음** | **통합: 항상 가능** |
| `getPrompt` | A2 파일 내용 | "지원안함" 메시지 | **통합: 항상 파일 내용** |
| `resetEmployees` | seedDefaults | **없음** | **통합: 항상 가능** |

### [NEW] `src/cli/command-context.ts`

```typescript
export function makeCommandCtx(opts: {
    interface: 'web' | 'telegram' | 'cli';
    locale: string;
    req?: any; // express request (web only)
}): CommandContext {
    return {
        interface: opts.interface,
        locale: opts.locale,
        version: APP_VERSION,
        getSession,
        getSettings: () => settings,
        updateSettings: async (patch) => {
            // TG: fallbackOrder만 허용, 나머지 reject
            if (opts.interface === 'telegram') {
                if (patch.fallbackOrder !== undefined && Object.keys(patch).length === 1) {
                    replaceSettings({ ...settings, ...patch });
                    saveSettings(settings);
                    return { ok: true };
                }
                return { ok: false, text: t('tg.settingsUnsupported', {}, opts.locale) };
            }
            return applySettingsPatch(patch, { restartTelegram: true });
        },
        getRuntime: getRuntimeSnapshot,
        getSkills: getMergedSkills,
        clearSession: async () => clearSessionState(),
        getCliStatus: () => detectAllCli(),
        getMcp: () => loadUnifiedMcp(),                          // ← TG에서도 실제 MCP 반환
        syncMcp: async () => ({ results: syncToAll(loadUnifiedMcp(), settings.workingDir) }),
        installMcp: async () => { /* 설치 로직 */ },
        listMemory: () => memory.list(),
        searchMemory: (q) => memory.search(q),
        getBrowserStatus: async () => browser.getBrowserStatus(settings.browser?.cdpPort || 9240),
        getBrowserTabs: async () => ({ tabs: await browser.listTabs(settings.browser?.cdpPort || 9240) }),
        resetEmployees: async () => seedDefaultEmployees({ reset: true, notify: true }),
        resetSkills: async () => { copyDefaultSkills(); /* ... */ },
        getPrompt: () => {
            const a2 = fs.existsSync(A2_PATH) ? fs.readFileSync(A2_PATH, 'utf8') : '';
            return { content: a2 };
        },
    };
}
```

### [MODIFY] `server.ts` L329-367

```diff
-function makeWebCommandCtx(req: any, localeOverride: string | null = null) {
-    return { /* 38줄 */ };
-}
+import { makeCommandCtx } from './src/cli/command-context.js';
```

L391: `makeWebCommandCtx(req, locale)` → `makeCommandCtx({ interface: 'web', locale, req })`

### [MODIFY] `bot.ts` L149-202

```diff
-function makeTelegramCommandCtx() {
-    return { /* 53줄 */ };
-}
+import { makeCommandCtx } from '../cli/command-context.js';
```

사용처: `makeTelegramCommandCtx()` → `makeCommandCtx({ interface: 'telegram', locale: currentLocale() })`

---

## 테스트 계획

### [NEW] `tests/unit/submit-message.test.ts` — 10 cases

```
SM-001: 빈 문자열 → rejected/empty
SM-002: idle + normal → started (insertMessage 호출 확인)
SM-003: busy + normal → queued (insertMessage 미호출 확인)
SM-004: idle + continue intent → started + orchestrateContinue
SM-005: busy + continue intent → rejected/busy
SM-006: idle + reset intent → started + orchestrateReset
SM-007: busy + reset intent → rejected/busy
SM-008: displayText 전달 확인 (TG용)
SM-009: pending 카운트 정확성
SM-010: origin 값이 broadcast에 전달됨
```

실행: `npx tsx --test tests/unit/submit-message.test.ts`

### [NEW] `tests/unit/command-context.test.ts` — 5 cases

```
CC-001: web context → getMcp가 실제 config 반환
CC-002: telegram context → getMcp도 실제 config 반환 (기존 빈 값 아님)
CC-003: telegram context → updateSettings, fallbackOrder 이외 reject
CC-004: web context → updateSettings 전체 patch 허용
CC-005: resetSkills 양쪽 동일 동작
```

실행: `npx tsx --test tests/unit/command-context.test.ts`

### 기존 테스트 (통과 필수)

```bash
npx tsx --test tests/telegram-forwarding.test.ts     # forwarder 9건 (Phase B 변경 영향)
npx tsx --test tests/unit/bus.test.ts                # broadcast 5건
npx tsx --test tests/events.test.ts                  # 이벤트 흐름
npx tsx --test tests/integration/api-smoke.test.ts   # REST API (/api/message 변경 영향)
npx tsx --test tests/unit/heartbeat-queue.test.ts    # heartbeat (import 경로 변경)
```

### Typecheck

```bash
npx tsc --noEmit    # 전체 타입 체크
```

### 수동 검증

1. `jaw serve` → WebUI에서 메시지 → 정상 응답
2. busy 중 메시지 → 큐잉 후 순서대로 처리, DB에 **1번만** 저장
3. Telegram에서 메시지 → typing + 응답
4. WebUI 메시지 → Telegram에 결과 전달 (`📡` prefix)
5. Telegram에서 `/mcp` → **실제 MCP 서버 목록** 반환 (기존: `{ servers: {} }`)
