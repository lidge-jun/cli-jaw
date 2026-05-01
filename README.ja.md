<div align="center">

# CLI-JAW

### すでに契約している AI サブスクを、ひとつのアシスタントへ。

[![npm](https://img.shields.io/npm/v/cli-jaw)](https://npmjs.com/package/cli-jaw)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://typescriptlang.org)
[![Node](https://img.shields.io/badge/node-%3E%3D22-blue)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-supported-2496ED?logo=docker&logoColor=white)](#-docker)

[English](README.md) / [한국어](README.ko.md) / [中文](README.zh-CN.md) / **日本語**

![CLI-JAW manager dashboard](docs/screenshots/manager-dashboard-light.png)

</div>

<table>
<tr><td><b>既存のサブスクを統合</b></td><td>Claude Max、ChatGPT Pro、Copilot、Gemini Advanced を OAuth 経由でルーティングします。OpenCode から任意のモデルも追加できます。token 単位の課金はありません。</td></tr>
<tr><td><b>Manager dashboard</b></td><td>ローカルの JAW インスタンスをすべて追跡し、リアルタイム Web UI をプレビューし、ライト/ダークテーマを切り替え、ランタイム設定を確認し、管理対象セッションをひとつのブラウザワークスペースから開始または停止できます。</td></tr>
<tr><td><b>Notes workspace</b></td><td>ダッシュボードのホーム配下にある Markdown vault です。フォルダ、名前変更/移動、未保存状態の表示、raw/split/preview モード、KaTeX、Mermaid、コードハイライトをサポートします。</td></tr>
<tr><td><b>いつもの場所で使える</b></td><td>Manager dashboard、Web PWA、Mac WebView app、ターミナル TUI、音声対応 Telegram、Discord。どの入口でも同じアシスタントと同じメモリを使います。</td></tr>
<tr><td><b>3-layer memory</b></td><td>History Block（直近のセッション）+ Memory Flush（episodes、daily logs）+ Soul and Task Snapshot（identity、semantic recall）。SQLite FTS5 の全文検索を使います。</td></tr>
<tr><td><b>Multi-agent orchestration</b></td><td>PABCD は DB に永続化される 5 段階 FSM です。worker registry 付き Employee system、file-overlap detection 付き parallel subtasks に対応し、すべての phase をユーザーが承認します。</td></tr>
<tr><td><b>Browser and desktop automation</b></td><td>Chrome CDP、vision-click、ChatGPT/Grok/Gemini 向け DOM reference、Codex App 経由の Computer Use 統合、SVG と interactive visualization 用の diagram skill を備えています。</td></tr>
<tr><td><b>MCP install once, 5 engines</b></td><td><code>jaw mcp install</code> で Claude、Codex、Gemini、OpenCode、Copilot へ同時に同期します。設定ファイルはひとつだけです。</td></tr>
<tr><td><b>多言語対応</b></td><td>English、Korean、Chinese、Japanese README。i18n Web UI。OfficeCLI による HWP/HWPX 韓国語オフィス文書サポート。</td></tr>
</table>

---

## クイックリンク

- [インストール](#-インストール--実行) · [認証](#-認証) · [利用できる場所](#-利用できる場所)
- [エンジンルーティング](#-エンジンルーティング) · [メモリ](#-メモリ) · [PABCD](#-オーケストレーション--pabcd) · [スキル](#-スキル)
- [ブラウザ自動化](#-ブラウザ--デスクトップ自動化) · [MCP](#-mcp) · [メッセージング](#-メッセージング)
- [CLI コマンド](#%EF%B8%8F-cli-コマンド) · [Docker](#-docker) · [ドキュメント](#-ドキュメント) · [比較](#%EF%B8%8F-比較)

---

## Manager dashboard

Dashboard は、CLI-JAW をローカルで動かすためのメインコントロールプレーンです。インスタンス検出、プレビュー、設定、従業員、Notes を一か所にまとめつつ、各インスタンスはそれぞれのホーム、データベース、メモリ、ライフサイクルメタデータ、作業ディレクトリを保持します。

| 領域 | 機能 |
|---|---|
| **Navigator** | アクティブ/実行中/オフラインのインスタンスをグループ化し、CLI とモデルのラベル、カスタム名、ポート、プレビュー/開く/起動/停止/再起動の直接操作を表示します |
| **Live preview** | 選択したインスタンスの Web UI を Manager のプレビュープロキシ経由で埋め込みます。更新/開く操作とプレビュー切り替え付きです |
| **Runtime settings** | 選択したインスタンスの現在の CLI、モデル、推論深度、権限モード、作業ディレクトリ、従業員、スキル、設定を表示します |
| **Notes** | ダッシュボードローカルの markdown vault です。フォルダツリー、手動保存、フォルダへのドラッグ移動、名前変更、分割プレビュー、KaTeX、Mermaid、コードハイライトに対応します |

リリース仕上げのために、まだ追加が必要なスクリーンショット:

1. 同じ 3 ペインレイアウトのダークテーマ dashboard。
2. フォルダツリー、分割エディタ/プレビュー、レンダリング済み KaTeX/Mermaid/コードブロックを表示した Notes モード。
3. レスポンシブナビゲーションが分かる mobile または narrow viewport dashboard。

<details>
<summary>Windows を使っていますか？— WSL one-click setup</summary>

**Step 1: WSL をインストール**（管理者 PowerShell）

```powershell
wsl --install
```

再起動したら、Start Menu から **Ubuntu** を開きます。

**Step 2: CLI-JAW をインストール**

```bash
curl -fsSL https://raw.githubusercontent.com/lidge-jun/cli-jaw/master/scripts/install-wsl.sh | bash
```

**Step 3: shell を再読み込みして起動**

```bash
source ~/.bashrc
copilot login    # or: claude auth / codex login / gemini
jaw serve        # → http://localhost:3457
```

<details>
<summary>WSL トラブルシューティング</summary>

| 問題 | 対処 |
|---|---|
| `unzip: command not found` | installer を再実行します |
| `jaw: command not found` | `source ~/.bashrc` |
| Permission errors | `sudo chown -R $USER $(npm config get prefix)` |

</details>
</details>

<details>
<summary>ターミナルが初めてですか？— One-click install (macOS)</summary>

1. **Terminal** を開きます（`Cmd + Space` → `Terminal` と入力）
2. 次のコマンドを貼り付けて Enter を押します:

```bash
curl -fsSL https://raw.githubusercontent.com/lidge-jun/cli-jaw/master/scripts/install.sh | bash
```

3. 認証して起動します:

```bash
copilot login
jaw serve        # → http://localhost:3457
```

</details>

---

## 🚀 インストール & 実行

```bash
npm install -g cli-jaw
jaw serve
```

**http://localhost:3457** を開きます。Node.js 22+ と、下記 AI CLI のうち少なくともひとつの認証が必要です。

> `jaw service install` — 起動時の自動開始を設定します（systemd、launchd、Docker を自動検出）。
>
> Claude Code note: Anthropic computer-use MCP が必要な場合は、native Claude installer を推奨します（`curl -fsSL https://claude.ai/install.sh | bash` または `claude install`）。`claude` が npm/bun 管理に見える場合、`jaw doctor` は警告を出します。

---

## 🔑 認証

必要なのはひとつだけです。すでに契約している subscription を選んでください:

```bash
# Free
copilot login        # GitHub Copilot
opencode             # OpenCode — free models available

# Paid (monthly subscription)
claude auth          # Anthropic Claude Max (computer-use MCP users: native Claude install recommended)
codex login          # OpenAI ChatGPT Pro (npm/bun installs are fine)
gemini               # Google Gemini Advanced
```

状態確認: `jaw doctor`

<details>
<summary>jaw doctor output の例</summary>

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

## 🖥️ 利用できる場所

CLI-JAW は 5 つの surface から使えます。どれを使っても、同じアシスタント、同じメモリ、同じ skills です。

| Surface | できること |
|---|---|
| **Web PWA** | markdown/KaTeX/Mermaid rendering、virtual scroll、WS streaming、drag-and-drop file upload、voice recording、PABCD roadmap bar、i18n（English, Korean, Chinese, Japanese）、dark/light theme、IndexedDB による offline message cache を備えたフル UI |
| **Mac WebView app** | `jaw serve` を native macOS app shell で包みます。ブラウザを開かず Dock からアクセスできます |
| **Terminal TUI** | 複数行編集、slash-command autocomplete、overlay selectors、セッション永続化、resume classification |
| **Telegram** | 音声メッセージ（multi-provider STT）、写真、ファイル。Scheduled task results を自動配信します。model/CLI switching 用 slash commands 付きです |
| **Discord** | テキストとファイルのメッセージング、command sync、チャンネルとスレッドのルーティング、Agent 実行結果用 forwarder |

---

## 🔀 エンジンルーティング

5 つの CLI backend を、すでに支払っている OAuth subscription 経由でルーティングします。トークン単位の API 課金はありません。

| CLI | Default model | Auth | Cost model |
|---|---|---|---|
| **Claude** | `opus-4-6` | `claude auth` | Claude Max subscription |
| **Codex** | `gpt-5.5` | `codex login` | ChatGPT Pro subscription |
| **Gemini** | `gemini-3.1-pro-preview` | `gemini` | Gemini Advanced subscription |
| **OpenCode** | `minimax-m2.7` | `opencode` | Free models available |
| **Copilot** | `gpt-5-mini` | `copilot login` | Free tier available |

**Fallback chain**: ある engine が rate limit にかかったり停止したりした場合、次の engine が自動で引き継ぎます。`/fallback [cli1 cli2...]` で設定します。

**OpenCode wildcard**: OpenRouter、local LLMs、任意の OpenAI-compatible API など、好きな model endpoint を接続できます。

> エンジン切り替え: `/cli codex`。モデル切り替え: `/model gpt-5.5`。Web、Terminal、Telegram、Discord すべてで使えます。

---

## 🧠 メモリ

3 つのレイヤーが、それぞれ異なるリコール範囲を担当します。

| Layer | 保存するもの | 動作 |
|---|---|---|
| **History Block** | 直近のセッションコンテキスト | `buildHistoryBlock()` — 直近 10 セッション、最大 8000 文字、working directory ごとにスコープ。プロンプト先頭へ注入します |
| **Memory Flush** | 会話から抽出した構造化ナレッジ | しきい値後に実行されます（デフォルト 10 ターン）。抽出プロンプトがエピソード、日次ログ（`YYYY-MM-DD.md`）、ライブノートに要約し、markdown ファイルとして保存します |
| **Soul + Task Snapshot** | アイデンティティとセマンティック検索 | `soul.md` がコアバリュー、トーン、境界を定義します。Task Snapshot は各プロンプトごとに FTS5 index から意味的に関連するヒットを最大 4 件（各 700 文字）探します |

3 つのレイヤーはすべてシステムプロンプトに自動で入ります。検索は `jaw memory search <query>`、または任意の interface から `/memory <query>` で行えます。

Advanced memory にはプロフィールサマリ、初期化/マイグレーション、再インデックスフローがあり、Web UI 設定からアクセスできます。

---

## 🎭 オーケストレーション — PABCD

複雑なタスクでは、CLI-JAW は 5 段階のステートマシンを使います。すべての遷移はユーザー承認制です。

```
P (Plan) → A (Audit) → B (Build) → C (Check) → D (Done) → IDLE
   ⛔         ⛔          ⛔         auto        auto
```

| Phase | 内容 |
|---|---|
| **P** | Boss AI が diff-level plan を書きます。あなたの review のために停止します |
| **A** | Read-only worker が plan の実行可能性を検証します |
| **B** | Boss が実装します。Read-only worker が結果を検証します |
| **C** | Type-check、docs update、consistency check を実行します |
| **D** | すべての変更を要約し、idle に戻ります |

State は DB-persisted で、server restart 後も残ります。Workers はファイルを変更できません。`jaw orchestrate` または `/pabcd` で有効化します。

---

## 📦 スキル

100+ skills が用途別に整理されています。

| Category | Skills | 対応範囲 |
|---|---|---|
| **Office** | `pdf`, `docx`, `xlsx`, `pptx`, `hwp` | 文書の読み取り、作成、編集。OfficeCLI による Korean HWP/HWPX |
| **Automation** | `browser`, `vision-click`, `screen-capture`, `desktop-control` | Chrome CDP、AI-powered coordinate click、macOS screenshot/camera、Computer Use |
| **Media** | `video`, `imagegen`, `lecture-stt`, `tts` | Remotion video rendering、OpenAI image generation、lecture transcription、text-to-speech |
| **Integration** | `github`, `notion`, `telegram-send`, `memory` | Issues/PRs/CI、Notion pages、Telegram media delivery、persistent memory |
| **Visualization** | `diagram` | Chat 内でレンダリングされる SVG diagrams、charts、interactive visualizations |
| **Dev guides** | `dev`, `dev-frontend`, `dev-backend`, `dev-data`, `dev-testing`, `dev-pabcd`, `dev-code-reviewer` | sub-agent prompts に注入される engineering guidelines |

22 active skills は常に注入されます。94+ reference skills は必要に応じて読み込まれます。

```bash
jaw skill install <name>    # activate a reference skill
```

---

## 🌐 ブラウザ & デスクトップ自動化

| Capability | 動作 |
|---|---|
| **Chrome CDP** | DevTools Protocol で移動、クリック、入力、スクリーンショット、JS 実行、スクロール、フォーカス、キー入力など 10 個のアクションを実行します |
| **Vision-click** | 画面をスクリーンショットし、AI が対象座標を抽出してクリックします。コマンドはひとつです: `jaw browser vision-click "Login button"` |
| **DOM reference** | ChatGPT、Grok、Gemini Web UI のセレクタマップです。モデル選択、停止ボタン、ツールドロワーを扱います |
| **Computer Use** | Codex App Computer Use MCP によるデスクトップアプリ自動化です。DOM ターゲットは CDP へ、デスクトップアプリは Computer Use へルーティングします |
| **Diagram skill** | SVG diagrams とインタラクティブな HTML ビジュアライゼーションを生成し、コピー/保存コントロール付きの sandbox 化された iframe にレンダリングします |

---

## 🔌 MCP

[Model Context Protocol](https://modelcontextprotocol.io) により、AI agents は外部 tools を使えます。CLI-JAW は 5 つの engines の MCP config をひとつのファイルで管理します。

```bash
jaw mcp install @anthropic/context7
# → syncs to Claude, Codex, Gemini, OpenCode, Copilot config files
```

5 つの JSON files を別々に編集する必要はありません。一度インストールすれば、すべての engines に適用されます。

```bash
jaw mcp sync       # re-sync after manual edits
```

---

## 💬 メッセージング

### Telegram

```
📱 Telegram ←→ 🦈 CLI-JAW ←→ 🤖 AI Engines
```

<details>
<summary>Setup（3 steps）</summary>

1. bot を作成 — [@BotFather](https://t.me/BotFather) にメッセージ → `/newbot` → token をコピー
2. 設定 — `jaw init --telegram-token YOUR_TOKEN` または Web UI settings を使用
3. bot に任意のメッセージを送信します。Chat ID は初回メッセージで自動保存されます

</details>

Telegram で使えるもの: テキストチャット、音声メッセージ（multi-provider STT による自動文字起こし）、file/photo upload、slash commands（`/cli`、`/model`、`/status`）、scheduled task result delivery。

### Discord

Telegram と同じ機能です — テキスト、ファイル、コマンド。チャンネルとスレッドのルーティングと、Agent 実行結果のブロードキャスト用 forwarder をサポートします。設定は Web UI settings から行います。

### Voice & STT

音声入力は Web（mic button）、Telegram（voice messages）、Discord で動作します。Providers は OpenAI-compatible、Google Vertex AI、任意の custom endpoint です。Web UI settings で設定します。

---

## ⏰ Scheduling & heartbeat

| Feature | 内容 |
|---|---|
| **Heartbeat jobs** | Cron-scheduled tasks を unattended で実行します。結果は Telegram/Discord に配信されます |
| **Service auto-start** | `jaw service install` — systemd（Linux）、launchd（macOS）、Docker を自動検出します |
| **Memory auto-reflect** | structured knowledge extraction のための optional post-flush reflection |

---

## ⌨️ CLI コマンド

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

## 🏗️ マルチインスタンス

settings、memory、database が分離されたインスタンスを実行します。

```bash
jaw clone ~/my-project
jaw --home ~/my-project serve --port 3458
```

各インスタンスは完全に独立しています — working directory、memory、MCP config はそれぞれ別です。

---

## 🔗 リモートアクセス（Tailscale）

```bash
jaw serve --lan                       # bind 0.0.0.0 + allow tailnet peers
# settings.json: network.bindHost=0.0.0.0, lanBypass=true
```

`lanBypass=true` のときに対応する peer addresses:

- `100.64.0.0/10` — Tailscale CGNAT (RFC 6598)
- `fd7a:115c:a1e0::/48` — Tailscale ULA
- `*.ts.net` — MagicDNS hostnames（Host + Origin both pass）

注意点:

- Tailnet peers は WireGuard + IdP authenticated です — public ではなく LAN として扱います。
- Shared tailnets: Tailscale ACL（`acl.tailnet`）と組み合わせ、node に到達できるユーザーを制限します。
- Subnet router / exit node: SNAT により peer IPs が router の 100.x に畳まれ、trust boundary が曖昧になります。direct tailnet membership を推奨します。
- Production: 可能なら `bindHost` は `0.0.0.0` ではなく `tailscale0` interface address に絞ります。
- `lanBypass=true` では、tailnet peers は Bearer token をスキップします（RFC 1918 と同じ LAN 扱い）。loopback 以外のすべての peer に `JAW_AUTH_TOKEN` を要求するには `lanBypass=false` を設定します。

---

## 🐳 Docker

```bash
docker compose up -d       # → http://localhost:3457
```

Non-root `jaw` user と Chromium sandbox を使います。Dockerfiles は 2 つです: `Dockerfile`（npm install）と `Dockerfile.dev`（local source）。Data は `jaw-data` named volume に保持されます。

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

## 📖 ドキュメント

| Document | 内容 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | v1.2.0 から v1.5.1 までを含む v1.6.0 catch-up release log |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design、module graph、94 endpoints にまたがる 95 API handlers |
| [TESTS.md](TESTS.md) | Test coverage、counts、test plan |
| [memory-architecture.md](docs/memory-architecture.md) | 3-layer memory model、indexing、runtime behavior |
| [env-vars.md](docs/env-vars.md) | Environment variable reference |
| [skill-router-plan.md](docs/skill-router-plan.md) | Skill routing architecture |
| [officecli-integration.md](docs/officecli-integration.md) | HWP/HWPX と Office documents のための OfficeCLI setup |
| [devlog/structure/](devlog/structure/) | Internal architecture reference — prompt pipeline、agent spawn、frontend、server API、commands、Telegram、memory |

---

## ⚖️ 比較

| | CLI-JAW | Hermes Agent | Claude Code |
|---|---|---|---|
| **Model access** | OAuth subscriptions（Claude Max、ChatGPT Pro、Copilot、Gemini）+ OpenCode wildcard | API keys（OpenRouter 200+、Nous Portal） | Anthropic only |
| **Cost model** | すでに支払っている monthly subscriptions | Per-token API billing | Anthropic subscription |
| **Primary UI** | Web PWA + Mac app + TUI | TUI only | CLI + IDE plugins |
| **Messaging** | Telegram（voice）+ Discord | Telegram/Discord/Slack/WhatsApp/Signal | None |
| **Memory** | 3-layer（History/Flush/Soul）+ FTS5 | Self-improving learning loop + Honcho | File-based auto-memory |
| **Browser automation** | Chrome CDP + vision-click + DOM ref | Limited | Via MCP |
| **Orchestration** | PABCD 5-phase FSM | Subagent spawn | Task tool |
| **Execution** | Local + Docker | Local/Docker/SSH/Daytona/Modal/Singularity | Local |
| **Skills** | 100+ bundled | Self-creating + agentskills.io | User-configured |
| **i18n** | English, Korean, Chinese, Japanese | English | English |

CLI-JAW は OpenClaw harness architecture（hybrid search manager、fallback patterns、session indexing）を受け継いでいます。OpenClaw から移行する場合、slash-command surface と memory model はなじみやすいはずです。

---

## 🛠️ 開発

```bash
npm run build          # tsc → dist/
npm run dev            # tsx server.ts (hot-reload)
npm test               # native Node.js test runner
```

Architecture と test details は [ARCHITECTURE.md](docs/ARCHITECTURE.md)、[TESTS.md](TESTS.md)、[devlog/structure/](devlog/structure/) にあります。

---

## ❓ トラブルシューティング

| 問題 | 解決策 |
|---|---|
| `cli-jaw: command not found` | `npm install -g cli-jaw` を再実行します。`npm bin -g` が `$PATH` に入っているか確認してください |
| `Error: node version` | Node.js 22+ に上げます: `nvm install 22` |
| `NODE_MODULE_VERSION` mismatch | `npm run ensure:native`（auto-rebuild） |
| `EADDRINUSE: port 3457` | 別の instance が実行中です。`--port 3458` を使ってください |
| Telegram or agent auth fails | `jaw doctor` を実行し、その後 `jaw serve` を再起動してください |
| Browser commands fail | Chrome をインストールしてください。先に `jaw browser start` を実行します |

---

## 🤝 コントリビューション

1. `master` から fork して branch を作成します
2. `npm run build && npm test`
3. PR を提出します

バグを見つけた、またはアイデアがありますか？ [Issue を開いてください](https://github.com/lidge-jun/cli-jaw/issues)

---

<div align="center">

**[MIT License](LICENSE)**

</div>
