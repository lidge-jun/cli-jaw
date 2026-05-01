# cli-jaw Electron Desktop Shell

Thin Electron wrapper around the jaw manager dashboard. Loads `http://127.0.0.1:24576/manager/`
and manages the lifecycle of the underlying `jaw dashboard serve` process.

> Native deps (`better-sqlite3`, `playwright-core`, `sharp`, `canvas`) live exclusively in the
> manager server. The Electron main process never imports them.

## Install

```bash
# from the repo root
npm install
npm --prefix electron install
```

## Develop

From the repo root (concurrently spawns the dashboard server + Electron with HMR):

```bash
npm run electron:dev
```

Or, if a manager server is already running on 24576:

```bash
npm --prefix electron run dev
```

## Build

```bash
npm run electron:build
# outputs:
#   electron/out/main/index.js
#   electron/out/preload/index.js
```

## Run a built artifact

```bash
npm --prefix electron run start
```

## Environment variables

| Var | Default | Description |
|---|---|---|
| `JAW_MANAGER_URL` | `http://127.0.0.1:24576/` | Manager URL to attach to |
| `JAW_MANAGER_PORT` | `24576` | Port (used when URL is not set) |
| `JAW_BIN` | _(auto-detected)_ | Path to `jaw` CLI binary |
| `JAW_ELECTRON_DEVTOOLS` | _(unset)_ | Set to `1` to open DevTools |
| `NODE_ENV` | _(unset)_ | `development` enables DevTools |

## CLI flags

```
--port <n>          Override manager port (default 24576)
--manager-url <url> Override full manager URL
--attach-only       Never spawn jaw dashboard serve; only attach
--spawn             Force spawn even if no health probe is required
```

## Lifecycle

1. Health-check `${MANAGER_URL}api/dashboard/health` with backoff 200/400/800/1600/3000/5000ms (up to 60s).
2. Healthy → load URL.
3. Unhealthy and not `--attach-only` → discover `jaw` binary, spawn `jaw dashboard serve --port <port>`, re-check.
4. Binary missing → native dialog (install guide / pick path / quit).
5. Crash loop guard: more than 3 manager exits within 60s stops auto-restart and shows a dialog.
6. Quit → `SIGTERM` → 5s grace → `SIGKILL`.
