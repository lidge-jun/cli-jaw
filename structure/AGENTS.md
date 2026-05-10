> 📚 [INDEX](INDEX.md) · [Sync Checklist](AGENTS.md) · [Commands](commands.md) · [Server API](server_api.md) · [Stream Events](stream-events.md) · [str_func](str_func.md)

# structure/ — Sync Guide

- Keep this folder aligned with the live `cli-jaw` tree. The current hub covers 17 Markdown docs plus 5 support files.
- Update `INDEX.md` whenever a doc is added, removed, renamed, or re-scoped. Keep the doc map, tier list, and quick links in sync.
- Update `str_func.md` and `verify-counts.sh` together when source counts, `server.ts`, `src/routes/*`, `src/cli/handlers*.ts`, `src/cli/api-auth.ts`, `src/manager/*` (multi-instance dashboard), `bin/commands/*`, `bin/star-prompt.ts`, `tests/`, `public/`, or `public/dist/` totals change.
- `stream-events.md` is the event-trace companion for `frontend.md`, `server_api.md`, and the ProcessBlock pipeline. Keep those references current.
- `normalize-status.ts` and `status-scope.json` feed the fin-status audit flow. If their contract changes, update `audit-fin-status.sh` and any related docs in this folder.
- When a command, API, UI, memory, or orchestration surface changes, sync the relevant doc(s) in this directory in the same change.
- Route refactors belong in `INDEX.md`, `server_api.md`, `infra.md`, and `str_func.md`. CLI handler splits and auth helper changes belong in `commands.md`, `memory_architecture.md`, `telegram.md`, and `str_func.md`.

## Current sync hotspots (2026-05)

When refreshing docs from recent non-strict commits, check these first:

- `src/orchestrator/parser.ts` / `pipeline.ts`: `/continue` is slash-only; do not document natural-language continue as resume.
- `src/agent/args.ts` + `src/agent/spawn.ts`: Gemini full-access must keep auto-approval and pass OS home roots through `--include-directories` so cwd-external folders do not fail with `Path not in workspace`; WSL should include both Linux home and the Windows user home when discoverable.
- `src/shared/tool-log-sanitize.ts`: bounded tool-log storage/delivery protects Web UI and Manager ProcessBlock hydration.
- `src/messaging/send.ts` + `src/routes/messaging.ts`: `/api/channel/send` is canonical outbound channel delivery.
- `src/browser/runtime-*`, `src/browser/tab-lifecycle.ts`, `src/browser/web-ai/session*.ts`: browser docs should mention runtime diagnostics, orphan cleanup, tab lifecycle, and web-ai session reattach.
- `src/routes/traces.ts` / `src/trace/*`: server docs should include public trace read routes and related WebSocket/event surfaces such as `alert_escalation`.
- `src/manager/notes/search.ts` / `src/manager/notes/routes.ts` / `public/manager/src/notes/NotesSearchSidebar.tsx`: Manager notes docs should include ripgrep-backed search, `/api/dashboard/notes/search`, typed errors, abortable sidebar search, and search CSS.
- `src/manager/reminders/*` / `public/manager/src/dashboard-reminders/*`: Manager docs should include dashboard reminders API, notification scheduler, matrix buckets, top-priority strip, detail popover, and drag/drop bucket moves.
- `src/orchestrator/pipeline.ts` / `src/orchestrator/state-machine.ts` / `skills_ref/dev*/SKILL.md`: PABCD docs should keep the `Project root: <absolute path>` dispatch contract and strict TypeScript + existing SOT/devlog discovery guidance aligned.
- Keep root `AGENTS.md` and `CLAUDE.md` aligned with this folder when the architecture map changes.
