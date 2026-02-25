# cli-claw TypeScript Migration Plan
> Created: 2026-02-25

## 현황
- 소스: 49개 .ts 파일 (이미 .js → .ts 리네임 완료)
- TSC 에러: ~1,100개
- 주요 에러: TS7006(any param 423), TS18046(unknown 261), TS2339(missing prop 223)

## Phase 전략: 리프 → 코어 순서 (의존성 역순)

### Phase 1: Types & Config 기반 구축
- `types/global.d.ts` 확장 — Express, WS, 공통 인터페이스
- tsconfig.json 검증

### Phase 2: Core 모듈 (6파일, ~43 errors)
db → logger → settings-merge → bus → i18n → config
+ security (decode, path-guards)

### Phase 3: HTTP & Command-Contract (6파일, ~23 errors)
async-handler → response → error-middleware
catalog → policy → help-renderer

### Phase 4: Memory (3파일, ~35 errors)
memory → heartbeat → worklog

### Phase 5: Agent (3파일, ~124 errors)
args → events → spawn

### Phase 6: Browser (3파일, ~64 errors)
connection → actions → vision

### Phase 7: CLI & Prompt (5파일, ~193 errors)
registry → commands → handlers → acp-client → builder

### Phase 8: Orchestrator & Telegram (4파일, ~183 errors)
parser → pipeline → forwarder → bot

### Phase 9: Routes, Lib, Server (6파일, ~217 errors)
quota → browser-routes → quota-copilot → upload → mcp-sync → server

### Phase 10: Bin Commands (12파일, ~250 errors)
postinstall → status → skill → employee → reset → serve
→ doctor → mcp → memory → init → browser → chat

## 완료 기준
- `npx tsc --noEmit` → 0 errors
- 기존 동작 보존 (타입만 추가, 로직 변경 없음)
