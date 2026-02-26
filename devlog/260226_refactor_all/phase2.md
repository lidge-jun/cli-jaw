# Phase 2: Safe Install — postinstall 가드 + `jaw init` 리팩토링

**Date**: 2026-02-26  
**Status**: 📋 구현 예정  
**변경 파일**: 2개 수정, 0개 신규 (init.ts 이미 존재)  
**예상 라인**: +80, -15

---

## 배경

`bin/postinstall.ts` 는 `npm install -g cli-jaw` 시 자동 실행되며 사용자 동의 없이:
- L127-147: CLI 5개 글로벌 설치 (`claude-code`, `codex`, `gemini-cli`, `copilot`, `opencode-ai`)
- L170-207: MCP 서버 글로벌 설치 (`@upstash/context7-mcp`)
- L209-242: 스킬 의존성 설치 (`uv`, `playwright-core`)

`bin/commands/init.ts` (116줄)는 이미 **대화형 설정 마법사**로 존재하지만,
L96-100에서 `await import('../postinstall.js')` → **모든 side-effect가 무조건 실행**됨.

---

## 변경

### [MODIFY] `bin/postinstall.ts` — 상단 safe 가드 추가

현재 `postinstall.ts`는 실행 즉시 모든 작업을 수행한다. 상단에 환경 변수 체크를 추가해 safe 모드 시 스킵:

```diff
 // bin/postinstall.ts 최상위 (import 직후)
 
+// ── Safe mode guard ──
+// JAW_SAFE=1 npm install -g cli-jaw → side-effect 스킵
+const isSafe = process.env.npm_config_jaw_safe === '1'
+    || process.env.npm_config_jaw_safe === 'true'
+    || process.env.JAW_SAFE === '1'
+    || process.env.JAW_SAFE === 'true';
+
+if (isSafe) {
+    try { fs.mkdirSync(jawHome, { recursive: true }); } catch {}
+    console.log('[jaw:postinstall] 🔒 safe mode — home directory created only');
+    console.log('[jaw:postinstall] Run `jaw init` to configure interactively');
+    process.exit(0);
+}
+
 // 기존 코드 계속...
```

### [MODIFY] `bin/postinstall.ts` — side-effect 함수 분리

기존 코드의 3대 side-effect 블록을 named function으로 감싼다. 
`init.ts`에서 선택적 호출이 가능해진다:

```diff
 // L127 부근
-// CLI 글로벌 설치 블록
-for (const [name, pkg] of Object.entries(CLI_TOOLS)) {
-    try { execSync(`npm ls -g ${pkg} ...`); }
-    ...
-}
+export async function installCliTools(opts: { dryRun?: boolean; interactive?: boolean } = {}) {
+    for (const [name, pkg] of Object.entries(CLI_TOOLS)) {
+        if (opts.dryRun) { console.log(`  [dry-run] would install ${pkg}`); continue; }
+        if (opts.interactive) {
+            const answer = await ask(`  Install ${name} (${pkg})? [y/N] `, 'n');
+            if (answer.toLowerCase() !== 'y') { console.log(`  ⏭️  skipped ${name}`); continue; }
+        }
+        try { execSync(`npm ls -g ${pkg} ...`); }
+        // ... 기존 로직
+    }
+}

 // L170 부근 — 동일 패턴
+export async function installMcpServers(opts: { dryRun?: boolean; interactive?: boolean } = {}) { ... }

 // L209 부근 — 동일 패턴
+export async function installSkillDeps(opts: { dryRun?: boolean; interactive?: boolean } = {}) { ... }
```

기존 postinstall 메인 흐름은 이 함수들을 `await installCliTools()` 등으로 호출.

### [MODIFY] `bin/commands/init.ts` — 완전 리팩토링

현재 init.ts의 L96-100:
```typescript
try {
    await import('../postinstall.js');  // ← 모든 side-effect 무조건 실행
} catch (e) { ... }
```

이것을 **분리된 함수를 선택적으로 호출**하도록 변경:

```diff
+import { parseArgs } from 'node:util';
+import { installCliTools, installMcpServers, installSkillDeps } from '../postinstall.js';

 const { values } = parseArgs({
     args: process.argv.slice(3),
     options: {
         'non-interactive': { type: 'boolean', default: false },
+        safe: { type: 'boolean', default: false },
+        'dry-run': { type: 'boolean', default: false },
         force: { type: 'boolean', default: false },
         // ... 기존 옵션 유지
     },
 });

 // ... 기존 설정 수집 로직 유지 ...

-// Run postinstall symlinks
-try {
-    await import('../postinstall.js');
-} catch (e) {
-    console.log(`  ⚠️ Symlink setup: ${(e as Error).message}`);
-}
+// ── Safe install: 단계별 선택 ──
+const installOpts = {
+    dryRun: !!values['dry-run'],
+    interactive: values.safe || !values['non-interactive'],
+};
+
+console.log(values['dry-run'] ? '\n  🔍 Dry run mode\n' : '');
+
+// Step 1: 기본 디렉토리 + 심링크 (항상 수행, 안전)
+ensureHomeDir();
+ensureSkillsSymlinks();
+
+// Step 2-4: 위험한 글로벌 설치 (interactive 모드에서 y/n)
+await installCliTools(installOpts);
+await installMcpServers(installOpts);
+await installSkillDeps(installOpts);
```

> [!IMPORTANT]
> `init.ts`는 이미 `parseArgs`, `readline`, `settings` 로직이 있음 (116줄).
> 기존 대화형 설정 마법사는 유지하고, **postinstall 직접 import 대신 분리 함수 호출**로만 변경.

---

## 실행 시나리오

| 명령어 | 동작 |
|--------|------|
| `npm install -g cli-jaw` | postinstall → CLI/MCP/deps 모두 자동 설치 (기존 동작 유지) |
| `JAW_SAFE=1 npm install -g cli-jaw` | postinstall → `~/.cli-jaw` 디렉토리만 생성, 나머지 스킵 |
| `jaw init` | 대화형 마법사 (각 단계 y/n 프롬프트) |
| `jaw init --non-interactive` | 모든 단계 자동 수행 (기존 동작) |
| `jaw init --safe` | 대화형 + 글로벌 설치 단계마다 y/n |
| `jaw init --dry-run` | 실제 변경 없이 계획만 출력 |

---

## 엣지케이스

| # | 시나리오 | 현재 | 변경 후 |
|---|---------|------|---------|
| E1 | CI/CD에서 `npm install -g cli-jaw` | 글로벌 설치 시도 → 권한 에러 가능 | `JAW_SAFE=1` 설정으로 스킵 |
| E2 | Docker 빌드 중 postinstall | 불필요한 5개 CLI 설치 | `JAW_SAFE=1`로 안전 |
| E3 | `jaw init --dry-run` | 없음 | 파일시스템 미변경, 계획만 |
| E4 | `jaw init --safe` + CLI 이미 설치됨 | N/A | "already installed" 표시 후 skip |
| E5 | `npm_config_jaw_safe` 환경변수 | 인식 안 됨 | postinstall에서 safe 모드 진입 |
| E6 | init.ts에서 `import postinstall.js` 제거 후 | N/A | 직접 설치 안 됨 — 분리 함수만 호출 |

---

## 테스트 계획

### [NEW] `tests/unit/safe-install.test.ts` — 6 cases

```
SAF-001: postinstall.ts에 safe guard 코드 존재 확인 (소스 인스펙션)
SAF-002: JAW_SAFE env 변수 체크 패턴 확인
SAF-003: npm_config_jaw_safe env 변수 체크 패턴 확인
SAF-004: installCliTools 함수 export 확인
SAF-005: installMcpServers 함수 export 확인
SAF-006: installSkillDeps 함수 export 확인
```

실행: `npx tsx --test tests/unit/safe-install.test.ts`

### [NEW] `tests/unit/init-command.test.ts` — 4 cases

```
INIT-001: init.ts에 --safe 옵션 존재 확인
INIT-002: init.ts에 --dry-run 옵션 존재 확인
INIT-003: init.ts에서 import('../postinstall.js') 직접 호출 없음 확인
INIT-004: 분리 함수(installCliTools 등) import 확인
```

실행: `npx tsx --test tests/unit/init-command.test.ts`

### 수동 검증

1. `JAW_SAFE=1 node dist/bin/postinstall.js` → "safe mode" 메시지 + exit 0
2. `jaw init --dry-run` → `[dry-run]` 출력만, 파일시스템 미변경
3. `jaw init --safe` → 각 단계에서 y/n 프롬프트
4. `npm install -g cli-jaw` (safe 없이) → 기존과 동일하게 전체 자동 설치
