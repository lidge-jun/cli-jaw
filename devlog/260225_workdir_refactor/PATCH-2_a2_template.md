# PATCH-2: A-2 Template — Working Directory Reference

**File**: `src/prompt/builder.ts`  
**Impact**: New installs only (A-2.md is only created once via `initPromptFiles()`)

---

## `src/prompt/builder.ts` — A-2 Default Template

### Current (lines 194-211)
```typescript
const A2_DEFAULT = `# User Configuration

## Identity
- Name: Jaw
- Emoji: 🦈

## User
- Name: (your name)
- Language: English
- Timezone: UTC

## Vibe
- Friendly, warm
- Technically accurate

## Working Directory
- ~/
`;
```

### Proposed Diff
```diff
 const A2_DEFAULT = `# User Configuration
 
 ## Identity
 - Name: Jaw
 - Emoji: 🦈
 
 ## User
 - Name: (your name)
 - Language: English
 - Timezone: UTC
 
 ## Vibe
 - Friendly, warm
 - Technically accurate
 
 ## Working Directory
-- ~/
+- ~/.cli-jaw
 `;
```

### Notes
- This template is only written to `~/.cli-jaw/prompts/A-2.md` on first `initPromptFiles()` call
- Existing users already have their A-2.md — this change won't overwrite it
- The working directory in A-2 is informational for the AI prompt, not functional
  - The actual cwd is determined by `settings.workingDir` in `spawn.ts:465`
  - A-2 just tells the AI "your starting location is X" for context

### Consideration: Sync A-2 with settings.workingDir?

Currently A-2's `Working Directory` field and `settings.workingDir` can drift apart.
**Not fixing in this patch** — A-2 is user-editable and intentionally decoupled.
Could be addressed later by dynamically injecting workingDir into the prompt instead of hardcoding in A-2.

---

## Side Effect: AGENTS.md Location

`regenerateB()` at `builder.ts:547-548`:
```typescript
const wd = settings.workingDir || os.homedir();
fs.writeFileSync(join(wd, 'AGENTS.md'), fullPrompt);
```

With `workingDir` now defaulting to `~/.cli-jaw`:
- **Before**: `AGENTS.md` written to `~/AGENTS.md`
- **After**: `AGENTS.md` written to `~/.cli-jaw/AGENTS.md`

This is correct — CLI agents spawn with `cwd: settings.workingDir`, so they'll
find `AGENTS.md` in their cwd as expected. No code change needed here.
