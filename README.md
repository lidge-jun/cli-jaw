# 🦞 CLI-Claw

> Unified AI agent orchestration platform — CLI, Web UI, Telegram

## Supported Models

### Claude Code
| Model                       | Description                |
| --------------------------- | -------------------------- |
| `claude-sonnet-4-6`         | Default — fast, capable    |
| `claude-opus-4-6`           | Most powerful              |
| `claude-sonnet-4-6[1m]`     | Extended thinking (Sonnet) |
| `claude-opus-4-6[1m]`       | Extended thinking (Opus)   |
| `claude-haiku-4-5-20251001` | Fast, lightweight          |

### Codex
| Model                 | Description            |
| --------------------- | ---------------------- |
| `gpt-5.3-codex`       | Default — latest Codex |
| `gpt-5.3-codex-spark` | Lightweight            |
| `gpt-5.2-codex`       | Previous generation    |
| `gpt-5.1-codex-max`   | High context           |
| `gpt-5.1-codex-mini`  | Budget                 |

### Gemini CLI
| Model                    | Description      |
| ------------------------ | ---------------- |
| `gemini-3.0-pro-preview` | Latest preview   |
| `gemini-3.1-pro-preview` | Next gen preview |
| `gemini-2.5-pro`         | Default — stable |
| `gemini-3-flash-preview` | Fast preview     |
| `gemini-2.5-flash`       | Fastest          |

### OpenCode
| Model                              | Description    |
| ---------------------------------- | -------------- |
| `github-copilot/claude-sonnet-4.5` | Default        |
| `github-copilot/claude-opus-4.6`   | Copilot Opus   |
| `github-copilot/gpt-5`             | Copilot GPT-5  |
| `github-copilot/gemini-2.5-pro`    | Copilot Gemini |
| `opencode/big-pickle`              | 🆓 Free         |
| `opencode/GLM-5 Free`              | 🆓 Free         |
| `opencode/MiniMax M2.5 Free`       | 🆓 Free         |
| `opencode/Kimi K2.5 Free`          | 🆓 Free         |
| `opencode/GPT 5 Nano Free`         | 🆓 Free         |
| `opencode/Grok Code Fast 1 Free`   | 🆓 Free         |

> 💡 모든 CLI에서 **✏️ 직접 입력** 으로 모델 ID를 직접 타이핑할 수 있습니다.

## Quick Start

```bash
npm install -g cli-claw
cli-claw serve
# → http://localhost:3457
```

## Features

- 🤖 **Multi-CLI**: Claude Code, Codex, Gemini CLI, OpenCode 통합
- 👥 **Sub Agents**: 역할별 에이전트 분배 (프론트, 백엔드, QA 등)
- 📦 **Skills**: 플러그인 스킬 시스템
- 🧠 **Memory**: 자동 대화 요약 + 장기 기억
- 💓 **Heartbeat**: 주기적 자동 실행
- 📬 **Telegram**: 텔레그램 봇 연동
- 🌐 **Browser**: Playwright 기반 브라우저 제어
- 🔌 **MCP**: 글로벌 MCP 서버 자동 설치 + 동기화

## Architecture

```
cli-claw serve  →  Express + WebSocket server (:3457)
cli-claw chat   →  Terminal UI (raw stdin, footer, queue)
```

```
server.js          API routes + WebSocket hub
src/agent.js       CLI spawn + stream parser
src/orchestrator.js Multi-agent task distribution
src/config.js      Settings + defaults
src/prompt.js      System prompt generator
src/telegram.js    Telegram bot bridge
src/memory.js      Memory file management
public/index.html  Web UI (single-file)
```
