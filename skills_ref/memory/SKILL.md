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

Persistent memory system using structured markdown files in `~/.cli-claw/memory/`.

## RULES (MANDATORY)

1. **Start of conversation**: Always run `cli-claw memory read MEMORY.md` to load core knowledge.
2. **Before answering about past work/decisions/preferences**: Run `cli-claw memory search <keywords>` first.
3. **After learning user preferences or making important decisions**: Save immediately.
4. **Never guess**: If memory search returns nothing, say "I don't have a record of that."

## Commands

### Search (grep-based, fast)

```bash
cli-claw memory search "keyword"           # Search all memory files
cli-claw memory search "user prefers"       # Find preferences
cli-claw memory search "2026-02"            # Find by date
```

### Read

```bash
cli-claw memory read MEMORY.md             # Core memory (always read first)
cli-claw memory read preferences.md        # User preferences
cli-claw memory read decisions.md          # Past decisions
cli-claw memory read projects/cli-claw.md  # Project-specific
cli-claw memory read MEMORY.md --lines 1-20  # Partial read
```

### Save

```bash
# Append to existing file
cli-claw memory save preferences.md "- Prefers dark mode for all UIs"
cli-claw memory save decisions.md "- 2026-02-23: Adopted CDP for browser control"
cli-claw memory save projects/cli-claw.md "## Phase 9 complete: auto-deps"

# Create new topic file
cli-claw memory save people.md "## Jun\n- Project owner\n- Prefers Korean UI, English code"
```

### List & Init

```bash
cli-claw memory list                       # Show all memory files
cli-claw memory init                       # Create default structure
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

1. `cli-claw memory read MEMORY.md`
2. Greet user with awareness of their context
3. If task relates to known project → read that project file

### User Mentions a Preference

1. Acknowledge: "I'll remember that."
2. `cli-claw memory save preferences.md "- <preference>"`
3. If core enough → also update MEMORY.md

### User Asks "Do you remember...?"

1. `cli-claw memory search "<keywords>"`
2. If found → quote the memory with source file
3. If not found → "I don't have a record of that. Would you like me to save it?"

### End of Important Session

1. Summarize key outcomes
2. Save decisions: `cli-claw memory save decisions.md "- <date>: <decision>"`
3. Update MEMORY.md if project status changed

## Notes

- Memory files are plain markdown. You can view/edit them directly.
- Search uses grep with context (3 lines before/after matches).
- MEMORY.md content is automatically injected into the system prompt.
- Daily logs are auto-generated. Do not manually edit them.
- Keep MEMORY.md concise (under 1000 chars) for efficient prompt injection.
