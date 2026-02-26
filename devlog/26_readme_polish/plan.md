# README 개선 계획 — 260226_readme_polish

> 참고: Claude Code, OpenAI Codex, Goose (Block), Aider 분석 기반
> 대상: `README.md`, `README.ko.md`, `README.zh-CN.md` (3개 파일 동일 적용)

---

## Phase 1: 데모 GIF 추가 ⭐ (임팩트 최대)

**근거:** Claude Code → `demo.gif` 최상단, Goose → YouTube 영상 임베드.
현재 정적 PNG만 있음.

### 작업

1. 터미널에서 `asciinema` 또는 macOS 화면 녹화로 30초 데모 촬영:
   - `jaw serve` 실행 → 브라우저 열림 → 질문 입력 → AI 응답 → 도구 사용
2. GIF 변환 (또는 mp4→gif): `ffmpeg -i demo.mp4 -vf "fps=10,scale=800:-1" docs/demo.gif`
3. README 3개에 삽입

### Diff (README.md)

```diff
 ![CLI-JAW Web UI](docs/screenshots/web-ui.png)
 
+<!-- 30-second demo: install → serve → chat → AI responds -->
+![Demo](docs/demo.gif)
+
 </div>
```

> ⚠️ 수동 작업 필요 (녹화). 이 Phase는 유저가 직접 진행.

---

## Phase 2: Skill 수 정합성 수정 🔧

**문제:** `skills_ref/` = 101개 (git 기준). 이 중 17개가 Active.
따라서 Reference = 101 − 17 = **84개**. 총합 = 101.
현재 README 테이블: `Active: 17, Reference: 105` → **잘못됨**.

### Diff (README.md L141-144)

```diff
 | Tier                 | Count | How it works                                              |
 | -------------------- | :---: | --------------------------------------------------------- |
 | **Active Skills**    |  17   | Auto-injected into every AI prompt. Always available.     |
-| **Reference Skills** |  105  | AI reads them on-demand when you ask for a relevant task. |
+| **Reference Skills** |  84   | AI reads them on-demand when you ask for a relevant task. |
```

### Diff (README.ko.md)

```diff
 | **Active 스킬**    |  17   | 매번 AI한테 자동으로 주입돼요. 항상 켜져 있어요. |
-| **Reference 스킬** |  105  | 관련 작업을 시키면 그때 AI가 읽어서 써요.        |
+| **Reference 스킬** |  84   | 관련 작업을 시키면 그때 AI가 읽어서 써요.        |
```

### Diff (README.zh-CN.md)

```diff
 | **活跃技能** |  17   | 每次对话自动加载，随时可用。       |
-| **参考技能** |  105  | 用到的时候 AI 自己去读，按需调用。 |
+| **参考技能** |  84   | 用到的时候 AI 自己去读，按需调用。 |
```

### 한국어/중국어 Reference 스킬 설명 텍스트도 업데이트

```diff
 # README.ko.md
-88개+ 스킬이 더 있어요 — spotify, 날씨, ...
+84개 스킬이 더 있어요 — spotify, 날씨, ...

 # README.zh-CN.md
-88 个技能随时待命 — Spotify、天气、...
+84 个技能随时待命 — Spotify、天气、...
```

---

## Phase 3: README 경량화 — 상세 섹션 docs/ 분리 📄

**근거:** Claude Code ~80L, Goose ~50L vs CLI-JAW ~486L.
상세 내용을 `docs/`로 빼고, README는 Quick Links 방식으로 축약.

### 이동 대상

| 현재 README 섹션 (행 범위)          | 이동 위치                         |
| ----------------------------------- | --------------------------------- |
| `📦 Skill System` (L134-L183)      | `docs/SKILLS.md`                  |
| `📱 Telegram` (L187-L221)          | `docs/TELEGRAM.md`                |
| `🎭 Orchestration` (L224-L253)     | `docs/ORCHESTRATION.md`           |
| `🔌 MCP` (L258-L277)              | `docs/MCP.md`                     |
| `🏗️ Multi-Instance` (L302-L327)   | `docs/MULTI-INSTANCE.md`          |
| `🤖 Models` (L330-L348)           | `docs/MODELS.md`                  |

### Diff (README.md) — 대체할 구간

```diff
-## 📦 Skill System
-
-**101 skills** out of the box — browser, github, ...
-
-<details>
-... (50 lines)
-</details>
+## 📦 Skill System — [View all 101 skills →](docs/SKILLS.md)

-## 📱 Telegram — Your Assistant in Your Pocket
-
-Your assistant isn't tied to your desk. ...
-... (35 lines)
+## 📱 Telegram — [Setup guide →](docs/TELEGRAM.md)
+
+Chat with your assistant from your phone via Telegram — voice, photos, files, commands.

-## 🎭 Multi-Agent Orchestration
-
-For complex tasks, ...
-... (30 lines)
+## 🎭 Multi-Agent Orchestration — [How it works →](docs/ORCHESTRATION.md)
+
+Complex tasks auto-split across specialized sub-agents. No configuration needed.

-## 🔌 MCP — One Config, Five AI Engines
-
-... (20 lines)
+## 🔌 MCP — [One config, 5 engines →](docs/MCP.md)
+
+`jaw mcp install <pkg>` — installs once, syncs to Claude, Codex, Gemini, OpenCode, Copilot.

-## 🏗️ Multi-Instance — Separate Projects, Separate Contexts
-
-... (26 lines)
+## 🏗️ Multi-Instance — [Separate projects →](docs/MULTI-INSTANCE.md)
+
+`jaw clone ~/my-project && jaw --home ~/my-project serve --port 3458`

-## 🤖 Models
-
-... (19 lines)
+## 🤖 Models — [All presets →](docs/MODELS.md)
+
+Claude · Codex · Gemini · OpenCode · Copilot. Type any model ID or use presets.
```

**예상 효과:** README ~486L → ~200L

> ⚠️ 선택사항 — 주니가 README를 짧게 유지할지 결정 필요.

---

## Phase 4: Quick Links 섹션 추가 🔗

**근거:** Goose 스타일의 Quick Links 블록.

### Diff (README.md) — hero 밑, Install 위에 삽입

```diff
 </div>
 
 ---
 
+## Quick Links
+
+- [Quickstart](#-install--run-30-seconds)
+- [Authentication](#-authenticate-your-ai-engines)
+- [Skills](docs/SKILLS.md) — 101 built-in tools for browser, GitHub, Notion, memory, and more
+- [Telegram](docs/TELEGRAM.md) — Chat from your phone
+- [Orchestration](docs/ORCHESTRATION.md) — Multi-agent task splitting
+- [MCP](docs/MCP.md) — One config, five AI engines
+- [Models](docs/MODELS.md) — Presets for all 5 CLIs
+- [Troubleshooting](#-troubleshooting)
+- [Architecture](docs/ARCHITECTURE.md) — System design, REST API (40+ endpoints)
+
+---
+
 ## 🚀 Install & Run (30 seconds)
```

> Phase 3 적용 시에만 의미 있음. Phase 3 미적용이면 Quick Links 대신 ToC 자동 생성도 옵션.

---

## Phase 5: 잔여 수정 🔩

### 5-1. `Reference Skills` 설명 갯수 일치화 (한/중)

이미 Phase 2에서 처리.

### 5-2. `docs/screenshots/` 이미지 최적화

현재 파일 크기:
- `telegram-bot.png`: **1.2MB** (너무 큼)
- `web-ui.png`: 235KB
- `orchestration-log.png`: 202KB
- `terminal-cli.png`: 78KB

```bash
# 리사이즈 + 압축 (sips macOS 내장)
sips -Z 1200 docs/screenshots/telegram-bot.png
# 또는 pngquant 사용:
pngquant --quality=65-80 docs/screenshots/telegram-bot.png
```

### 5-3. `.github/` 설정 (선택)

| 파일                        | 용도                        |
| --------------------------- | --------------------------- |
| `.github/ISSUE_TEMPLATE.md` | 이슈 템플릿                 |
| `.github/FUNDING.yml`       | 후원 링크                   |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR 템플릿             |

### 5-4. GitHub repo Topics 태그 제안

```
ai-agent, cli-tool, multi-model, telegram-bot, browser-automation,
mcp, copilot, claude, codex, gemini, opencode, typescript, nodejs
```

---

## 요약: 우선순위

| Phase | 내용                | 임팩트 | 난이도 | 비고             |
| :---: | ------------------- | :----: | :----: | ---------------- |
|   1   | 데모 GIF            |  ⭐⭐⭐  |  중    | 수동 녹화 필요   |
|   2   | Ref 스킬 수 수정    |  ⭐⭐   |  하    | 즉시 적용 가능   |
|   3   | README 경량화       |  ⭐⭐⭐  |  중    | 유저 결정 필요   |
|   4   | Quick Links         |  ⭐⭐   |  하    | Phase 3 의존     |
|   5   | 잔여 (이미지/GH)    |  ⭐    |  하    | 선택             |
