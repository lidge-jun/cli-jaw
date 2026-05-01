<div align="center">

# CLI-JAW

### 이미 결제한 AI 구독, 하나의 비서로.

[![npm](https://img.shields.io/npm/v/cli-jaw)](https://npmjs.com/package/cli-jaw)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://typescriptlang.org)
[![Node](https://img.shields.io/badge/node-%3E%3D22-blue)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-supported-2496ED?logo=docker&logoColor=white)](#-docker)

[English](README.md) / **한국어** / [中文](README.zh-CN.md) / [日本語](README.ja.md)

![CLI-JAW manager dashboard](docs/screenshots/manager-dashboard-light.png)

</div>

<table>
<tr><td><b>이미 쓰는 구독을 하나로</b></td><td>Claude Max, ChatGPT Pro, Copilot, Gemini Advanced를 OAuth로 연결해 라우팅합니다. OpenCode로 원하는 모델도 추가합니다. 토큰별 과금은 없습니다.</td></tr>
<tr><td><b>Manager dashboard</b></td><td>로컬 JAW 인스턴스를 모두 추적하고, 실시간 Web UI를 미리 보고, 라이트/다크 테마를 전환하고, 런타임 설정을 확인하며, 관리 세션을 브라우저 작업 공간에서 시작하거나 중지합니다.</td></tr>
<tr><td><b>Notes workspace</b></td><td>대시보드 홈 아래 Markdown vault를 둡니다. 폴더, 이름 변경/이동, dirty-state 표시, raw/split/preview 모드, KaTeX, Mermaid, 코드 하이라이트를 지원합니다.</td></tr>
<tr><td><b>내가 일하는 곳 어디서나</b></td><td>Manager dashboard, Web PWA, Mac WebView app, terminal TUI, 음성 Telegram, Discord에서 같은 비서와 같은 메모리를 씁니다.</td></tr>
<tr><td><b>3-layer memory</b></td><td>History Block(최근 세션) + Memory Flush(episodes, daily logs) + Soul and Task Snapshot(identity, semantic recall). SQLite FTS5 전문 검색을 사용합니다.</td></tr>
<tr><td><b>Multi-agent orchestration</b></td><td>PABCD는 DB에 저장되는 5단계 FSM입니다. worker registry 기반 Employee 시스템, 파일 겹침 감지, 병렬 subtask를 지원하며 모든 phase는 사용자가 승인합니다.</td></tr>
<tr><td><b>Browser and desktop automation</b></td><td>Chrome CDP, vision-click, ChatGPT/Grok/Gemini용 DOM reference, Codex App의 Computer Use 통합, SVG와 interactive visualization용 diagram skill을 제공합니다.</td></tr>
<tr><td><b>MCP install once, 5 engines</b></td><td><code>jaw mcp install</code> 한 번으로 Claude, Codex, Gemini, OpenCode, Copilot 설정을 동시에 동기화합니다. 설정 파일은 하나입니다.</td></tr>
<tr><td><b>언어 지원</b></td><td>English, Korean, Chinese, Japanese README. i18n Web UI. OfficeCLI 기반 HWP/HWPX 한국어 오피스 문서 지원.</td></tr>
</table>

---

## 빠른 링크

- [설치](#-설치--실행) · [인증](#-인증) · [사용 위치](#-어디서-쓰나)
- [엔진 라우팅](#-엔진-라우팅) · [메모리](#-메모리) · [PABCD](#-오케스트레이션--pabcd) · [스킬](#-스킬)
- [브라우저 자동화](#-브라우저--데스크톱-자동화) · [MCP](#-mcp) · [메시징](#-메시징)
- [CLI 명령어](#%EF%B8%8F-cli-명령어) · [Docker](#-docker) · [문서](#-문서) · [비교](#%EF%B8%8F-비교)

---

## Manager dashboard

대시보드는 이제 CLI-JAW를 로컬에서 실행하는 중심 제어면입니다. 인스턴스 탐색, 미리보기, 설정, 직원, Notes를 한곳에 모으면서도 각 인스턴스는 자기 홈, DB, 메모리, 라이프사이클 메타데이터, 작업 디렉터리를 따로 유지합니다.

| 영역 | 하는 일 |
|---|---|
| **Navigator** | active/running/offline 인스턴스를 묶어 보여주고 CLI/model label, custom name, port, Preview/Open/Start/Stop/Restart 동작을 제공합니다 |
| **Live preview** | 선택한 인스턴스의 Web UI를 manager preview proxy로 embed합니다. 새로고침/열기 컨트롤과 Preview-on toggle을 제공합니다 |
| **Runtime settings** | 선택한 인스턴스의 active CLI, model, reasoning effort, permission mode, 작업 디렉터리, 직원, skills, 설정을 보여줍니다 |
| **Notes** | 대시보드 로컬 markdown vault입니다. 폴더 트리, 수동 저장, 폴더로 드래그 이동, 이름 변경, 분할 미리보기, KaTeX, Mermaid, highlighted code block을 지원합니다 |

릴리스 polish를 위해 아직 필요한 스크린샷:

1. 같은 3-pane layout을 다크 테마로 보여주는 대시보드.
2. folder tree, split editor/preview, 렌더링된 KaTeX/Mermaid/code block이 보이는 Notes mode.
3. responsive navigation이 보이는 mobile 또는 narrow viewport 대시보드.

<details>
<summary>Windows 사용자라면? — WSL one-click setup</summary>

**1단계: WSL 설치** (관리자 PowerShell)

```powershell
wsl --install
```

재시작한 뒤 Start Menu에서 **Ubuntu**를 엽니다.

**2단계: CLI-JAW 설치**

```bash
curl -fsSL https://raw.githubusercontent.com/lidge-jun/cli-jaw/master/scripts/install-wsl.sh | bash
```

**3단계: shell을 다시 불러오고 시작**

```bash
source ~/.bashrc
copilot login    # or: claude auth / codex login / gemini
jaw serve        # → http://localhost:3457
```

<details>
<summary>WSL 문제 해결</summary>

| 문제 | 해결 |
|---|---|
| `unzip: command not found` | installer를 다시 실행합니다 |
| `jaw: command not found` | `source ~/.bashrc` |
| Permission errors | `sudo chown -R $USER $(npm config get prefix)` |

</details>
</details>

<details>
<summary>터미널이 처음이라면? — One-click install (macOS)</summary>

1. **Terminal**을 엽니다 (`Cmd + Space` → `Terminal` 입력)
2. 아래 명령을 붙여 넣고 Enter를 누릅니다:

```bash
curl -fsSL https://raw.githubusercontent.com/lidge-jun/cli-jaw/master/scripts/install.sh | bash
```

3. 인증하고 실행합니다:

```bash
copilot login
jaw serve        # → http://localhost:3457
```

</details>

---

## 🚀 설치 & 실행

```bash
npm install -g cli-jaw
jaw serve
```

**http://localhost:3457** 을 엽니다. Node.js 22+가 필요하며, 아래 AI CLI 중 하나 이상이 인증되어 있어야 합니다.

> `jaw service install` — 부팅 시 자동 시작합니다(systemd, launchd, Docker 자동 감지).
>
> Claude Code 참고: Anthropic computer-use MCP가 필요하면 native Claude installer를 권장합니다(`curl -fsSL https://claude.ai/install.sh | bash` 또는 `claude install`). `jaw doctor`는 이제 `claude`가 npm/bun으로 관리되는 것처럼 보이면 경고합니다.

---

## 🔑 인증

하나만 있으면 됩니다. 이미 결제 중인 구독을 고르십시오:

```bash
# Free
copilot login        # GitHub Copilot
opencode             # OpenCode — free models available

# Paid (monthly subscription)
claude auth          # Anthropic Claude Max (computer-use MCP users: native Claude install recommended)
codex login          # OpenAI ChatGPT Pro (npm/bun installs are fine)
gemini               # Google Gemini Advanced
```

상태 확인: `jaw doctor`

<details>
<summary>jaw doctor 출력 예시</summary>

```
🦈 CLI-JAW Doctor — 12 checks

 ✅ Node.js        v22.15.0
 ✅ Claude CLI      installed
 ✅ Codex CLI       installed
 ⚠️ Gemini CLI      not found (optional)
 ✅ OpenCode CLI    installed
 ✅ Copilot CLI     installed
 ✅ Database        jaw.db OK
 ✅ Skills          22 active, 94 reference
 ✅ MCP             3 servers configured
 ✅ Memory          MEMORY.md exists
 ✅ Server          port 3457 available
```

</details>

---

## 🖥️ 어디서 쓰나

CLI-JAW는 다섯 가지 surface에서 동작합니다. 어디서 쓰든 같은 assistant, 같은 메모리, 같은 skills를 사용합니다.

| Surface | 제공 기능 |
|---|---|
| **Web PWA** | markdown/KaTeX/Mermaid rendering, virtual scroll, WS streaming, drag-and-drop file upload, voice recording, PABCD roadmap bar, i18n(English, Korean, Chinese, Japanese), dark/light theme, IndexedDB 기반 offline message cache를 갖춘 전체 UI |
| **Mac WebView app** | `jaw serve`를 native macOS app shell로 감쌉니다. 브라우저를 열지 않고 Dock에서 접근합니다 |
| **Terminal TUI** | multiline editing, slash-command autocomplete, overlay selector, session persistence, resume classification |
| **Telegram** | 음성 메시지(multi-provider STT), 사진, 파일. 예약 task 결과를 자동 전달합니다. model/CLI 전환 slash command를 제공합니다 |
| **Discord** | text/file messaging, command sync, channel/thread routing, agent result forwarder |

---

## 🔀 엔진 라우팅

이미 결제한 OAuth 구독으로 다섯 CLI backend를 라우팅합니다. 토큰별 API 과금은 없습니다.

| CLI | 기본 모델 | 인증 | 비용 모델 |
|---|---|---|---|
| **Claude** | `opus-4-6` | `claude auth` | Claude Max subscription |
| **Codex** | `gpt-5.5` | `codex login` | ChatGPT Pro subscription |
| **Gemini** | `gemini-3.1-pro-preview` | `gemini` | Gemini Advanced subscription |
| **OpenCode** | `minimax-m2.7` | `opencode` | Free models available |
| **Copilot** | `gpt-5-mini` | `copilot login` | Free tier available |

**Fallback chain**: 한 엔진이 rate limit에 걸리거나 내려가면 다음 엔진이 자동으로 이어받습니다. `/fallback [cli1 cli2...]`로 설정합니다.

**OpenCode wildcard**: OpenRouter, local LLM, OpenAI-compatible API 등 원하는 모델 endpoint를 연결합니다.

> 엔진 전환: `/cli codex`. 모델 전환: `/model gpt-5.5`. Web, Terminal, Telegram, Discord 어디서든 가능합니다.

---

## 🧠 메모리

세 계층이 서로 다른 기억 범위를 담당합니다.

| 계층 | 저장하는 것 | 동작 방식 |
|---|---|---|
| **History Block** | 최근 세션 컨텍스트 | `buildHistoryBlock()` — 마지막 10개 세션, 최대 8000문자, working directory 기준 범위. 프롬프트 시작부에 주입됩니다 |
| **Memory Flush** | 대화에서 추출한 구조화 지식 | threshold 이후 실행됩니다(기본 10턴). extractor prompt가 episodes, daily logs(`YYYY-MM-DD.md`), live notes로 요약해 markdown file로 저장합니다 |
| **Soul + Task Snapshot** | identity와 시맨틱 검색 | `soul.md`가 core values, tone, boundaries를 정의합니다. Task Snapshot은 프롬프트마다 FTS5 index에서 의미상 관련된 hit를 최대 4개(각 700자) 찾습니다 |

세 계층은 모두 system prompt에 자동으로 들어갑니다. 검색은 `jaw memory search <query>` 또는 어느 인터페이스에서든 `/memory <query>`로 합니다.

고급 memory 기능으로 profile summary, bootstrap/migration, reindex flow가 있으며 Web UI settings에서 접근합니다.

---

## 🎭 오케스트레이션 — PABCD

복잡한 작업에서 CLI-JAW는 5단계 상태 머신을 사용합니다. 모든 전환은 사용자가 승인합니다.

```
P (Plan) → A (Audit) → B (Build) → C (Check) → D (Done) → IDLE
   ⛔         ⛔          ⛔         auto        auto
```

| Phase | 하는 일 |
|---|---|
| **P** | Boss AI가 diff-level plan을 작성합니다. 사용자 검토를 위해 멈춥니다 |
| **A** | read-only worker가 plan의 실행 가능성을 검증합니다 |
| **B** | Boss가 구현합니다. read-only worker가 결과를 검증합니다 |
| **C** | type-check, docs update, consistency check를 수행합니다 |
| **D** | 모든 변경 요약을 남기고 idle로 돌아갑니다 |

상태는 DB에 저장되므로 server restart 후에도 유지됩니다. Worker는 파일을 수정할 수 없습니다. `jaw orchestrate` 또는 `/pabcd`로 활성화합니다.

---

## 📦 스킬

100개 이상의 skill이 역할별로 정리되어 있습니다.

| Category | Skills | 담당 범위 |
|---|---|---|
| **Office** | `pdf`, `docx`, `xlsx`, `pptx`, `hwp` | 문서 읽기, 생성, 편집. OfficeCLI 기반 Korean HWP/HWPX |
| **Automation** | `browser`, `vision-click`, `screen-capture`, `desktop-control` | Chrome CDP, AI coordinate click, macOS screenshot/camera, Computer Use |
| **Media** | `video`, `imagegen`, `lecture-stt`, `tts` | Remotion video rendering, OpenAI image generation, lecture transcription, text-to-speech |
| **Integration** | `github`, `notion`, `telegram-send`, `memory` | issues/PRs/CI, Notion pages, Telegram media delivery, persistent memory |
| **Visualization** | `diagram` | chat 안에서 렌더링되는 SVG diagram, chart, interactive visualization |
| **Dev guides** | `dev`, `dev-frontend`, `dev-backend`, `dev-data`, `dev-testing`, `dev-pabcd`, `dev-code-reviewer` | sub-agent prompt에 주입되는 engineering guideline |

22개 active skills는 항상 주입됩니다. 94개 이상의 reference skills는 필요할 때 불러옵니다.

```bash
jaw skill install <name>    # activate a reference skill
```

---

## 🌐 브라우저 & 데스크톱 자동화

| Capability | 동작 방식 |
|---|---|
| **Chrome CDP** | DevTools Protocol로 navigate, click, type, screenshot, evaluate JS, scroll, focus, press keys 등 10개 action을 수행합니다 |
| **Vision-click** | 화면을 screenshot으로 찍고 AI가 target coordinate를 추출해 클릭합니다. 한 명령이면 됩니다: `jaw browser vision-click "Login button"` |
| **DOM reference** | ChatGPT, Grok, Gemini Web UI의 selector map 문서입니다. model selection, stop buttons, tool drawers를 다룹니다 |
| **Computer Use** | Codex App Computer Use MCP를 통한 desktop app automation입니다. DOM target은 CDP로, desktop app은 Computer Use로 라우팅합니다 |
| **Diagram skill** | SVG diagram과 interactive HTML visualization을 생성하고, copy/save control이 있는 sandboxed iframe에 렌더링합니다 |

---

## 🔌 MCP

[Model Context Protocol](https://modelcontextprotocol.io)은 AI agent가 외부 tool을 쓰게 해줍니다. CLI-JAW는 하나의 파일에서 다섯 엔진의 MCP config를 관리합니다.

```bash
jaw mcp install @anthropic/context7
# → syncs to Claude, Codex, Gemini, OpenCode, Copilot config files
```

더 이상 JSON 파일 다섯 개를 따로 고칠 필요가 없습니다. 한 번 설치하면 모든 엔진에 적용됩니다.

```bash
jaw mcp sync       # re-sync after manual edits
```

---

## 💬 메시징

### Telegram

```
📱 Telegram ←→ 🦈 CLI-JAW ←→ 🤖 AI Engines
```

<details>
<summary>설정(3단계)</summary>

1. bot 생성 — [@BotFather](https://t.me/BotFather)에 메시지 → `/newbot` → token 복사
2. 설정 — `jaw init --telegram-token YOUR_TOKEN` 또는 Web UI settings 사용
3. bot에 아무 메시지나 보냅니다. 첫 메시지에서 Chat ID가 자동 저장됩니다

</details>

Telegram에서 가능한 것: text chat, voice messages(multi-provider STT로 자동 전사), file/photo upload, slash commands(`/cli`, `/model`, `/status`), scheduled task result delivery.

### Discord

Telegram과 같은 기능을 제공합니다 — text, files, commands. Web UI settings에서 설정하며 channel/thread routing과 agent result broadcast용 forwarder를 지원합니다.

### 음성 & STT

음성 입력은 Web(mic button), Telegram(voice messages), Discord에서 동작합니다. Provider는 OpenAI-compatible, Google Vertex AI, custom endpoint를 지원합니다. Web UI settings에서 설정합니다.

---

## ⏰ 스케줄링 & heartbeat

| Feature | 하는 일 |
|---|---|
| **Heartbeat jobs** | Cron schedule로 unattended task를 실행합니다. 결과는 Telegram/Discord로 전달됩니다 |
| **Service auto-start** | `jaw service install` — systemd(Linux), launchd(macOS), Docker를 자동 감지합니다 |
| **Memory auto-reflect** | structured knowledge extraction을 위한 optional post-flush reflection |

---

## ⌨️ CLI 명령어

```bash
jaw serve                         # start server → http://localhost:3457
jaw chat                          # terminal TUI
jaw doctor                        # 12-point diagnostics
jaw service install               # auto-start on boot
jaw skill install <name>          # activate a skill
jaw mcp install <package>         # install MCP → syncs to 5 engines
jaw memory search <query>         # search memory
jaw browser start                 # launch Chrome (CDP)
jaw browser vision-click "Login"  # AI-powered click
jaw clone ~/project               # clone instance
jaw --home ~/project serve --port 3458  # run second instance
jaw orchestrate                   # enter PABCD
jaw dispatch --agent Backend --task "..." # dispatch employee
jaw reset                         # full reset
```

---

## 🏗️ 멀티 인스턴스

서로 분리된 settings, memory, database를 가진 인스턴스를 실행합니다.

```bash
jaw clone ~/my-project
jaw --home ~/my-project serve --port 3458
```

각 인스턴스는 완전히 독립적입니다 — working directory, memory, MCP config가 모두 따로 유지됩니다.

---

## 🔗 원격 접근(Tailscale)

```bash
jaw serve --lan                       # bind 0.0.0.0 + allow tailnet peers
# settings.json: network.bindHost=0.0.0.0, lanBypass=true
```

`lanBypass=true`일 때 지원하는 peer address:

- `100.64.0.0/10` — Tailscale CGNAT (RFC 6598)
- `fd7a:115c:a1e0::/48` — Tailscale ULA
- `*.ts.net` — MagicDNS hostnames (Host + Origin both pass)

주의할 점:

- Tailnet peer는 WireGuard + IdP 인증을 거칩니다 — public이 아니라 LAN처럼 다루십시오.
- Shared tailnet에서는 Tailscale ACL(`acl.tailnet`)과 함께 써서 node 접근자를 제한하십시오.
- Subnet router / exit node에서는 SNAT 때문에 peer IP가 router의 100.x로 접힙니다 — trust boundary가 흐려집니다. direct tailnet membership을 권장합니다.
- Production에서는 가능하면 `bindHost`를 `0.0.0.0` 대신 `tailscale0` interface address로 좁히십시오.
- `lanBypass=true`이면 tailnet peer는 Bearer token을 건너뜁니다(RFC 1918과 같은 LAN 취급). loopback이 아닌 모든 peer에 `JAW_AUTH_TOKEN`을 요구하려면 `lanBypass=false`를 설정하십시오.

---

## 🐳 Docker

```bash
docker compose up -d       # → http://localhost:3457
```

non-root `jaw` user와 Chromium sandbox를 사용합니다. Dockerfile은 두 개입니다: `Dockerfile`(npm install)과 `Dockerfile.dev`(local source). 데이터는 `jaw-data` named volume에 유지됩니다.

<details>
<summary>Docker details</summary>

```bash
# Dev build
docker build -f Dockerfile.dev -t cli-jaw:dev .
docker run -d -p 3457:3457 --env-file .env cli-jaw:dev

# Pin version
docker build --build-arg CLI_JAW_VERSION=1.0.1 -t cli-jaw:1.0.1 .

# If Chromium sandbox fails
docker run -e CHROME_NO_SANDBOX=1 -p 3457:3457 cli-jaw
```

</details>

---

## 📖 문서

| 문서 | 다루는 내용 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | v1.2.0부터 v1.5.1까지 포함한 v1.6.0 catch-up release log |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | system design, module graph, 94개 endpoint의 95개 API handler |
| [TESTS.md](TESTS.md) | test coverage, counts, test plan |
| [memory-architecture.md](docs/memory-architecture.md) | 3-layer memory model, indexing, runtime behavior |
| [env-vars.md](docs/env-vars.md) | environment variable reference |
| [skill-router-plan.md](docs/skill-router-plan.md) | skill routing architecture |
| [officecli-integration.md](docs/officecli-integration.md) | HWP/HWPX와 Office documents를 위한 OfficeCLI setup |
| [devlog/structure/](devlog/structure/) | internal architecture reference — prompt pipeline, agent spawn, frontend, server API, commands, Telegram, memory |

---

## ⚖️ 비교

| | CLI-JAW | Hermes Agent | Claude Code |
|---|---|---|---|
| **Model access** | OAuth subscriptions(Claude Max, ChatGPT Pro, Copilot, Gemini) + OpenCode wildcard | API keys(OpenRouter 200+, Nous Portal) | Anthropic only |
| **Cost model** | 이미 결제 중인 monthly subscriptions | Per-token API billing | Anthropic subscription |
| **Primary UI** | Web PWA + Mac app + TUI | TUI only | CLI + IDE plugins |
| **Messaging** | Telegram(voice) + Discord | Telegram/Discord/Slack/WhatsApp/Signal | None |
| **Memory** | 3-layer(History/Flush/Soul) + FTS5 | Self-improving learning loop + Honcho | File-based auto-memory |
| **Browser automation** | Chrome CDP + vision-click + DOM ref | Limited | Via MCP |
| **Orchestration** | PABCD 5-phase FSM | Subagent spawn | Task tool |
| **Execution** | Local + Docker | Local/Docker/SSH/Daytona/Modal/Singularity | Local |
| **Skills** | 100+ bundled | Self-creating + agentskills.io | User-configured |
| **i18n** | English, Korean, Chinese, Japanese | English | English |

CLI-JAW는 OpenClaw harness architecture(hybrid search manager, fallback patterns, session indexing)에서 이어졌습니다. OpenClaw에서 옮겨온다면 slash-command surface와 memory model이 익숙할 것입니다.

---

## 🛠️ 개발

```bash
npm run build          # tsc → dist/
npm run dev            # tsx server.ts (hot-reload)
npm test               # native Node.js test runner
```

Architecture와 test detail은 [ARCHITECTURE.md](docs/ARCHITECTURE.md), [TESTS.md](TESTS.md), [devlog/structure/](devlog/structure/)에 있습니다.

---

## ❓ 문제 해결

| 문제 | 해결 |
|---|---|
| `cli-jaw: command not found` | `npm install -g cli-jaw`를 다시 실행합니다. `npm bin -g`가 `$PATH` 안에 있는지 확인하십시오 |
| `Error: node version` | Node.js 22+로 올립니다: `nvm install 22` |
| `NODE_MODULE_VERSION` mismatch | `npm run ensure:native` (auto-rebuild) |
| `EADDRINUSE: port 3457` | 다른 instance가 실행 중입니다. `--port 3458`을 사용하십시오 |
| Telegram or agent auth fails | `jaw doctor`를 실행한 뒤 `jaw serve`를 재시작하십시오 |
| Browser commands fail | Chrome을 설치하십시오. 먼저 `jaw browser start`를 실행하십시오 |

---

## 🤝 기여하기

1. `master`에서 fork하고 branch를 만듭니다
2. `npm run build && npm test`
3. PR을 제출합니다

버그를 찾았거나 아이디어가 있습니까? [Issue를 열어 주세요](https://github.com/lidge-jun/cli-jaw/issues)

---

<div align="center">

**[MIT License](LICENSE)**

</div>
