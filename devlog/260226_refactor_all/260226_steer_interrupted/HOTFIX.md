# Steer Interrupted — Hotfix: 회귀 테스트 추가

**Date**: 2026-02-26  
**Status**: ✅ **구현 완료** — 15 tests pass  
**선행**: steer_interrupted 구현 완료 (코드 반영됨)  

---

## 현재 상태

✅ **코드 구현 완료** — `spawn.ts`에 아래 변경이 반영됨:
- `killReason` 변수 추가 (L40)
- ACP exit 핸들러에서 `wasSteer` → `⏹️ [interrupted]` 태깅 (L393, L422-428)
- Standard CLI close 핸들러 동일 적용 (L545, L581-586)
- steer 시 fallback 억제 (`&& !wasSteer`, L442, L601)
- trace에도 interrupted 태그 추가 (L426, L585)

✅ **회귀 테스트 완료** — 15/15 pass, 전체 329/328/0/1.

---

## 테스트 파일

### `tests/unit/steer-interrupted.test.ts` — 11 cases

| ID | 케이스 | 결과 |
|---:|--------|:---:|
| SI-001 | killActiveAgent('steer') → killReason 설정 | ✅ |
| SI-002 | killActiveAgent default reason = 'user' | ✅ |
| SI-003 | ACP exit (wasSteer+fullText) → '⏹️ [interrupted]' | ✅ |
| SI-004 | ACP exit (wasSteer+trace) → trace에도 접두사 | ✅ |
| SI-005 | ACP exit (wasSteer) → fallback 억제 | ✅ |
| SI-006 | CLI close (wasSteer) → interrupted 태깅 | ✅ |
| SI-007 | killReason 소비 (exit 후 null) | ✅ |
| SI-STRUCT | ACP/CLI 대칭 구조 검증 | ✅ |
| — | steerAgent calls killActiveAgent('steer') | ✅ |
| — | steerAgent insert + broadcast 순서 | ✅ |
| — | buildHistoryBlock trace 우선 | ✅ |

### `tests/unit/steer-flow.test.ts` — 4 cases

| ID | 케이스 | 결과 |
|---:|--------|:---:|
| SF-001 | steerAgent flow: kill → wait → insert → orchestrate | ✅ |
| SF-002 | exit handler → interrupted → insertMessageWithTrace 순서 | ✅ |
| SF-003 | buildHistoryBlock trace 경로로 interrupted 보존 | ✅ |
| SF-EDGE | processQueue() 양쪽 경로에서 호출 | ✅ |

---

## ⚠️ 테스트 한계

> [!WARNING]
> 현재 15건은 모두 **소스 문자열 존재 검증** (source inspection) 방식.
> `killReason`이 모듈 내부 변수이고, exit handler가 `spawnAgent` 내부 클로저이므로
> 외부에서 직접 동작 검증이 불가. 이 한계는 프로젝트 기존 패턴(`fallback-retry.test.ts`)과 동일.
>
> **리팩터링/주석 이동만으로도 통과할 수 있어 회귀 방지 신뢰도 낮음.**
>
> Phase 1 `submitMessage()` 게이트웨이 구현 시, `killActiveAgent` export를 활용한
> **실제 동작 검증 테스트** 추가 권장:
> - `killActiveAgent('steer')` 호출 후 mock process exit fire → DB insert 결과 검증
> - `steerAgent()` 호출 후 실제 `insertMessage` 호출 여부 spy 검증

---

## 검증

```bash
npx tsx --test tests/unit/steer-interrupted.test.ts tests/unit/steer-flow.test.ts
npx tsx --test tests/*.test.ts tests/**/*.test.ts  # 전체 회귀
```

결과: 기존 314 + 신규 15건 = **tests 329 / pass 328 / fail 0 / skipped 1**


