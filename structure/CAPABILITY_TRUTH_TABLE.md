---
created: 2026-05-05
phase: 22
tags: [cli-jaw, truth-table, release-claims, agbrowse-mirror]
aliases: [cli-jaw capability truth table]
---

# cli-jaw Capability Truth Table

Single source of truth for browser / web-AI capability status in `cli-jaw`,
expressed against the `agbrowse` source implementation. Phase 22 introduces
this table to lock parity claims. Update in the same commit as any capability
or release-claim change.

Status legend:

- `ready` — implementation, tests, and docs all agree in cli-jaw.
- `beta` — depends on live provider UI / accounts.
- `experimental` — opt-in, narrow scope, no production claim.
- `deferred` / `planned` — explicitly not implemented in cli-jaw; agbrowse may
  cover the surface independently.

`Mirror In cli-jaw` describes how cli-jaw consumes or re-exports the
capability.

| Capability | Status | Code Location | Tests | Mirror In cli-jaw |
| --- | --- | --- | --- | --- |
| Browser runtime cleanup / `doctor` | ready | `src/browser/runtime/*`, `src/routes/browser.ts` | `tests/unit/browser-runtime-*.test.ts`, `tests/unit/browser-doctor*.test.ts` (where present) | native cli-jaw surface; not via agbrowse |
| ChatGPT web-AI resolver | beta | `src/browser/web-ai/chatgpt.ts`, `src/browser/web-ai/composer.ts`, `src/browser/web-ai/session.ts` | `tests/unit/browser-web-ai-composer.test.ts`, `tests/unit/browser-web-ai-cli-contract.test.ts` | mirrored from agbrowse `web-ai/chatgpt.mjs` symbols |
| Gemini / Grok web-AI resolvers | deferred (use agbrowse) | n/a in cli-jaw | n/a | dispatched through agbrowse runtime |
| Action-intent / semantic target resolver (incl. `send.click`) | ready | `src/browser/web-ai/action-intent.ts`, `src/browser/web-ai/target-resolver.ts` | `tests/unit/browser-web-ai-target-resolver.test.ts` | direct mirror of agbrowse `web-ai/action-intent.mjs` + `target-resolver.mjs` |
| `answerArtifact` on completed answers | ready | `src/browser/web-ai/answer-artifact.ts`, `src/browser/web-ai/session.ts`, `src/browser/web-ai/index.ts` | `tests/unit/browser-web-ai-answer-artifact.test.ts` | direct mirror of `web-ai/answer-artifact.mjs` |
| `sourceAudit` (`--require-source-audit`, ratio/scope/date flags) | ready | `src/browser/web-ai/source-audit.ts`, `src/browser/web-ai/index.ts` (CLI), `src/routes/browser.ts` (HTTP) | `tests/unit/browser-web-ai-source-audit.test.ts`, `tests/unit/browser-web-ai-cli-contract.test.ts` | direct mirror of `web-ai/source-audit.mjs`; CLI + HTTP query flags exposed |
| MCP browser tools (`browser_snapshot`, `browser_click_ref`) | n/a (not exposed by cli-jaw) | n/a | n/a | cli-jaw does not register browser MCP tools; users invoke agbrowse MCP server directly |
| MCP planned tools (`browser_type_ref`, `browser_navigate`, ...) | deferred | n/a | n/a | tracked in agbrowse `NOT_IMPLEMENTED_BROWSER_TOOLS` |
| External / remote CDP adapter | deferred (experimental) | n/a in cli-jaw | n/a | see `docs/EXTERNAL_CDP.md` (both repos) |
| Benchmark trajectory writer | planned | n/a in cli-jaw | n/a | cli-jaw consumes agbrowse trajectory bundles only; no native writer |
| Release gates (named) | ready | `scripts/release-gates.mjs`, package scripts `gate:*` | `tests/unit/release-gates.test.ts` (Phase 22) | mirror of agbrowse named gates with cli-jaw-specific checks |
| Strict TypeScript migration (P00–P20) | ready | repo-wide `tsconfig.json` | `npm run typecheck`, `tests/unit/strict-baseline.test.ts` | independent of agbrowse |

## Mirror Rules

- A `ready` claim in cli-jaw must reference the corresponding agbrowse source
  module (where applicable) and have a test file in `tests/unit/` or
  `tests/integration/`.
- New capability ⇒ update both this file and
  `agbrowse/structure/CAPABILITY_TRUTH_TABLE.md` in the same change set.
- The `gate:truth-table-fresh` release gate enforces a ≤7 day staleness or a
  matching code/tests checksum.

## Forbidden Claims

- No `ready` claim for hosted/cloud, external/remote CDP, or stealth flows.
- No leaderboard or competitor benchmark score (cli-jaw does not own the
  trajectory writer).
- No production MCP claim from cli-jaw — cli-jaw does not register browser MCP
  tools; agbrowse owns that surface.

## Cross-References

- agbrowse truth table: `agbrowse/structure/CAPABILITY_TRUTH_TABLE.md`
- External CDP deferral: [../docs/EXTERNAL_CDP.md](../docs/EXTERNAL_CDP.md)
- Phase 22 plan: [../devlog/_plan/260505_browser_runtime_phase22/22_agbrowse_parity_closeout.md](../devlog/_plan/260505_browser_runtime_phase22/22_agbrowse_parity_closeout.md)
