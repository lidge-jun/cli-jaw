# Steer 중단 시 Partial Output 저장

> 날짜: 2026-02-26  
> 파일: `src/agent/spawn.ts`  
> Status: ✅ **코드 구현 완료** | 🟠 **회귀 테스트 미작성**  
> Hotfix: [HOTFIX.md](file:///Users/junny/Documents/BlogProject/cli-jaw/devlog/260226_steer_interrupted/HOTFIX.md) — 테스트 추가 계획

---

## 배경

`steerAgent()` 호출 시 `killActiveAgent('steer')` → SIGTERM으로 현재 에이전트를 종료한다.
종료된 에이전트의 partial output(NDJSON 파싱 결과, ACP 중간 결과)이 DB에 저장되지 않는 문제 발견.

## 원인 분석

- close/exit 핸들러에서 `ctx.fullText`에 내용이 있으면 `insertMessageWithTrace`로 DB 저장하는 로직은 **이미 존재**
- 하지만 두 가지 문제:
  1. **steer 킬과 진짜 에러 구분 불가**: `ctx.fullText`가 비어있고 exit code ≠ 0이면 fallback 시도 → 의도적 kill인데 오동작
  2. **interrupted 구분 불가**: 저장된 메시지가 정상 응답과 동일하게 보임 → history block에서 맥락 손실

## 수정 내용

### 1. `killReason` 변수 추가 (L40)

```typescript
let killReason: string | null = null;
```

`killActiveAgent()` 호출 시 reason 기록.

### 2. ACP exit 핸들러 수정 (L389-431)

- `wasSteer = killReason === 'steer'` 체크
- `ctx.fullText` 있으면 `⏹️ [interrupted]\n\n` 접두사 붙여서 저장
- fallback 조건에 `&& !wasSteer` 추가 → steer 시 fallback 억제

### 3. Standard CLI close 핸들러 수정 (L531-579)

- 동일 패턴 적용

## 효과

- steer 후 다음 에이전트가 `buildHistoryBlock()`으로 history를 읽을 때, 이전 에이전트의 중단된 결과가 `⏹️ [interrupted]` 태그와 함께 포함됨
- 불필요한 fallback 시도 방지

### 4. trace에도 interrupted 태그 추가 (후속 패치)

`buildHistoryBlock()` L149에서 assistant 메시지는 `row.trace`가 있으면 content 대신 **trace만 사용**.
표준 CLI 경로(claude/codex/gemini/opencode)는 `logEventSummary()` → `pushTrace()` 경유로 거의 항상 trace가 쌓임.
→ content에만 `⏹️ [interrupted]` 붙여도 history에서 안 보이는 버그.

수정: `traceText`에도 동일하게 `⏹️ [interrupted]\n` 접두사 추가.

```typescript
// 수정 전
const traceText = ctx.traceLog.join('\n');

// 수정 후
let traceText = ctx.traceLog.join('\n');
if (wasSteer && mainManaged && !opts.internal) {
    if (traceText) traceText = `⏹️ [interrupted]\n${traceText}`;
}
```

## 테스트

```
# tests 314 / pass 313 / fail 0 / skipped 1
```
