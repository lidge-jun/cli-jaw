# Phase 3: `jaw clone` Command

**Status**: Planning
**Files**: 1 new file (~120 lines), 1 modified (cli-jaw.ts routing)
**Dependency**: Phase 2 (needs dynamic JAW_HOME to point cloned instance at new dir)

---

## Command

```bash
jaw clone <target-dir>                    # Clone default ~/.cli-jaw → target
jaw clone <target-dir> --from <source>    # Clone specific source → target
jaw clone <target-dir> --with-memory      # Also copy memory/MEMORY.md
jaw clone <target-dir> --link-ref         # Symlink skills_ref instead of copy (save ~3.5MB)
```

---

## New File: `bin/commands/clone.ts`

```typescript
/**
 * cli-jaw clone — Create independent agent instance
 * Copies config + skills, creates fresh DB, regenerates AGENTS.md
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const args = process.argv.slice(3);
const targetIdx = args.findIndex(a => !a.startsWith('-'));
const target = targetIdx >= 0
    ? path.resolve(args[targetIdx].replace(/^~/, os.homedir()))
    : null;

if (!target) {
    console.error('Usage: jaw clone <target-dir> [--from <source>] [--with-memory] [--link-ref]');
    process.exit(1);
}

const fromIdx = args.indexOf('--from');
const source = fromIdx >= 0 && args[fromIdx + 1]
    ? path.resolve(args[fromIdx + 1].replace(/^~/, os.homedir()))
    : path.join(os.homedir(), '.cli-jaw');
const withMemory = args.includes('--with-memory');
const linkRef = args.includes('--link-ref');

if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    console.error(`❌ Target directory not empty: ${target}`);
    process.exit(1);
}
```

### Clone Logic

```typescript
// 1. Create target structure
fs.mkdirSync(target, { recursive: true });
for (const dir of ['prompts', 'skills', 'worklogs', 'uploads', 'memory', 'logs']) {
    fs.mkdirSync(path.join(target, dir), { recursive: true });
}

// 2. Copy config files
for (const file of ['settings.json', 'mcp.json', 'heartbeat.json']) {
    const src = path.join(source, file);
    if (fs.existsSync(src)) {
        const content = fs.readFileSync(src, 'utf8');
        if (file === 'settings.json') {
            // Update workingDir to point to new target
            const settings = JSON.parse(content);
            settings.workingDir = target;
            fs.writeFileSync(path.join(target, file), JSON.stringify(settings, null, 4));
        } else {
            fs.copyFileSync(src, path.join(target, file));
        }
    }
}

// 3. Copy prompts (A-1, A-2 — user's personality)
for (const file of fs.readdirSync(path.join(source, 'prompts'))) {
    if (file === 'B.md') continue; // B.md is regenerated
    fs.copyFileSync(
        path.join(source, 'prompts', file),
        path.join(target, 'prompts', file)
    );
}

// 4. Copy skills
copyDirRecursive(path.join(source, 'skills'), path.join(target, 'skills'));

// 5. skills_ref — copy or symlink
if (linkRef) {
    fs.symlinkSync(path.join(source, 'skills_ref'), path.join(target, 'skills_ref'));
} else {
    copyDirRecursive(path.join(source, 'skills_ref'), path.join(target, 'skills_ref'));
}

// 6. Optional memory
if (withMemory) {
    const memSrc = path.join(source, 'memory', 'MEMORY.md');
    if (fs.existsSync(memSrc)) {
        fs.copyFileSync(memSrc, path.join(target, 'memory', 'MEMORY.md'));
    }
}

// 7. jaw.db — NOT copied, create fresh via init
// The DB schema is created automatically on first access by better-sqlite3

// 8. Regenerate AGENTS.md + B.md
// ⚠️ REVIEW FIX R2: Direct import WILL NOT WORK.
//
// WHY: JAW_HOME is `export const` in config.ts — evaluated once at module load.
// PROMPTS_DIR, SETTINGS_PATH etc. all derive from JAW_HOME at import time.
// Setting process.env.CLI_JAW_HOME AFTER import has ZERO effect on these constants.
// ES module cache means re-importing the same module returns the cached version.
// (Context7/Node.js docs: "once loaded from a path, the result is cached")
//
// Dynamic import with ?query cache-busting (Node ESM feature) could work
// but is fragile and depends on internal Node behavior.
//
// CORRECT APPROACH: subprocess with env var set BEFORE any module loads.
// This starts a fresh Node process where config.ts evaluates JAW_HOME
// from CLI_JAW_HOME env var correctly.

const projectRoot = path.resolve(__dirname, '../..');
execSync(
    `node -e "` +
    `const { loadSettings } = await import('./dist/src/core/config.js'); ` +
    `loadSettings(); ` +
    `const { regenerateB } = await import('./dist/src/prompt/builder.js'); ` +
    `regenerateB();"`,
    {
        cwd: projectRoot,
        env: { ...process.env, CLI_JAW_HOME: target },
        stdio: 'pipe'
    }
);

// 9. Summary
console.log(`
✅ Cloned to ${target}

  Copied:
    ✅ prompts/ (A-1, A-2)
    ✅ skills/ (${countFiles(target, 'skills')} skills)
    ${linkRef ? '🔗' : '✅'} skills_ref/
    ✅ mcp.json
    ✅ heartbeat.json
    ✅ settings.json (workingDir → ${target})
    ${withMemory ? '✅' : '⏭️'} memory/MEMORY.md

  Fresh:
    🆕 jaw.db (empty)
    🆕 worklogs/
    🔄 AGENTS.md (regenerated)
    🔄 B.md (regenerated)

  Launch:
    jaw serve --home ${target}
    jaw serve --home ${target} --port 3458
`);
```

---

## Routing: `bin/cli-jaw.ts`

```diff
     case 'clone':
+        await import('./commands/clone.js');
+        break;
```

Help text:
```diff
+    clone      인스턴스 복제 (독립 에이전트 생성)
```

---

## Test Plan

### Unit Tests (`tests/unit/clone.test.ts`)

```typescript
test('P3-001: clone creates all required directories', () => {
    // execSync jaw clone /tmp/test-clone
    // verify all subdirs exist
});

test('P3-002: clone updates workingDir in settings.json', () => {
    // read /tmp/test-clone/settings.json
    // assert workingDir === '/tmp/test-clone'
});

test('P3-003: clone does NOT copy jaw.db', () => {
    // assert !existsSync('/tmp/test-clone/jaw.db') (before first serve)
});

test('P3-004: clone --with-memory copies MEMORY.md', () => {
    // create source MEMORY.md, clone --with-memory, verify copy
});

test('P3-005: clone --link-ref creates symlink for skills_ref', () => {
    // verify lstatSync().isSymbolicLink()
});

test('P3-006: clone to non-empty dir fails', () => {
    // mkdir + touch file, attempt clone, expect exit code 1
});
```

### Smoke Test (manual)

```bash
jaw clone /tmp/test-instance --link-ref
ls -la /tmp/test-instance/
jaw serve --home /tmp/test-instance --port 3458
curl localhost:3458/api/cli-status
# cleanup
rm -rf /tmp/test-instance
```

---

## Rollback

Delete `bin/commands/clone.ts`, remove routing line from `cli-jaw.ts`.
