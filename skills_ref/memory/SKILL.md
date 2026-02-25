---
name: memory
description: "Persistent long-term memory across sessions. Search, save, and organize knowledge in structured markdown files."
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "requires": null,
        "install": null,
      },
  }
---

# Long-term Memory

Persistent memory system using structured markdown files in `~/.cli-jaw/memory/`.

## RULES (MANDATORY)

1. **MEMORY.md is auto-injected**: The system prompt already includes MEMORY.md (1500 chars). No need to read it manually.
2. **Before answering about past work/decisions/preferences**: Run `cli-jaw memory search <keywords>` first.
3. **After learning user preferences or making important decisions**: Save immediately.
4. **Never guess**: If memory search returns nothing, say "I don't have a record of that."
5. **Session memory is periodic**: Auto-flush summaries are injected every Nth cycle (configurable). Don't rely on them being in every response.
6. **Auto-route saves**: When the user mentions preferences, decisions, people, or project info — save to the correct file automatically without being asked:
   - Preferences/habits → `preferences.md`
   - Decisions with reasoning → `decisions.md`
   - People/teams → `people.md`
   - Project-specific info → `projects/<name>.md`
   - Core knowledge updates → `MEMORY.md`

## Commands

### Search (grep-based, fast)

```bash
cli-jaw memory search "keyword"           # Search all memory files
cli-jaw memory search "user prefers"       # Find preferences
cli-jaw memory search "2026-02"            # Find by date
```

### Read

```bash
cli-jaw memory read MEMORY.md             # Core memory (always read first)
cli-jaw memory read preferences.md        # User preferences
cli-jaw memory read decisions.md          # Past decisions
cli-jaw memory read projects/cli-jaw.md  # Project-specific
cli-jaw memory read MEMORY.md --lines 1-20  # Partial read
```

### Save

```bash
# Append to existing file
cli-jaw memory save preferences.md "- Prefers dark mode for all UIs"
cli-jaw memory save decisions.md "- 2026-02-23: Adopted CDP for browser control"
cli-jaw memory save projects/cli-jaw.md "## Phase 9 complete: auto-deps"

# Create new topic file
cli-jaw memory save people.md "## Jun\n- Project owner\n- Prefers Korean UI, English code"
```

### List & Init

```bash
cli-jaw memory list                       # Show all memory files
cli-jaw memory init                       # Create default structure
```

## File Organization

| File                 | Purpose                                         | When to update               |
| -------------------- | ----------------------------------------------- | ---------------------------- |
| `MEMORY.md`          | Core: top-level summary of everything important | Every session, keep concise  |
| `preferences.md`     | User preferences, habits, tool choices          | When user states preferences |
| `decisions.md`       | Key technical/design decisions with dates       | After important choices      |
| `people.md`          | People, teams, contacts                         | When mentioned               |
| `projects/<name>.md` | Per-project notes                               | During project work          |
| `daily/<date>.md`    | Auto-generated session logs                     | Automatic (system writes)    |

## Workflows

### New Conversation

1. MEMORY.md is already loaded (system-level injection)
2. Greet user with awareness of their context
3. If task relates to known project → `cli-jaw memory read projects/<name>.md`

### User Mentions a Preference

1. Acknowledge: "I'll remember that."
2. `cli-jaw memory save preferences.md "- <preference>"`
3. If core enough → also update MEMORY.md

### User Asks "Do you remember...?"

1. `cli-jaw memory search "<keywords>"`
2. If found → quote the memory with source file
3. If not found → "I don't have a record of that. Would you like me to save it?"

### End of Important Session

1. Summarize key outcomes
2. Save decisions: `cli-jaw memory save decisions.md "- <date>: <decision>"`
3. Update MEMORY.md if project status changed

## Architecture

```
┌─────────────────────────────────────────────┐
│ System Prompt                               │
│  ├── A-1.md (core rules)                    │
│  ├── A-2.md (custom rules)                  │
│  ├── MEMORY.md (1500자, 매 메시지)           │
│  └── Session Memory (10000자, x2 cycle)      │
└─────────────────────────────────────────────┘
       ↑ auto                ↑ periodic
~/.cli-jaw/memory/    ~/.claude/.../memory/
  (manual save)          (auto flush)
```

- **MEMORY.md** → 시스템 프롬프트에 **매 메시지** 자동 주입 (1500자)
- **Session memory** → flush 결과를 `settings.memory.injectEvery` 사이클마다 주입 (기본 2, 10000자)
- **On-demand** → `cli-jaw memory search/read` 로 추가 로딩 (제한 없음)
- Search uses grep with context (3 lines before/after matches).
- Keep MEMORY.md concise (under 1500 chars).
- Daily logs (`daily/`) are auto-generated by flush. Do not manually edit.
