# 🦞 CLI-Claw

CLI 래핑 기반 시스템 에이전트. Claude Code, Codex, Gemini CLI를 단일 인터페이스로 제어.

## Quick Start

```bash
cd 700_projects/cli-claw
npm install
npm run dev        # → http://localhost:3456
```

## Architecture

```
┌─────────────┐     ┌──────────┐     ┌──────────────┐
│  🌐 Web UI  │────▶│          │────▶│ Claude Code  │
│  📱 Telegram│────▶│ Gateway  │────▶│ Codex        │
│  📟 CLI     │────▶│ (server) │────▶│ Gemini CLI   │
└─────────────┘     └──────────┘     └──────────────┘
                         │
                    ┌────┴────┐
                    │ SQLite  │
                    │ session │
                    │ messages│
                    │ memory  │
                    └─────────┘
```

## Prompt System (A-1/A-2/B)

```
~/.cli-claw/prompts/
├── A-1.md          ← 코어 시스템 프롬프트 (불변)
├── A-2.md          ← 유저 설정 (UI에서 수정)
├── B.md            ← A-1+A-2 합성 (자동, 정적 CLI용)
└── HEARTBEAT.md    ← 주기적 체크리스트
```

| CLI      | 주입 방식                  | Compact 안전 |
| -------- | -------------------------- | ------------ |
| Claude   | `--append-system-prompt`   | ✅            |
| Gemini   | `--system-instruction`     | ✅            |
| Codex    | `codex.md` → B.md symlink  | ✅            |
| OpenCode | `AGENTS.md` → B.md symlink | ✅            |

## API

| Method  | Path                | Description                 |
| ------- | ------------------- | --------------------------- |
| GET     | `/api/session`      | 현재 세션 상태              |
| GET     | `/api/messages`     | 메시지 히스토리             |
| POST    | `/api/message`      | 메시지 전송 → agent spawn   |
| POST    | `/api/clear`        | 메시지 초기화 (memory 보존) |
| GET/PUT | `/api/settings`     | 설정 조회/수정              |
| GET/PUT | `/api/prompt`       | A-2 프롬프트 조회/수정      |
| GET/PUT | `/api/heartbeat-md` | HEARTBEAT.md 조회/수정      |
| GET     | `/api/memory`       | Memory 조회                 |
| POST    | `/api/memory`       | Memory UPSERT               |
| DELETE  | `/api/memory/:key`  | Memory 삭제                 |
| GET     | `/api/cli-status`   | CLI 설치 상태               |

## MVP Roadmap

| Phase | 내용                           | 상태 |
| ----- | ------------------------------ | ---- |
| MVP-1 | Foundation (server + DB + CLI) | ✅    |
| MVP-2 | Single Agent (spawn + NDJSON)  | ✅    |
| MVP-3 | Prompt Injection (A-1/A-2/B)   | ✅    |
| MVP-4 | Web UI                         | ✅    |
| MVP-5 | Telegram                       | ⬜    |
| MVP-6 | Employee Orchestration         | ⬜    |
| MVP-7 | Integration Test               | ⬜    |
