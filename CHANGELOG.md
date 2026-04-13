# Changelog

This changelog is intentionally long-form. `v1.6.0` is the first release that fully documents the product and platform changes accumulated since `v1.2.0`.

---

## 1.6.0 - 2026-04-13

### Release Positioning

`v1.6.0` is the documentation catch-up release for the work delivered between `v1.2.0` and `v1.5.1`.

- Range covered: `v1.2.0` -> `v1.5.1`
- Git delta: `59` commits
- Repository delta: `307` files changed
- Code churn: `32,760` insertions / `4,263` deletions
- Overall theme: CLI-JAW expanded from a capable personal AI assistant into a broader local operating environment with stronger orchestration, memory, UI, channel support, diagnostics, and release machinery

### Executive Summary

From `v1.2.0` onward, CLI-JAW changed in five major ways.

- It became much more orchestration-aware, with explicit multi-agent workflow commands, a persisted PABCD state machine, and worker lifecycle management.
- It replaced lightweight memory assumptions with a structured indexed memory runtime.
- It broadened the communication surface from web/terminal/Telegram into Discord and more mature voice/STT flows.
- It dramatically expanded the frontend, adding richer settings, memory controls, heartbeat UX, tool rendering, and diagram/widget support.
- It hardened packaging, browser launch behavior, CI, preview releases, and operator diagnostics enough that release/installation workflows are now part of the product story, not just internal tooling.

### Headline Changes

#### 1. Multi-Agent Orchestration Became a Core Product Capability

The orchestration system is no longer a thin wrapper around agent spawning. It now exposes explicit entry points, state, and review flow that users can reason about and operate.

- Added `jaw dispatch` and `jaw orchestrate` command surfaces.
- Added persisted orchestration state and worker registry handling.
- Added research dispatch and replay-aware worker flow.
- Added live orchestration state presentation in the web UI.
- Strengthened pipeline and race handling around long-lived orchestration flows.

Key areas:

- `bin/commands/dispatch.ts`
- `bin/commands/orchestrate.ts`
- `src/orchestrator/pipeline.ts`
- `src/orchestrator/state-machine.ts`
- `src/orchestrator/worker-registry.ts`
- `public/css/orc-state.css`

#### 2. Memory Became Structured, Indexed, and Operationally Visible

Memory moved far beyond a simple persistence layer.

- Added structured storage model and runtime status reporting.
- Added bootstrap and migration logic for memory ingestion.
- Added SQLite FTS5 indexing and keyword/query expansion.
- Added task snapshots and profile-context aware prompt injection.
- Added reindex/audit controls and clearer memory-facing docs.

Key areas:

- `src/memory/bootstrap.ts`
- `src/memory/indexing.ts`
- `src/memory/runtime.ts`
- `src/memory/keyword-expand.ts`
- `docs/memory-architecture.md`
- `server.ts` memory routes

#### 3. Channels Expanded: Discord and Voice Are Now First-Class

CLI-JAW used to be defined mostly by web, terminal, and Telegram. That boundary no longer holds.

- Added Discord bot, Discord commands, and Discord forwarding flows.
- Added more resilient attachment handling, including multi-file flows.
- Added voice/STT pathways spanning web recording and Telegram voice input.
- Added channel-specific settings controls in the UI.

Key areas:

- `src/discord/bot.ts`
- `src/discord/commands.ts`
- `src/discord/forwarder.ts`
- `public/js/features/settings-discord.ts`
- `src/telegram/voice.ts`
- `lib/stt.ts`
- `prompts/stt-system.md`
- `public/js/features/voice-recorder.ts`

#### 4. The Web App Was Substantially Rebuilt

The frontend delta since `v1.2.0` is not cosmetic. It is a large product-surface expansion.

- Settings UX became broader and more modular.
- Memory and heartbeat controls gained dedicated UI flows.
- Tool UI and streaming render behavior improved materially.
- Provider icons, gesture handling, process blocking, drag/drop handling, and virtual scrolling were added.
- Frontend asset delivery modernized around Vite and generated bundles.

Key areas:

- `public/index.html`
- `public/js/render.ts`
- `public/js/ui.ts`
- `public/js/features/settings-core.ts`
- `public/js/features/memory.ts`
- `public/js/features/heartbeat.ts`
- `public/js/features/tool-ui.ts`
- `public/js/virtual-scroll.ts`

#### 5. Diagram and Widget Rendering Became a Visible Feature Family

Inline diagrams and sandboxed visual widgets are now part of the chat experience, rather than an incidental renderer detail.

- Added iframe renderer pipeline for diagram-html style content.
- Added widget validator and supporting runtime types.
- Added dedicated diagram CSS and multiple rounds of rendering fixes.
- Strengthened guardrails around embedded visual content.

Key areas:

- `public/js/diagram/iframe-renderer.ts`
- `public/js/diagram/widget-validator.ts`
- `public/js/diagram/types.ts`
- `public/css/diagram.css`

### Product Surface Improvements

#### CLI and TUI

- Added `/compact` flow and supporting runtime behavior.
- Improved overlays, transcript rendering, and selector behavior.
- Added session persistence and resume classification.
- Strengthened command handling and readiness checks.

Representative files:

- `src/cli/compact.ts`
- `src/core/compact.ts`
- `src/cli/tui/overlay.ts`
- `src/cli/tui/transcript.ts`
- `src/agent/session-persistence.ts`
- `src/agent/resume-classifier.ts`

#### Browser and Automation

- Added launch policy behavior and clearer browser-start modes.
- Strengthened `jaw browser` ergonomics and troubleshooting.
- Improved integration between browser control and overall diagnostics.

Representative files:

- `src/browser/launch-policy.ts`
- `bin/commands/browser.ts`
- `bin/commands/doctor.ts`

#### Skills and Prompt System

- Refined prompt template behavior and readability guidance.
- Improved skill fallback behavior and repo-bundled skill resolution.
- Added safer reset/fallback workflows for installed skills.
- Continued modularization around prompt and skill injection.

Representative files:

- `src/prompt/templates/`
- `src/prompt/builder.ts`
- `bin/commands/skill.ts`

#### Office and Document Workflows

- Strengthened OfficeCLI integration and install path.
- Added or refreshed build-local binaries.
- Added integration guide and smoke tests for DOCX/XLSX/PPTX workflows.
- Improved the repo’s story around document automation and export.

Representative files:

- `scripts/install-officecli.sh`
- `tests/smoke/test_officecli_integration.sh`
- `docs/officecli-integration.md`
- `build-local/officecli`

### Infrastructure and Delivery

#### Build and Packaging

- Switched frontend delivery from the older `esbuild` path to `vite.config.ts`.
- Added or expanded service worker and manifest support.
- Modernized release automation for preview releases.
- Improved packaging checks via `npm pack --dry-run` in release flow.

Representative files:

- `vite.config.ts`
- `public/manifest.json`
- `public/sw.js`
- `scripts/release-preview.sh`

#### CI and Reliability

- Hardened checkout logic around private/public submodules.
- Fixed invalid workflow expression issues around secret handling.
- Made skill lookup and repo-bundled fallback behavior more CI-friendly.
- Improved spawn, replay, and orchestration race handling over multiple commits.

Representative files:

- `.github/workflows/test.yml`
- `src/orchestrator/pipeline.ts`
- `src/orchestrator/worker-registry.ts`
- `src/agent/spawn.ts`

### Notable User-Visible Behaviors

Users upgrading from the `v1.2.x` era should expect a different experience in several areas.

- The assistant is more orchestration-aware and phase-driven.
- Memory is more persistent, searchable, and configurable.
- The web UI has more operational surfaces and more chat rendering capability.
- Discord is part of the supported interface story.
- Voice input and STT are more integrated.
- Preview releases and release tooling are more formalized.

### Documentation Notes

This release also fixes a documentation lag problem.

- The README had remained anchored around older `What's New` content.
- Release notes were spread across GitHub releases and implicit commit history rather than a checked-in long-form log.
- `v1.6.0` introduces this longer changelog entry to make the product story readable without reconstructing it from dozens of commits.

### Suggested Upgrade Framing

If you are presenting `v1.6.0` publicly, the most honest framing is:

- not “small polish”
- not “just another patch”
- but “the release that documents and consolidates the major platform expansion that happened after `v1.2.0`”

That positioning better matches the actual delta in orchestration, memory, channels, UI, and release infrastructure.
