<div align="center">

# 🦈 CLI-JAW

### 5대 AI 엔진을 품은 나만의 로컬 비서

*Claude, Codex, Gemini... 이제 번갈아 쓰지 마세요.*

[![Tests](https://img.shields.io/badge/tests-252%20pass-brightgreen)](#-테스트)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://typescriptlang.org)
[![Node](https://img.shields.io/badge/node-%3E%3D22-blue)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-ISC-yellow)](LICENSE)

[English](README.md) / **한국어** / [中文](README.zh-CN.md)

![CLI-JAW Web UI](docs/screenshots/web-ui.png)

</div>

---

## CLI-JAW란 무엇인가요?

CLI-JAW는 내 컴퓨터에 상주하며 이미 익숙한 인터페이스인 **웹, 터미널, 텔레그램**에서 작동하는 **개인용 AI 비서**입니다. 궁금한 것을 묻고, 작업을 위임하고, 워크플로우를 자동화하세요.

> 💬 *"오늘 일정 정리해줘"* → 텔레그램으로 바로 정리해서 보내줘요  
> 💬 *"이 모듈 리팩토링하고 테스트도 짜줘"* → 서브에이전트가 알아서, 커피 한 잔 하고 오면 돼요  
> 💬 *"저 PDF 다운받아서 핵심만 노션에 정리해"* → 브라우저 + 노션 스킬 조합으로 뚝딱

단일 모델만을 사용하는 기존 비서들과 달리, CLI-JAW는 5개의 AI 엔진(Claude, Codex, Gemini, OpenCode, Copilot)을 공식 CLI를 통해 오케스트레이션하여 모든 제공업체의 장점을 통합된 경험으로 제공합니다. 하나의 엔진 사용량이 초과되면 자동으로 다음 엔진으로 전환됩니다. 107개의 내장 스킬이 브라우저 자동화부터 문서 생성까지 모든 것을 처리합니다.

| | 왜 CLI-JAW인가요? |
|---|---|
| 🛡️ **안전한 서비스 약관 준수** | 공식 CLI만 사용합니다 — API 키 스크래핑이나 리버스 엔지니어링이 없으므로 계정 정지 위험이 없습니다. |
| 🤖 **검증된 에이전트 도구** | 실전에서 검증된 5개의 코딩 에이전트(Claude, Codex, Gemini, OpenCode, Copilot)를 한 곳에서 사용하세요. |
| ⚡ **멀티 에이전트 자동 전환(Fallback)** | 엔진 하나가 멈춰도 걱정 없습니다. 다음 엔진이 즉시 이어받아 중단 없는 작업이 가능합니다. |
| 🎭 **오케스트레이션 기반 성능 극대화** | 복잡한 작업은 전문화된 서브 에이전트에게 분산시켜 처리량을 극대화합니다. |
| 📦 **107개의 내장 스킬** | 브라우저 자동화, 문서 생성, 텔레그램 연동, 영구 메모리 등 설치 즉시 사용 가능한 기능들을 제공합니다. |

![CLI-JAW 터미널](docs/screenshots/terminal-cli.png)

---

## 비서가 어떤 일을 할 수 있나요?

```mermaid
graph LR
    YOU["👤 사용자"] -->|웹 / 터미널 / Telegram| JAW["🦈 CLI-JAW"]
    JAW -->|생성| C["Claude"]
    JAW -->|생성| X["Codex"]
    JAW -->|생성| G["Gemini"]
    JAW -->|생성| O["OpenCode"]
    JAW -->|생성| P["Copilot"]
    JAW -->|주입| SK["📦 스킬"]
    JAW -->|제어| BR["🌐 Chrome"]
    JAW -->|전송| TG["📱 Telegram"]
    
    style JAW fill:#f5e6d3,stroke:#d4a574,stroke-width:2px,color:#5c4033
```

- 🤖 **5개의 AI 엔진, 1명의 비서** — Claude · Codex · Gemini · OpenCode · Copilot. `/cli` 명령어로 전환하세요.
- ⚡ **자동 전환(Fallback)** — 엔진 하나가 다운되면 다음 엔진이 매끄럽게 이어받습니다.
- 🎭 **멀티 에이전트 오케스트레이션** — 복잡한 작업은 전문화된 서브 에이전트들에게 자동으로 분산됩니다.
- 📦 **107개의 스킬** — 브라우저 제어, 파일 편집, 이미지 생성, 웹 검색 외 [다양한 기능](#-스킬-시스템).
- 🧠 **영구 메모리** — 세션을 넘나들며 과거의 대화와 사용자 선호도를 기억합니다.
- 📱 **텔레그램 봇** — 휴대폰으로 비서와 채팅하고, 음성/사진/파일을 전송하세요.
- 🌐 **브라우저 자동화** — 비서가 알아서 웹을 탐색하고, 클릭하고, 타이핑하고, 스크린샷을 찍을 수 있습니다.
- 🔌 **MCP 생태계** — 한 번만 설치하면 5개의 AI 엔진 모두에서 즉시 사용 가능합니다.
- 🔍 **웹 검색** — MCP 도구를 통한 실시간 정보 검색.
- ⏰ **하트비트 작업** — 자동으로 실행되는 반복 일정을 등록하세요.

---

## 빠른 시작

```bash
# 설치 (5개 CLI, MCP, 105+개 스킬 전부 자동 설정)
npm install -g cli-jaw

# 쓰고 싶은 CLI만 인증 (하나만 있어도 됩니다)
claude auth          # Anthropic
codex login          # OpenAI
gemini               # Google (최초 실행)

# 시작
cli-jaw doctor      # 뭐가 설치됐는지 확인 (12개 체크)
cli-jaw serve       # Web UI → http://localhost:3457
cli-jaw chat        # 또는 터미널 TUI
```

> 💡 **5개 다 깔 필요 없어요.** 하나만 있으면 충분합니다. Copilot이랑 OpenCode는 무료도 돼요.

---

## 📦 스킬 시스템

**107개 스킬** 내장 — 브라우저, GitHub, 노션, 텔레그램, 메모리, PDF, 이미지 생성 등 [다양하게](#).

<details>
<summary>전체 스킬 목록 보기</summary>

| 티어 | 수량 | 작동 방식 |
|------|:----:|----------|
| **Active 스킬** | 17 | 매번 AI한테 자동으로 주입돼요. 항상 켜져 있어요. |
| **Reference 스킬** | 88+ | 관련 작업을 시키면 그때 AI가 읽어서 써요. |

#### Active 스킬 (항상 켜짐)

| 스킬 | 기능 |
|------|------|
| `browser` | Chrome 자동화 — 스냅샷, 클릭, 네비게이트, 스크린샷 |
| `github` | 이슈, PR, CI, 코드 리뷰 (`gh` CLI 사용) |
| `notion` | Notion 페이지 및 데이터베이스 관리 |
| `memory` | 세션 간 영속 장기 메모리 |
| `telegram-send` | Telegram으로 사진, 문서, 음성 메시지 전송 |
| `vision-click` | 스크린샷 → AI가 좌표 찾기 → 클릭 (원커맨드) |
| `imagegen` | OpenAI Image API로 이미지 생성/편집 |
| `pdf` / `docx` / `xlsx` | 오피스 문서 읽기, 생성, 편집 |
| `screen-capture` | macOS 스크린샷 및 카메라 캡처 |
| `openai-docs` | 최신 OpenAI API 문서 |
| `dev` / `dev-frontend` / `dev-backend` / `dev-data` / `dev-testing` | 서브에이전트용 개발 가이드 |

#### Reference 스킬 (필요할 때만)

88개+ 스킬이 더 있어요 — spotify, 날씨, 딥리서치, TTS, 비디오 다운로드, Apple 미리알림, 1Password, Terraform, PostgreSQL, Jupyter 등.

```bash
cli-jaw skill install <name>    # reference → active로 영구 활성화
```

</details>

---

## 📱 텔레그램 — 내 주머니 속의 비서

비서는 책상 앞에만 머물지 않습니다. 텔레그램을 통해 어디서든 대화하세요:

```
📱 Telegram ←→ 🦈 CLI-JAW ←→ 🤖 AI 엔진
```

**텔레그램에서 가능한 작업:**
- 💬 비서와 채팅 (5개 AI 엔진 중 선택)
- 🎤 음성 메시지 전송 (자동 텍스트 변환)
- 📎 처리를 위한 파일 및 사진 전송
- ⚡ 명령어 실행 (`/cli`, `/model`, `/status`)
- 🔄 실시간 AI 엔진 전환

**비서가 보내주는 내용:**
- 마크다운 서식이 적용된 AI 응답
- 생성된 이미지, PDF, 문서
- 예약된 작업 결과 (하트비트 작업)
- 브라우저 스크린샷

<p align="center">
  <img src="docs/screenshots/telegram-bot.png" width="300" alt="텔레그램 봇" />
</p>

---

## 🎭 멀티 에이전트 오케스트레이션

![오케스트레이션 로그](docs/screenshots/orchestration-log.png)

복잡한 작업의 경우, 비서가 전문 서브 에이전트에게 작업을 위임합니다:

```mermaid
graph TD
    USER["👤 사용자 요청"] --> TRIAGE["🔍 트리아지 — 단순? 복잡?"]
    
    TRIAGE -->|단순| DIRECT["⚡ 직접 응답"]
    TRIAGE -->|복잡| PLAN["📝 기획"]
    
    PLAN --> FE["🎨 프론트엔드"]
    PLAN --> BE["⚙️ 백엔드"]  
    PLAN --> DATA["📊 데이터"]
    
    FE --> GATE["🚪 게이트 리뷰"]
    BE --> GATE
    DATA --> GATE
    
    GATE -->|통과| NEXT["✅ 완료"]
    GATE -->|실패| RETRY["🔄 디버그 & 재시도"]

    style USER fill:#f5e6d3,stroke:#d4a574,stroke-width:2px,color:#5c4033
    style TRIAGE fill:#fdf2e9,stroke:#d4a574,color:#5c4033
    style PLAN fill:#f5e6d3,stroke:#d4a574,stroke-width:2px,color:#5c4033
    style GATE fill:#f5e6d3,stroke:#d4a574,stroke-width:2px,color:#5c4033
```

비서는 작업에 오케스트레이션이 필요한지 직접 응답이 필요한지 **스스로 결정**합니다. 별도의 설정이 필요 없습니다.

---

## 🔌 MCP — 단일 설정, 5개의 AI 엔진

```bash
cli-jaw mcp install @anthropic/context7    # 한 번만 설치
# → Claude, Codex, Gemini, OpenCode, Copilot 전부 자동 동기화
```

```mermaid
graph LR
    MJ["📄 mcp.json"] -->|자동 동기화| CL["Claude"]
    MJ -->|자동 동기화| CX["Codex"]
    MJ -->|자동 동기화| GM["Gemini"]
    MJ -->|자동 동기화| OC["OpenCode"]
    MJ -->|자동 동기화| CP["Copilot"]
    
    style MJ fill:#f5e6d3,stroke:#d4a574,stroke-width:2px,color:#5c4033
```

설정 파일 5개를 별도로 수정할 필요가 없습니다. 한 번만 설치하면 모든 AI 엔진에 적용됩니다.

---

## ⌨️ CLI 명령어

```bash
cli-jaw serve                         # 서버 시작
cli-jaw chat                          # 터미널 TUI
cli-jaw doctor                        # 진단 (12개 체크)
cli-jaw skill install <name>          # 스킬 설치
cli-jaw mcp install <package>         # MCP 설치 → 5개 CLI 전부 동기화
cli-jaw memory search <query>         # 메모리 검색
cli-jaw browser start                 # Chrome 시작 (CDP)
cli-jaw browser vision-click "로그인"  # AI가 알아서 클릭
cli-jaw reset                         # 전체 초기화
```

---

## 🤖 모델

각 CLI마다 프리셋이 있지만, **아무 모델 ID나** 직접 쳐도 돼요.

<details>
<summary>전체 프리셋 보기</summary>

| CLI | 기본값 | 주요 모델 |
|-----|--------|-----------|
| **Claude** | `claude-sonnet-4-6` | opus-4-6, haiku-4-5, 확장 사고 변형 |
| **Codex** | `gpt-5.3-codex` | spark, 5.2, 5.1-max, 5.1-mini |
| **Gemini** | `gemini-2.5-pro` | 3.0-pro-preview, 3-flash-preview, 2.5-flash |
| **OpenCode** | `claude-opus-4-6-thinking` | 🆓 big-pickle, GLM-5, MiniMax, Kimi, GPT-5-Nano |
| **Copilot** | `gpt-4.1` 🆓 | 🆓 gpt-5-mini, claude-sonnet-4.6, opus-4.6 |

</details>

> 🔧 프리셋에 모델 추가하고 싶으면: `src/cli/registry.ts` 하나만 고치면 전체 자동 반영.

---

## 🛠️ 개발

<details>
<summary>빌드, 실행, 프로젝트 구조</summary>

```bash
# 빌드 (TypeScript → JavaScript)
npm run build          # tsc → dist/

# 소스에서 실행 (개발용)
npm run dev            # tsx server.ts
npx tsx bin/cli-jaw.ts serve   # .ts에서 직접 실행

# 빌드 결과물로 실행 (프로덕션)
node dist/bin/cli-jaw.js serve
```

**프로젝트 구조:**

```
src/
├── agent/          # AI 에이전트 라이프사이클 & 스폰
├── browser/        # Chrome CDP 자동화
├── cli/            # CLI 레지스트리 & 모델 프리셋
├── core/           # DB, 설정, 로깅
├── http/           # Express 서버 & 미들웨어
├── memory/         # 영속 메모리 시스템
├── orchestrator/   # 멀티에이전트 오케스트레이션 파이프라인
├── prompt/         # 프롬프트 주입 & AGENTS.md 생성
├── routes/         # REST API 엔드포인트 (40+)
├── security/       # 입력 검증 & 가드레일
└── telegram/       # 텔레그램 봇 연동
```

> TypeScript — `strict: true`, `NodeNext` 모듈 해상도, ES2022 타겟.

</details>

---

## 🧪 테스트

<details>
<summary>252 pass · 1 skipped · 외부 의존성 0</summary>

```bash
npm test
```

`tsx --test`로 실행 (Node.js 네이티브 테스트 러너 + TypeScript).

</details>

---

## 📖 문서

| 문서 | 내용 |
|------|------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 시스템 설계, 모듈 그래프, REST API (40+ 엔드포인트) |
| [TESTS.md](TESTS.md) | 테스트 커버리지, 테스트 계획 |

---

## 🤝 기여하기

기여 환영합니다! 시작하는 방법:

1. 레포를 포크하고 `main`에서 브랜치를 만드세요
2. `npm run build && npm test`로 빌드 & 테스트가 통과하는지 확인
3. PR을 보내주세요 — 빠르게 리뷰할게요

> 📋 버그를 찾았거나 아이디어가 있으신가요? [이슈 열기](https://github.com/cli-jaw/cli-jaw/issues)

---

<div align="center">

**⭐ CLI-JAW가 도움이 됐다면 Star 한 번 눌러주세요!**

Made with ❤️ by the CLI-JAW community

[ISC License](LICENSE)

</div>
