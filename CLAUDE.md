# CLI-JAW Claude Guide

This repository is a Node.js ESM orchestration runtime for boss/employee dispatch, Web UI, browser/CDP automation, Telegram/Discord channels, memory, heartbeat, and PABCD orchestration.

## Documentation Map

- Start at `structure/INDEX.md` for the current architecture map.
- Keep `README.md`, `AGENTS.md`, this file, and `structure/AGENTS.md` aligned when command/API/orchestration behavior changes.
- Do not use the old `devlog/structure/` path for architecture docs; the active folder is `structure/`.

## Current Runtime Notes

- PABCD entry is explicit: `jaw orchestrate`, `/orchestrate`, or `/pabcd`. Resume is explicit `/continue`; natural-language “continue/계속/이어서” remains a normal prompt.
- Gemini full-access runs use `--skip-trust --approval-mode yolo` on both fresh and resume sessions.
- `/api/channel/send` is the canonical outbound Telegram/Discord delivery endpoint.
- Heartbeat schedules support `{ kind: "every", minutes }` and `{ kind: "cron", cron, timeZone? }`.
- Tool logs are capped by `src/shared/tool-log-sanitize.ts` before WebSocket, `agent_done`, and orchestration snapshot delivery.
- `jaw browser fetch <url>` is the adaptive URL-reader mirror from agbrowse: use it for a known URL/search-result URL, not as generic search.

## Local Gates

Prefer the existing gates only:

```bash
npm run gate:all
npm test
bash structure/audit-fin-status.sh
```

Doc-only changes should not modify `.mjs`, `.js`, or `.ts` source files unless explicitly requested.
