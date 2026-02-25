# ACP Parity Fixes — 2025-02-25

Copilot ACP(JSON-RPC) 브랜치가 Standard CLI(NDJSON) 브랜치와 동일한 기능을 갖도록 4개 패치 적용.

## 수정 내용

### 1. ACP Timeout — idle=max=20min → idle=20min, max=4h

**파일**: `src/cli/acp-client.js` (L285), `src/cli/acp-client.ts` (L298)

`prompt()` 호출 시 `1200000, 1200000`으로 idle=max=20분 오버라이드 → activity-based timeout 무효화.

```diff
- }, 1200000, 1200000); // idle 20min, max 20min
+ }, 1200000, 14400000); // idle 20min, max 4h
```

### 2. 정지 버튼 — Employee 프로세스 kill 불가

**파일**: `src/agent/spawn.js`, `src/agent/spawn.ts`, `server.js`, `server.ts`

`activeProcess` 단일 변수 → employee(`mainManaged=false`)는 추적 안 됨.

- `activeProcesses = new Map()` 추가 (agentId → child process)
- `killAllAgents()` 함수 추가 — Map 전체 순회 SIGTERM → 2s 후 SIGKILL
- 정지 버튼/API stop/shutdown → `killAllAgents()` 사용

### 3. History(메모리) 주입 누락

**파일**: `src/agent/spawn.js` (L359), `src/agent/spawn.ts` (L374)

ACP 브랜치에서 `acp.prompt(prompt)` — raw prompt만 전송, `buildHistoryBlock()`으로 만든 최근 메시지 미포함.

```diff
- const { promise: promptPromise } = acp.prompt(prompt);
+ const acpPrompt = isResume ? prompt : withHistoryPrompt(prompt, historyBlock);
+ const { promise: promptPromise } = acp.prompt(acpPrompt);
```

### 4. Memory Flush 트리거 누락

**파일**: `src/agent/spawn.js` (L403), `src/agent/spawn.ts` (L418)

ACP exit handler에서 `memoryFlushCounter++`만 있고 threshold 체크 + `triggerMemoryFlush()` 없음 → copilot 세션에서 메모리 자동 저장 안 됨.

```diff
  memoryFlushCounter++;
+ const threshold = settings.memory?.flushEvery ?? 20;
+ if (settings.memory?.enabled !== false && memoryFlushCounter >= threshold) {
+     memoryFlushCounter = 0;
+     flushCycleCount++;
+     triggerMemoryFlush();
+ }
```

## 테스트

- `node --test tests/acp-client.test.js tests/events.test.js tests/unit/fallback-retry.test.js` → 23/23 pass
