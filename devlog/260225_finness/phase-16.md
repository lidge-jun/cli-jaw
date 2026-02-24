# Phase 16 — 오케스트레이션 done 응답 누락 + 코드블럭 하이라이팅 + 토큰 낭비

> Bug 1: ✅ 완료 (ws.js +2L, ui.js +6L) · Bug 2: 🔄 다른 에이전트 진행중 · Bug 3: 🔜 추후 논의

> 주니 보고: "phase 들어가기전에만 응답이 오고, done에서 응답이 안와"
> 추가: 코드블럭 색깔 없음, 복사 버튼 없음, 오케스트레이션 토큰 낭비

---

## Bug 1: `orchestrate_done` 응답이 UI에 안 나옴 🔴

### 원인

`ws.js`에 **`orchestrate_done` 이벤트 핸들러가 없음**.

```js
// ws.js — 현재 핸들러 목록
agent_status    → setStatus()
queue_update    → updateQueueBadge()
worklog_created → addSystemMsg()
round_start     → addSystemMsg()
round_done      → addSystemMsg()
agent_tool      → addSystemMsg()
agent_output    → appendAgentText()
agent_done      → finalizeAgent()  ← 유일한 텍스트 렌더링 경로
// ❌ orchestrate_done → ??? (handled nowhere!)
```

`orchestrator.js`에서 `orchestrate_done`은 **8곳**에서 broadcast:
- L472: triage direct → `{ text }` 
- L481: no employees → `{ text }`
- L495: planning direct_answer → `{ text }`
- L500: no subtasks → `{ text }`
- L536: round loop allDone → `{ text, worklog }`
- L552: max round partial → `{ text, worklog }`
- L563/569: continue 경로 → `{ text }`

**문제**: 일부 경로에서만 `agent_done`도 함께 broadcast (L494). L536/L552 (미니멀 오케스트레이션 완료) 경로에서는 `orchestrate_done`만 broadcast → UI 무반응.

### 수정 방안

**Option A**: `ws.js`에 `orchestrate_done` 핸들러 추가 → `finalizeAgent(msg.text)` 호출

```js
// ws.js — 추가
} else if (msg.type === 'orchestrate_done') {
    finalizeAgent(msg.text);
}
```

**Option B**: `orchestrator.js`에서 `orchestrate_done` 전에 항상 `agent_done` broadcast

→ **Option A 추천** (프론트 1줄 수정, 백엔드 무변경)

> [!CAUTION]
> `agent_done`과 `orchestrate_done`이 **동시에** 오는 경로(L494-495)에서 이중 렌더링 방지 필요.
> → `finalizeAgent()`에 guard 추가: 이미 finalize된 상태면 무시.

---

## Bug 2: 코드블럭 syntax highlighting 안 나옴 🟡

### 현재 구조

```text
index.html:  <script defer src="hljs@11/highlight.min.js" onload="...rehighlightAll()">
render.js:   renderer.code = function({ text, lang }) { if (typeof hljs !== 'undefined') ... }
             rehighlightAll() → document.querySelectorAll('.code-block-wrapper pre code')
```

### 가능한 원인 (조사 결과)

1. **CDN 로딩 실패/타임아웃**: `defer` + CDN → 네트워크 느리면 `hljs === undefined`
2. **`hljs.getLanguage(lang)` false 반환**: highlight.min.js 기본 번들은 ~40개 언어만 포함. `sql`, `bash` 등은 포함이지만, 일부 언어는 미포함
3. **`rehighlightAll()` 호출 시 DOM에 코드블럭 없음**: 이미 loaded 기존 메시지(`loadMessages()`)는 `hljs` 앞서 렌더돼서 `escapeHtml` 폴백 → `rehighlightAll`이 보정해야 하는데 `el.dataset.highlighted` 체크가 문제?

### 수정 방안

1. **CDN 폴백 강화**: `onload` + `onerror` (CDN 실패 시 로컬 번들 시도)
2. **`rehighlightAll()` 개선**: `data-highlighted` 체크 제거 → 모든 `.hljs` 코드블럭 재처리
3. **`ensureMarked()` 이후 hljs 가용 시 재렌더**: `markedReady` 상태에서 `hljs` 미감지 → 다음 메시지에서 재시도 자동

```diff
 // render.js rehighlightAll()
 export function rehighlightAll() {
     if (typeof hljs === 'undefined') return;
     document.querySelectorAll('.code-block-wrapper pre code').forEach(el => {
-        if (el.dataset.highlighted) return;
         const lang = el.className.match(/language-(\w+)/)?.[1];
         if (lang && hljs.getLanguage(lang)) {
             try { hljs.highlightElement(el); } catch { }
+        } else {
+            try { hljs.highlightElement(el); } catch { }
         }
     });
 }
```

### 복사 버튼 현황

**이미 구현됨** ✅ (`render.js` L147-170, `markdown.css` L140-162):
- `.code-lang-label` 클릭 → `navigator.clipboard.writeText` → "복사됨 ✓" 피드백
- CSS: `cursor: pointer`, hover scale, `.copied` 색상 변경
- 언어 없는 코드블럭은 `labelText = '복사'`로 표시

→ **hljs 문제 해결되면 복사 기능도 살아남** (DOM 구조는 이미 정상)

---

## Bug 3: 오케스트레이션 토큰 낭비 🟠

### 원인 분석

| 낭비 지점 | 코드 위치 | 영향 |
|-----------|----------|------|
| 매 spawn마다 `getSystemPrompt()` 풀 재생성 | `agent.js:226` | 스킬 레지스트리 + MEMORY + 직원 매회 재조립 |
| sub-agent에 풀 프롬프트 이중 주입 | Claude `--append-system-prompt` + AGENTS.md 이중 | 토큰 2배 |
| phase마다 스킬 파일 disk I/O | `prompt.js:430-455` `readFileSync` | 3 agents × 5 phases = 15회 |
| review에서 결과 재전송 | `orchestrator.js:401-403` 400자×N + matrix | 매 라운드 반복 |

**최악**: 3 agents × 5 phases × 3 rounds + 3 plan + 3 review = **51회** spawn.

### 수정 방안

1. **sub-agent prompt 캐싱**: 같은 role 에이전트는 orchestrate() 내에서 1회 생성 후 재사용
2. **스킬 파일 메모리 캐싱**: `getSubAgentPromptV2()`에서 `readFileSync` → 캐시 (orchestration 단위)
3. **`agent.js` 빈 문자열 sysPrompt 처리**: `customSysPrompt || getSystemPrompt()` → `customSysPrompt != null ? customSysPrompt : getSystemPrompt()`
4. **review 결과 압축**: 200자 + 완료 에이전트 생략

---

## 구현 계획

| # | 작업 | 파일 | 영향 |
|---|------|------|------|
| 1 | `orchestrate_done` 핸들러 추가 | `ws.js` | 프론트 2줄 추가 |
| 2 | `finalizeAgent()` 이중 호출 guard | `ui.js` | 프론트 3줄 추가 |
| 3 | `rehighlightAll()` 개선 | `render.js` | `data-highlighted` 제거 |
| 4 | sub-agent prompt 캐싱 | `orchestrator.js` | `distributeByPhase` 내 |
| 5 | 스킬 파일 캐싱 | `prompt.js` | 모듈 변수 캐시 |
| 6 | sysPrompt null 체크 수정 | `agent.js` | 1줄 수정 |
| 7 | review 결과 압축 | `orchestrator.js` | 400→200자 |

### 우선순위

**P0 (즉시)**: #1, #2 — done 응답이 안 나오는 건 사용자 경험 치명적
**P1 (같은 날)**: #3 — 코드블럭 색깔 없는 것도 시각적으로 중요
**P2 (다음)**: #4~#7 — 토큰 비용 최적화

---

## 검증

```bash
# 기존 테스트 회귀 확인
cd /Users/junny/Documents/BlogProject/cli-claw && npm test

# P0 수동 검증
# 1. 서버 기동 → 오케스트레이션 필요한 메시지 전송 → UI에 완료 응답 나오는지 확인
# 2. 코드블럭 포함 메시지 전송 → 색깔 나오는지 확인
# 3. 언어 라벨 클릭 → 복사되는지 확인
```
