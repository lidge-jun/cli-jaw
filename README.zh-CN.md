<div align="center">

# CLI-JAW

### 你已有的 AI 订阅，一个助手统一使用。

[![npm](https://img.shields.io/npm/v/cli-jaw)](https://npmjs.com/package/cli-jaw)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://typescriptlang.org)
[![Node](https://img.shields.io/badge/node-%3E%3D22-blue)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-supported-2496ED?logo=docker&logoColor=white)](#-docker)

[English](README.md) / [한국어](README.ko.md) / **中文** / [日本語](README.ja.md)

![CLI-JAW manager dashboard](docs/screenshots/manager-dashboard-light.png)

</div>

<table>
<tr><td><b>统一使用已有订阅</b></td><td>通过 OAuth 接入 Claude Max、ChatGPT Pro、Copilot、Gemini Advanced。也可以通过 OpenCode 添加任意模型。没有按 token 计费。</td></tr>
<tr><td><b>Manager dashboard</b></td><td>在一个浏览器工作区里追踪所有本地 JAW 实例，预览实时 Web UI，切换浅色/深色主题，查看运行时设置，并启动或停止托管会话。</td></tr>
<tr><td><b>Notes workspace</b></td><td>仪表盘主目录下的 Markdown 仓库。支持文件夹、重命名/移动、未保存状态标记、raw/split/preview 模式、KaTeX、Mermaid 和代码高亮。</td></tr>
<tr><td><b>你在哪里，它就在哪里</b></td><td>Manager dashboard、Web PWA、Mac WebView app、terminal TUI、带语音的 Telegram、Discord。所有入口共享同一个助手和同一份记忆。</td></tr>
<tr><td><b>3-layer memory</b></td><td>History Block（近期会话）+ Memory Flush（episodes、daily logs）+ Soul and Task Snapshot（identity、semantic recall）。使用 SQLite FTS5 全文搜索。</td></tr>
<tr><td><b>Multi-agent orchestration</b></td><td>PABCD 是持久化到 DB 的 5 阶段 FSM。Employee system 带 worker registry。支持并行 subtask 和文件重叠检测。每个 phase 都由你确认。</td></tr>
<tr><td><b>Browser and desktop automation</b></td><td>Chrome CDP、vision-click、ChatGPT/Grok/Gemini 的 DOM reference、通过 Codex App 接入 Computer Use、用于 SVG 与交互式可视化的 diagram skill。</td></tr>
<tr><td><b>MCP install once, 5 engines</b></td><td><code>jaw mcp install</code> 会同时同步到 Claude、Codex、Gemini、OpenCode、Copilot。只维护一份配置。</td></tr>
<tr><td><b>多语言支持</b></td><td>English、Korean、Chinese、Japanese README。i18n Web UI。通过 OfficeCLI 支持 HWP/HWPX 韩文办公文档。</td></tr>
</table>

---

## 快速链接

- [安装](#-安装与运行) · [认证](#-认证) · [使用入口](#-使用入口)
- [引擎路由](#-引擎路由) · [记忆](#-记忆) · [PABCD](#-编排--pabcd) · [技能](#-技能)
- [浏览器自动化](#-浏览器与桌面自动化) · [MCP](#-mcp) · [消息](#-消息)
- [CLI 命令](#%EF%B8%8F-cli-命令) · [Docker](#-docker) · [文档](#-文档) · [对比](#%EF%B8%8F-对比)

---

## Manager dashboard

Dashboard 现在是本地运行 CLI-JAW 的主控制面。实例发现、预览、设置、员工和 Notes 都在一个地方；每个实例仍然保留自己的主目录、数据库、记忆、生命周期元数据和工作目录。

| 区域 | 作用 |
|---|---|
| **Navigator** | 按活跃/运行中/离线分组实例，显示 CLI 与模型标签、自定义名称、端口，并提供预览/打开/启动/停止/重启操作 |
| **Live preview** | 通过 Manager 预览代理嵌入所选实例的 Web UI，带刷新/打开控件和预览开关 |
| **Runtime settings** | 显示所选实例的当前 CLI、模型、推理深度、权限模式、工作目录、员工、技能和设置 |
| **Notes** | 仪表盘本地的 markdown 仓库，支持文件夹树、手动保存、拖拽到文件夹、重命名、分屏预览、KaTeX、Mermaid 和代码高亮 |

发布打磨还需要补齐的截图：

1. 同样三栏布局的深色主题 dashboard。
2. 展示文件夹树、分屏编辑器/预览、已渲染 KaTeX/Mermaid/代码块的 Notes 模式。
3. 展示 responsive navigation 的 mobile 或 narrow viewport dashboard。

<details>
<summary>在 Windows 上使用？— WSL 一键安装</summary>

**步骤 1：安装 WSL**（以管理员身份打开 PowerShell）

```powershell
wsl --install
```

重启后，从 Start Menu 打开 **Ubuntu**。

**步骤 2：安装 CLI-JAW**

```bash
curl -fsSL https://raw.githubusercontent.com/lidge-jun/cli-jaw/master/scripts/install-wsl.sh | bash
```

**步骤 3：重新加载 shell 并启动**

```bash
source ~/.bashrc
copilot login    # or: claude auth / codex login / gemini
jaw serve        # → http://localhost:3457
```

WSL 脚本是集成 Linux 安装路径：它会验证 `jaw --version`，以 strict mode
请求同捆 CLI 工具，安装 OfficeCLI，并在成功前验证 `officecli --version`。
如果没有检测到可运行的 Chromium 或 Windows Chrome fallback，安装器会给出警告，
不会把 browser/web-ai 说成已经完全可用。

<details>
<summary>WSL 故障排查</summary>

| 问题 | 解决办法 |
|---|---|
| `unzip: command not found` | 重新运行 installer |
| `jaw: command not found` | `source ~/.bashrc` 或 `export PATH="$HOME/.local/bin:$PATH"` |
| `officecli: command not found` | 重新运行 WSL installer，或执行 `bash "$(npm root -g)/cli-jaw/scripts/install-officecli.sh"` |
| Permission errors | `sudo chown -R $USER $(npm config get prefix)` |

</details>
</details>

<details>
<summary>第一次用终端？— macOS 一键安装</summary>

1. 打开 **Terminal**（`Cmd + Space` → 输入 `Terminal`）
2. 粘贴下面的命令并按 Enter：

```bash
curl -fsSL https://raw.githubusercontent.com/lidge-jun/cli-jaw/master/scripts/install.sh | bash
```

3. 认证并启动：

```bash
copilot login
jaw serve        # → http://localhost:3457
```

</details>

---

## 🚀 安装与运行

```bash
npm install -g cli-jaw
jaw serve
```

普通 Linux 的 `npm install -g cli-jaw` 为了兼容性仍把 optional helper 安装视为
best-effort。需要集成安装保证时请使用 WSL 一键脚本；普通 Linux 安装后请手动验证：

```bash
jaw --version
officecli --version
jaw doctor
```

打开 **http://localhost:3457**。需要 Node.js 22+，并且至少完成下面一个 AI CLI 的认证。

> `jaw service install` — 开机自启（自动检测 systemd、launchd 或 Docker）。
>
> Claude Code 说明：如果需要 Anthropic computer-use MCP，建议使用原生 Claude installer（`curl -fsSL https://claude.ai/install.sh | bash` 或 `claude install`）。当 `claude` 看起来由 npm/bun 管理时，`jaw doctor` 现在会提示警告。

---

## 🔑 认证

只需要一个。选择你已经订阅的服务：

```bash
# Free
copilot login        # GitHub Copilot
opencode             # OpenCode — free models available

# Paid (monthly subscription)
claude auth          # Anthropic Claude Max (computer-use MCP users: native Claude install recommended)
codex login          # OpenAI ChatGPT Pro (npm/bun installs are fine)
gemini               # Google Gemini Advanced
```

检查状态：`jaw doctor`

<details>
<summary>jaw doctor 输出示例</summary>

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

## 🖥️ 使用入口

CLI-JAW 有五个使用入口。每个入口使用同一个助手、同一份记忆、同一组 skills。

| Surface | 你得到什么 |
|---|---|
| **Web PWA** | 完整 UI：markdown/KaTeX/Mermaid rendering、virtual scroll、WS streaming、drag-and-drop file upload、voice recording、PABCD roadmap bar、i18n（English, Korean, Chinese, Japanese）、dark/light theme、基于 IndexedDB 的 offline message cache |
| **Mac WebView app** | 把 `jaw serve` 包在原生 macOS app shell 中。不打开浏览器也能从 Dock 访问 |
| **Terminal TUI** | multiline editing、slash-command autocomplete、overlay selectors、session persistence、resume classification |
| **Telegram** | 语音消息（multi-provider STT）、照片、文件。scheduled task 结果会自动送达。支持 model/CLI 切换 slash commands |
| **Discord** | 文本和文件消息、command sync、channel/thread routing、agent result forwarder |

---

## 🔀 引擎路由

五个 CLI backend 通过你已有的 OAuth 订阅进行路由。没有按 token 的 API 账单。

| CLI | 默认模型 | 认证 | 费用模式 |
|---|---|---|---|
| **Claude** | `opus-4-6` | `claude auth` | Claude Max subscription |
| **Codex** | `gpt-5.5` | `codex login` | ChatGPT Pro subscription |
| **Gemini** | `gemini-3.1-pro-preview` | `gemini` | Gemini Advanced subscription |
| **OpenCode** | `minimax-m2.7` | `opencode` | Free models available |
| **Copilot** | `gpt-5-mini` | `copilot login` | Free tier available |

**Fallback chain**：某个引擎 rate-limited 或不可用时，下一个引擎会自动接上。使用 `/fallback [cli1 cli2...]` 配置。

**OpenCode wildcard**：接入任意模型 endpoint，包括 OpenRouter、local LLMs 或任何 OpenAI-compatible API。

> 切换引擎：`/cli codex`。切换模型：`/model gpt-5.5`。Web、Terminal、Telegram、Discord 都支持。

---

## 🧠 记忆

三层记忆分别负责不同的回忆范围。

| 层 | 存什么 | 如何工作 |
|---|---|---|
| **History Block** | 最近的会话上下文 | `buildHistoryBlock()` — 最近 10 个会话，最多 8000 字符，按工作目录限定范围。注入到提示开头 |
| **Memory Flush** | 从对话中提取的结构化知识 | 达到阈值后触发（默认 10 轮）。抽取提示汇总为事件记录、每日日志（`YYYY-MM-DD.md`）、实时笔记，并保存为 markdown 文件 |
| **Soul + Task Snapshot** | 身份和语义检索 | `soul.md` 定义核心价值、语调、边界。Task Snapshot 每次提示都从 FTS5 index 中搜索最多 4 条语义相关命中（每条 700 字符） |

三层都会自动进入系统提示。记忆可搜索：`jaw memory search <query>`，或在任意界面使用 `/memory <query>`。

高级记忆功能包括资料摘要、初始化/迁移、重建索引流程，可从 Web UI 设置访问。

---

## 🎭 编排 — PABCD

复杂任务使用 CLI-JAW 的 5 阶段状态机。每次状态切换都需要你确认。

```
P (Plan) → A (Audit) → B (Build) → C (Check) → D (Done) → IDLE
   ⛔         ⛔          ⛔         auto        auto
```

| Phase | 发生什么 |
|---|---|
| **P** | Boss AI 写出 diff-level plan，并停下来等你 review |
| **A** | read-only worker 验证 plan 是否可执行 |
| **B** | Boss 实现。read-only worker 验证结果 |
| **C** | type-check、docs update、consistency check |
| **D** | 汇总所有变更，然后回到 idle |

状态持久化在 DB 中，server restart 后仍然保留。Workers 不能修改文件。使用 `jaw orchestrate` 或 `/pabcd` 启用。

---

## 📦 技能

100+ skills，按用途组织。

| Category | Skills | 覆盖范围 |
|---|---|---|
| **Office** | `pdf`, `docx`, `xlsx`, `pptx`, `hwp` | 读取、创建、编辑文档。通过 OfficeCLI 支持 Korean HWP/HWPX |
| **Automation** | `browser`, `vision-click`, `screen-capture`, `desktop-control` | Chrome CDP、AI coordinate click、macOS screenshot/camera、Computer Use |
| **Media** | `video`, `imagegen`, `lecture-stt`, `tts` | Remotion video rendering、OpenAI image generation、lecture transcription、text-to-speech |
| **Integration** | `github`, `notion`, `telegram-send`, `memory` | issues/PRs/CI、Notion pages、Telegram media delivery、persistent memory |
| **Visualization** | `diagram` | 在 chat 中渲染 SVG diagrams、charts、interactive visualizations |
| **Dev guides** | `dev`, `dev-frontend`, `dev-backend`, `dev-data`, `dev-testing`, `dev-pabcd`, `dev-code-reviewer` | 注入 sub-agent prompts 的 engineering guidelines |

22 个 active skills 始终注入。94+ reference skills 按需加载。

```bash
jaw skill install <name>    # activate a reference skill
```

---

## 🌐 浏览器与桌面自动化

| Capability | 工作方式 |
|---|---|
| **Chrome CDP** | 通过 DevTools Protocol 执行导航、点击、输入、截图、执行 JS、滚动、聚焦、按键等 10 个操作 |
| **Vision-click** | 截屏后由 AI 提取目标坐标并点击。一个命令即可：`jaw browser vision-click "Login button"` |
| **DOM reference** | ChatGPT、Grok、Gemini Web UI 的选择器映射文档，覆盖模型选择、停止按钮、工具抽屉 |
| **Computer Use** | 通过 Codex App Computer Use MCP 自动化桌面应用。DOM 目标走 CDP，桌面应用走 Computer Use |
| **Diagram skill** | 生成 SVG 图表和交互式 HTML 可视化，并在带复制/保存控件的沙箱化 iframe 中渲染 |

---

## 🔌 MCP

[Model Context Protocol](https://modelcontextprotocol.io) 让 AI agents 使用外部工具。CLI-JAW 用一个文件管理五个引擎的 MCP config。

```bash
jaw mcp install @anthropic/context7
# → syncs to Claude, Codex, Gemini, OpenCode, Copilot config files
```

不用再分别编辑五个 JSON 文件。安装一次，所有引擎都会同步。

```bash
jaw mcp sync       # re-sync after manual edits
```

---

## 💬 消息

### Telegram

```
📱 Telegram ←→ 🦈 CLI-JAW ←→ 🤖 AI Engines
```

<details>
<summary>设置（3 步）</summary>

1. 创建 bot — 给 [@BotFather](https://t.me/BotFather) 发消息 → `/newbot` → 复制 token
2. 配置 — `jaw init --telegram-token YOUR_TOKEN`，或使用 Web UI settings
3. 给 bot 发送任意消息。Chat ID 会在第一条消息时自动保存

</details>

Telegram 支持：text chat、voice messages（通过 multi-provider STT 自动转写）、file/photo upload、slash commands（`/cli`、`/model`、`/status`）、scheduled task result delivery。

### Discord

能力与 Telegram 相同 — text、files、commands。支持 channel/thread routing，并带有用于 agent result broadcast 的 forwarder。通过 Web UI settings 设置。

### 语音 & STT

语音输入支持 Web（mic button）、Telegram（voice messages）和 Discord。Providers：OpenAI-compatible、Google Vertex AI 或任意 custom endpoint。通过 Web UI settings 配置。

---

## ⏰ 调度 & heartbeat

| Feature | 做什么 |
|---|---|
| **Heartbeat jobs** | 按 cron schedule 运行 unattended tasks。结果发送到 Telegram/Discord |
| **Service auto-start** | `jaw service install` — 自动检测 systemd（Linux）、launchd（macOS）或 Docker |
| **Memory auto-reflect** | 用于 structured knowledge extraction 的 optional post-flush reflection |

---

## ⌨️ CLI 命令

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

## 🏗️ 多实例

运行彼此隔离的实例。每个实例都有独立 settings、memory 和 database。

```bash
jaw clone ~/my-project
jaw --home ~/my-project serve --port 3458
```

每个实例完全独立 — working directory、memory、MCP config 都不同。

---

## 🔗 远程访问（Tailscale）

```bash
jaw serve --lan                       # bind 0.0.0.0 + allow tailnet peers
# settings.json: network.bindHost=0.0.0.0, lanBypass=true
```

`lanBypass=true` 时支持的 peer addresses：

- `100.64.0.0/10` — Tailscale CGNAT (RFC 6598)
- `fd7a:115c:a1e0::/48` — Tailscale ULA
- `*.ts.net` — MagicDNS hostnames（Host + Origin both pass）

注意事项：

- Tailnet peers 已通过 WireGuard + IdP 认证 — 把它们当作 LAN，而不是 public。
- Shared tailnets：结合 Tailscale ACL（`acl.tailnet`）限制谁能访问 node。
- Subnet router / exit node：SNAT 会把 peer IP 折叠成 router 的 100.x，trust boundary 会变模糊。建议使用 direct tailnet membership。
- Production：尽量把 `bindHost` 缩到 `tailscale0` interface address，而不是 `0.0.0.0`。
- `lanBypass=true` 时，tailnet peers 会跳过 Bearer token（与 RFC 1918 一样按 LAN 处理）。如需让所有非 loopback peer 都提供 `JAW_AUTH_TOKEN`，设置 `lanBypass=false`。

---

## 🐳 Docker

```bash
docker compose up -d       # → http://localhost:3457
```

使用非 root 的 `jaw` 用户，并启用 Chromium sandbox。包含两个 Dockerfile：`Dockerfile`（npm install）和 `Dockerfile.dev`（local source）。数据保存在 `jaw-data` named volume 中。

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

## 📖 文档

| 文档 | 内容 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Release log，包括覆盖 v1.2.0 到 v1.5.1 的 v1.6.0 catch-up |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design、module graph、94 个 endpoints 上的 95 个 API handlers |
| [TESTS.md](TESTS.md) | Test coverage、counts、test plan |
| [memory-architecture.md](docs/memory-architecture.md) | 3-layer memory model、indexing、runtime behavior |
| [env-vars.md](docs/env-vars.md) | Environment variable reference |
| [skill-router-plan.md](docs/skill-router-plan.md) | Skill routing architecture |
| [officecli-integration.md](docs/officecli-integration.md) | 面向 HWP/HWPX 和 Office documents 的 OfficeCLI setup |
| [devlog/structure/](devlog/structure/) | Internal architecture reference — prompt pipeline、agent spawn、frontend、server API、commands、Telegram、memory |

---

## ⚖️ 对比

| | CLI-JAW | Hermes Agent | Claude Code |
|---|---|---|---|
| **Model access** | OAuth subscriptions（Claude Max、ChatGPT Pro、Copilot、Gemini）+ OpenCode wildcard | API keys（OpenRouter 200+、Nous Portal） | Anthropic only |
| **Cost model** | 你已经支付的 monthly subscriptions | Per-token API billing | Anthropic subscription |
| **Primary UI** | Web PWA + Mac app + TUI | TUI only | CLI + IDE plugins |
| **Messaging** | Telegram（voice）+ Discord | Telegram/Discord/Slack/WhatsApp/Signal | None |
| **Memory** | 3-layer（History/Flush/Soul）+ FTS5 | Self-improving learning loop + Honcho | File-based auto-memory |
| **Browser automation** | Chrome CDP + vision-click + DOM ref | Limited | Via MCP |
| **Orchestration** | PABCD 5-phase FSM | Subagent spawn | Task tool |
| **Execution** | Local + Docker | Local/Docker/SSH/Daytona/Modal/Singularity | Local |
| **Skills** | 100+ bundled | Self-creating + agentskills.io | User-configured |
| **i18n** | English, Korean, Chinese, Japanese | English | English |

CLI-JAW 源自 OpenClaw harness architecture（hybrid search manager、fallback patterns、session indexing）。如果从 OpenClaw 迁移，slash-command surface 和 memory model 会很熟悉。

---

## 🛠️ 开发

```bash
npm run build          # tsc → dist/
npm run dev            # tsx server.ts (hot-reload)
npm test               # native Node.js test runner
```

Architecture 和 test details 见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)、[TESTS.md](TESTS.md) 和 [devlog/structure/](devlog/structure/)。

---

## ❓ 故障排查

| 问题 | 解决办法 |
|---|---|
| `cli-jaw: command not found` | 重新运行 `npm install -g cli-jaw`。确认 `npm bin -g` 在 `$PATH` 中 |
| `Error: node version` | 升级到 Node.js 22+：`nvm install 22` |
| `NODE_MODULE_VERSION` mismatch | `npm run ensure:native`（auto-rebuild） |
| `EADDRINUSE: port 3457` | 另一个 instance 正在运行。使用 `--port 3458` |
| Telegram or agent auth fails | 运行 `jaw doctor`，然后重启 `jaw serve` |
| Browser commands fail | 安装 Chrome。先运行 `jaw browser start` |

---

## 🤝 参与贡献

1. 从 `master` fork 并创建 branch
2. `npm run build && npm test`
3. 提交 PR

发现 bug 或有想法？[Open an issue](https://github.com/lidge-jun/cli-jaw/issues)

---

<div align="center">

**[MIT License](LICENSE)**

</div>
