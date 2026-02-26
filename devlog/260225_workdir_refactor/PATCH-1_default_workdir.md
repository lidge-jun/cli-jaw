# PATCH-1: Default workingDir — `~/` → `~/.cli-jaw`

**Files**: `src/core/config.ts`, `bin/commands/init.ts`  
**Impact**: Fresh installs only (existing users unaffected)

---

## 1. `src/core/config.ts` — Default setting

### Current (line 101)
```typescript
function createDefaultSettings() {
    return {
        cli: DEFAULT_CLI,
        fallbackOrder: [],
        permissions: 'auto',
        workingDir: os.homedir(),
        // ...
    };
}
```

### Proposed Diff
```diff
 function createDefaultSettings() {
     return {
         cli: DEFAULT_CLI,
         fallbackOrder: [],
         permissions: 'auto',
-        workingDir: os.homedir(),
+        workingDir: join(os.homedir(), '.cli-jaw'),
         // ...
     };
 }
```

### Notes
- `join(os.homedir(), '.cli-jaw')` = `JAW_HOME` constant (already defined at line 27)
- Could use `JAW_HOME` directly, but `join()` is clearer about intent
- Only affects new installs — existing `settings.json` already has `workingDir` saved

---

## 2. `bin/commands/init.ts` — Init wizard default suggestion

### Current (line 45-46)
```typescript
settings.workingDir = await ask('Working directory', settings.workingDir || os.homedir());
```

### Proposed Diff
```diff
-settings.workingDir = await ask('Working directory', settings.workingDir || os.homedir());
+settings.workingDir = await ask('Working directory', settings.workingDir || path.join(os.homedir(), '.cli-jaw'));
```

### Notes
- Changes the suggested default shown during `cli-jaw init`
- User can still type any path they want
- If `settings.workingDir` already exists (re-init), keeps their choice
