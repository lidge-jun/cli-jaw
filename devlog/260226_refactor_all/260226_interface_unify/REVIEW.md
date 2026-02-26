# REVIEW — Interface Unification PLAN.md 검증 결과

> Date: 2026-02-26
> Reviewer: 코드 대조 기반 자동 검증
> Status: **6건 모두 확인됨, PLAN.md 수정 필요**

---

## 검증 결과 요약

| # | 심각도 | 지적사항 | 검증 결과 | 근거 |
|---|:---:|---------|:---:|------|
| 1 | 🔴 치명 | `orchestrateAndCollect` 제거 시 컴파일 깨짐 | **확인** | `heartbeat.ts:5,47`에서 import + 호출 |
| 2 | 🔴 치명 | `agent_tool/status`에 origin 필드 없음 | **확인** | `spawn.ts:298,303,321` — origin 없이 broadcast |
| 3 | 🟠 높음 | `getLastChatId` → 다중 채팅 오발송 | **확인** | `bot.ts` — ctx.chat.id 보장 사라짐 |
| 4 | 🟠 높음 | busy 분기 insert 중복 | **확인** | `processQueue():109`이 insert 수행 → 이중 저장 |
| 5 | 🟡 중간 | 문서 내부 설계 충돌 | **확인** | §6 Phase B vs §9.2 TG-004 모순 |
| 6 | 🟡 중간 | `/api/orchestrate/*` 계약 변경 리스크 | **확인** | `server.ts:454-468` 단순 트리거 API |

---

## 상세 검증

### 🔴 치명 1: `orchestrateAndCollect` 제거 불가

```
heartbeat.ts:5  → import { orchestrateAndCollect, ... } from '../telegram/bot.js';
heartbeat.ts:47 → const result = await orchestrateAndCollect(prompt);
```

**해결**: 제거 대신 **공용 유틸로 분리** (`src/orchestrator/collect.ts`).
heartbeat.ts와 tgOrchestrate 모두 이 유틸을 import.

### 🔴 치명 2: 중간 이벤트에 origin 없음

broadcast 호출 시 origin 포함 여부:

| 이벤트 | 호출 위치 | origin 포함? |
|--------|-----------|:---:|
| `agent_status` | `spawn.ts:298,303` | ❌ `{ running, agentId, cli }` |
| `agent_tool` | `spawn.ts:321,345` | ❌ `{ agentId, ...tool }` |
| `agent_tool` | `events.ts:44` | ❌ `{ agentId, ...toolLabel }` |
| `agent_done` | `spawn.ts:통해 broadcast` | ❌ agentId만 |
| `orchestrate_done` | `pipeline.ts:316,429` | ✅ `{ text, origin, worklog }` |

**결론**: `shouldSkip(data.origin === 'telegram')` 필터링은 `orchestrate_done`에서만 가능. 
중간 이벤트(`agent_status`, `agent_tool`)에서는 origin 기반 skip 불가.

**해결 방안 2가지**:
- **(A)** `spawnAgent`에 origin을 전달하여 모든 broadcast에 포함 → 변경 범위 큼
- **(B)** forwarder에서 **origin 대신 "활성 TG 세션" 상태 변수**로 skip 결정 → 변경 범위 작음

### 🟠 높음 3: chat 라우팅 문제

현재:
- 직접 입력: `ctx.chat.id` → **정확한 채팅에 응답**
- forwarder: `getLastChatId()` → **마지막 활성 채팅에만 전달**

Phase B에서 직접 입력도 output handler로 통합하면:
- `ctx.chat.id` 보장 상실
- 동시 2명이 TG에서 메시지 보내면 → 한쪽에만 응답

**해결**: 직접 TG 입력은 **기존 `tgOrchestrate` → `ctx.reply()` 경로 유지**.
output handler는 **다른 인터페이스 → TG 전달**에만 사용.

### 🟠 높음 4: 큐 메시지 이중 저장

현재 동작 (인터페이스별):

| 경로 | enqueue 시 insert? | processQueue 시 insert? | 결과 |
|------|:---:|:---:|------|
| WS handler (L220) | ❌ | ✅ (spawn.ts:109) | 정상 |
| REST (L444) | ❌ | ✅ | 정상 |
| **TG bot (L288-289)** | **✅** | **✅** | **⚠️ 이미 이중 저장!** |

**발견**: TG bot은 **현재도 이중 저장 버그 있음** (enqueue + processQueue 양쪽에서 insert).

PLAN의 `submitMessage()`가 모든 경로에서 busy 분기에서도 insert하면 → WS/REST도 이중 저장으로 확산.

**해결**: `submitMessage()`에서 busy 분기일 때 `insertMessage` 호출하지 않음.
큐 처리는 `processQueue()`의 `insertMessage.run`에 맡김.
TG bot의 기존 이중 저장도 함께 수정.

### 🟡 중간 5: 문서 내부 모순

| 위치 | 내용 | 모순 |
|------|------|------|
| §6 Phase B | "tgOrchestrate 출력 로직 → output handler 이동, orchestrateAndCollect 제거" | 직접 입력도 통합 |
| §9.2 TG-004 | "origin=telegram → shouldSkip (직접 입력은 tgOrchestrate가 처리)" | 직접 입력은 제외 |

**해결**: §9.2가 맞음. 직접 TG 입력은 `tgOrchestrate` 유지 (높음3 해결과 일치).
output handler는 다른 인터페이스 → TG 전달 전용.
§6 Phase B 설명 수정 필요.

### 🟡 중간 6: `/api/orchestrate/*` 별도 유지

```typescript
// server.ts:454-468 — 단순 트리거 API (텍스트 입력 아님)
app.post('/api/orchestrate/continue', (req, res) => {
    if (activeProcess) return res.status(409)…;
    orchestrateContinue({ origin: 'web' });
    res.json({ ok: true });
});
```

`submitMessage()`로 합치면:
- intent 감지 필요 → "continue" 같은 텍스트를 보내야 함 → 계약 변경
- WebUI의 "이어서" 버튼이 이 API를 직접 호출 중일 수 있음

**해결**: `/api/orchestrate/continue|reset`은 **별도 유지**. `submitMessage()`에 포함하지 않음.

---

## 수정된 설계 결정

| # | 항목 | 기존 PLAN | 수정안 |
|---|------|-----------|--------|
| 1 | `orchestrateAndCollect` | 제거 | **`src/orchestrator/collect.ts`로 분리** |
| 2 | 중간 이벤트 skip | origin 기반 | **활성 TG 세션 변수 기반** 또는 **origin 전파** |
| 3 | TG 직접 입력 출력 | output handler 통합 | **기존 `tgOrchestrate` → `ctx.reply()` 유지** |
| 4 | busy 분기 insert | 모든 경로에서 즉시 insert | **enqueue만, insert는 `processQueue()`에서** |
| 5 | 문서 내부 모순 | 양 방향 혼재 | **output handler = 다른 IF → TG 전달 전용** |
| 6 | `/api/orchestrate/*` | submitMessage 통합 | **별도 유지** |
