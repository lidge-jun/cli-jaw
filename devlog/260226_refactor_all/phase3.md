# Phase 3: Repository Hygiene — skills_ref 분리 + 레포 정리

**Date**: 2026-02-26  
**Status**: 📋 구현 예정  
**선행 조건**: Phase 2 (safe_install) 완료 후 postinstall.ts 변경 합치  
**변경 파일**: 4개 수정, 1개 이동, git 조작 2건  
**예상 라인**: +15, -5 (코드), git 조작 별도

---

## 현재 상태

| 항목 | 문제 | 현재 코드 위치 |
|------|------|----------------|
| `skills_ref/` npm 번들 | 13MB가 npm 패키지에 포함 | `package.json:40` `"skills_ref/"` in files |
| `.gitignore` 누락 | `devlog/`, `skills_ref/` 미등록 | `.gitignore` (11줄) |
| `tests/phase-100/` | 테스트 1개만 있는 진부화된 폴더 | `tests/phase-100/employee-session-reuse.test.ts` |

---

## Phase 3A: skills_ref npm 번들에서 제거

### [MODIFY] `package.json` L36-41

```diff
 "files": [
     "dist/",
     "public/",
     "package.json",
-    "skills_ref/"
 ],
```

**효과**: npm publish 시 skills_ref/ 미포함 → 패키지 크기 13MB 감소.

### [MODIFY] `bin/postinstall.ts` — skills clone 로직 추가

Phase 2에서 분리한 함수 구조 기반으로, bundled copy 대신 git clone으로 변경:

```diff
+const SKILLS_REPO = 'https://github.com/bitkyc08-arch/cli-jaw-skills.git';
+
 export function copyDefaultSkills() {
     const target = path.join(jawHome, 'skills_ref');
-    const bundled = path.join(__dirname, '..', 'skills_ref');
-    if (!fs.existsSync(bundled)) return;
-    // ... 기존 copy 로직
+    if (fs.existsSync(target)) return; // 이미 있으면 스킵
+
+    try {
+        execSync(`git clone --depth 1 ${SKILLS_REPO} "${target}"`, {
+            stdio: 'pipe', timeout: 120000,
+        });
+        console.log(`[jaw:skills] cloned to ${target}`);
+    } catch (e) {
+        console.warn(`[jaw:skills] clone failed: ${(e as Error).message}`);
+        // Offline fallback: bundled registry.json만 복사
+        const registryBundled = path.join(__dirname, '..', 'skills_ref', 'registry.json');
+        if (fs.existsSync(registryBundled)) {
+            fs.mkdirSync(target, { recursive: true });
+            fs.copyFileSync(registryBundled, path.join(target, 'registry.json'));
+            console.log('[jaw:skills] offline fallback: registry.json only');
+        }
+    }
 }
```

> [!WARNING]
> `copyDefaultSkills()`는 `server.ts` L795, L357과 `lib/mcp-sync.ts` L589-607에서도 호출됨.
> git clone은 최초 1회만 수행 (target 존재 시 스킵), 이후 호출 시 no-op.

### [MODIFY] `lib/mcp-sync.ts` L589-607

```diff
 export function copyDefaultSkills() {
-    // bundled skills_ref → ~/.cli-jaw/skills_ref 복사
-    const src = join(PKG_ROOT, 'skills_ref');
-    if (!existsSync(src)) return;
+    // Phase 3: postinstall.ts의 clone 기반으로 변경
+    // 이 함수는 postinstall.ts에서 export한 것을 re-export
+    // → bundled copy 대신 git clone 사용
 }
```

실제로는 `postinstall.ts`의 `copyDefaultSkills` → `cloneDefaultSkills`로 이름 변경하고, 
`mcp-sync.ts`에서 re-export하거나 직접 참조:

```diff
+export { copyDefaultSkills } from '../bin/postinstall.js';
```

---

## Phase 3B: .gitignore + devlog 정리

### [MODIFY] `.gitignore`

```diff
 node_modules/
 *.db
 *.db-shm
 *.db-wal
 settings.json
 .DS_Store
 .env
 .artifacts/
 public/dist/
 dist/
+
+# Devlog & reference skills (tracked separately)
+devlog/
+skills_ref/
```

### Git 추적 제거 (커맨드)

```bash
# devlog/ — git에서 추적 제거 (로컬 파일 유지)
git rm -r --cached devlog/

# skills_ref/ — npm 번들에서도 제거했으니 git에서도 제거
git rm -r --cached skills_ref/

git add .gitignore
git commit -m "chore: remove devlog/ and skills_ref/ from tracking"
```

---

## Phase 3C: tests/phase-100/ 이동

### [MOVE] `tests/phase-100/employee-session-reuse.test.ts` → `tests/unit/`

```bash
mv tests/phase-100/employee-session-reuse.test.ts tests/unit/
rmdir tests/phase-100   # 빈 폴더 삭제
```

이동 후 파일 내 import 경로 변경 필요한지 확인:

```bash
# employee-session-reuse.test.ts의 import 경로 확인
head -10 tests/phase-100/employee-session-reuse.test.ts
# 상대 경로가 ../../src/ 인지 확인 → tests/unit/도 동일 depth이므로 변경 불필요
```

---

## 엣지케이스

| # | 시나리오 | 대응 |
|---|---------|------|
| E1 | `npm install -g cli-jaw` 후 skills_ref 없음 | postinstall에서 git clone 수행 |
| E2 | offline 환경에서 clone 실패 | fallback: bundled registry.json 복사 |
| E3 | skills_ref 이미 존재 시 재설치 | `fs.existsSync(target)` → 스킵 |
| E4 | git 미설치 환경 | `execSync` catch → fallback 경로 |
| E5 | `git rm --cached` 후 다른 브랜치 checkout | devlog/ 파일이 삭제됨 → stash 필요 주의사항 문서화 |
| E6 | phase-100 테스트 이동 후 기존 test 명령어 | `tests/**/*.test.ts` glob이므로 자동 감지 |

---

## 테스트 계획

### 기존 테스트 통과 확인

```bash
# 전체 스위트 — 파일 이동 후에도 glob으로 자동 감지
npx tsx --test tests/*.test.ts tests/**/*.test.ts
```

기대: **329+ pass** (phase-100 → unit으로 이동했으므로 동일 수)

### [NEW] `tests/unit/repo-hygiene.test.ts` — 5 cases

```
RH-001: package.json files 배열에 skills_ref/ 미포함 확인
RH-002: .gitignore에 devlog/ 포함 확인
RH-003: .gitignore에 skills_ref/ 포함 확인
RH-004: tests/phase-100/ 디렉토리 미존재 확인
RH-005: tests/unit/employee-session-reuse.test.ts 존재 확인
```

실행: `npx tsx --test tests/unit/repo-hygiene.test.ts`

### Typecheck

```bash
npx tsc --noEmit    # postinstall.ts, mcp-sync.ts 변경 영향
```

### 수동 검증

1. `npm pack` → tarball 내용에 skills_ref/ 미포함 확인
2. `git status` → devlog/, skills_ref/ untracked 상태
3. `jaw init` (또는 postinstall) → skills_ref/ clone 정상 동작
4. offline에서 `jaw init` → registry.json fallback 메시지 출력

### npm 패키지 크기 검증

```bash
# 패키지 크기 비교
npm pack --dry-run 2>&1 | tail -5
# 기대: 총 크기가 ~13MB 감소
```
