# 📂 Working Directory Refactor — Default `~` → Project-Scoped

**Date**: 2025-02-25  
**Status**: 📋 Planning (NO CODE — diff plan only)  
**Priority**: Medium (UX improvement, not a bug)

---

## Problem

Currently `workingDir` defaults to `~/` (user home).  
This means:

1. `AGENTS.md` is written to `~/AGENTS.md` — pollutes home directory
2. All CLI agents spawn with `cwd: ~/` — they see the entire home
3. The custom instruction (A-2) says `Working Directory: ~/`
4. Since agents have full permissions anyway, `~/` access is always possible regardless of cwd

**The home directory doesn't need to be the default working directory.**  
A dedicated project directory like `~/.cli-jaw` (already exists) is cleaner.

## Proposed Change

Change default `workingDir` from `~/` to `~/.cli-jaw` (or a new `~/.cli-jaw/workspace/`).

### Why `~/.cli-jaw` instead of `~/cli-jaw`

- `~/.cli-jaw` already exists as the system home — no new directories
- All config, prompts, DB, skills, memory already live here
- `AGENTS.md` would go to `~/.cli-jaw/AGENTS.md` instead of polluting `~/`
- Hidden directory = won't clutter user's Finder/explorer
- Agents still have full `~/` access for any file operations — cwd is just the starting point

### Alternative: `~/.cli-jaw/workspace/`

A subfolder keeps AGENTS.md separate from config files. But adds unnecessary nesting.
**Recommendation: stick with `~/.cli-jaw` directly.**

---

## Affected Files & Diffs

### PATCH-1: Default workingDir (2 files)

### PATCH-2: A-2 Template (1 file)

### PATCH-3: AGENTS.md location note (0 code changes — docs only)

See individual patch files for diffs.

---

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Existing users with `workingDir: ~/` in settings.json | None | Settings already saved — default only affects fresh installs |
| AGENTS.md moves from `~/` to `~/.cli-jaw/` | Low | CLIs read AGENTS.md from their cwd, which follows workingDir |
| Agent can't access `~/` files | None | Full permissions = agents can `cd ~/` or use absolute paths freely |
| Init wizard shows different default | Low | Just a default suggestion — user can override |

## Migration

- **No migration needed** — existing users have workingDir saved in settings.json
- Fresh installs get the new default
- `cli-jaw init` already prompts for workingDir — just changes the suggested default
