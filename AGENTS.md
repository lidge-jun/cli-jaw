# cli-jaw

System-level AI agent with full computer control via CLI wrapping (claude, codex, gemini, opencode, copilot).

## Repository Structure

```
lidge-jun/cli-jaw              ← public (this repo)
├── skills_ref/  (submodule)   ← lidge-jun/cli-jaw-skills (public reference skills)
├── devlog/      (submodule)   ← lidge-jun/cli-jaw-internal (private)
└── .npmignore                 ← npm publish 시 submodules 제외
```

### Clone

```bash
# 코드만
git clone https://github.com/lidge-jun/cli-jaw.git

# 코드 + skills + devlog (private 권한 필요)
git clone --recursive https://github.com/lidge-jun/cli-jaw.git
```

### Submodule Update

서브모듈 수정 후 반드시 메인 레포에서도 ref 커밋:

```bash
cd devlog  # 또는 skills_ref
git add -A && git commit -m "update" && git push
cd ..
git add devlog && git commit -m "chore: update devlog ref" && git push
```

### devlog 접근

`devlog/` 는 private 레포입니다. 접근 필요 시 [Issue](https://github.com/lidge-jun/cli-jaw/issues)에서 collaborator 권한을 요청하세요.

### Kanban

프로젝트 보드: https://github.com/users/lidge-jun/projects/2/views/1

### Architecture Docs Sync

- `structure/` is the current architecture-doc hub; do not point new docs at `devlog/structure/`.
- Keep `README.md`, root `AGENTS.md`, root `CLAUDE.md`, and `structure/AGENTS.md` synchronized when command/API/orchestration surfaces change.
- Recent non-strict hotspots: explicit `/continue`, Gemini `--skip-trust --approval-mode yolo`, bounded tool-log sanitizer, canonical `/api/channel/send`, heartbeat `every`/`cron` schedules, browser runtime diagnostics/session lifecycle, and `npm run gate:all`.

### Line Count Format (`str_func.md`)

File tree の行数は **`(NNNL)`** 형식으로 기재. 두 가지 변형 허용:

```
├── server.js          ← 설명 (757L)           ← 단순 형식
├── chat.js            ← 설명 (3모드, ..., 843L) ← 다중 메타 형식
```

- 숫자 + `L` + `)` 또는 `,` 로 끝나야 detection 가능
- 검증: `bash structure/verify-counts.sh` (exit code = 불일치 수)
- 자동 수정: `bash structure/verify-counts.sh --fix`
- **파일 수정 후 반드시 verify-counts 실행해서 문서 동기화**

### Devlog Archive (`devlog/_fin/`)

- 완료된 phase 폴더는 `devlog/_fin/`으로 이동 (folder-per-phase, 단독 `.md` 금지)
- 계획/구현대기 문서는 `devlog/_plan/`으로 이동 (`_fin`에 두지 않음)
- `devlog/` 루트에는 진행 중인 폴더만 유지
- 후순위 작업은 `269999_` 접두사로 표시
- Reference bundles (skill packages, test fixtures)은 반드시 phase 폴더 안에 포함
- 전체 규칙: [`devlog/_fin/HYGIENE.md`](devlog/_fin/HYGIENE.md)
- 점검: `bash structure/audit-fin-status.sh`
- 자동 분리: `bash structure/audit-fin-status.sh --move-planning`

### Phase Document Frontmatter

```yaml
---
created: 2026-MM-DD
status: planning | active | blocked | done | deferred
tags: [cli-jaw, ...]
---
# (fin) Phase Title    ← 구현 완료 시 (fin) 접두사
```

- `status:` 필드 필수 — `planning`, `active`, `blocked`, `done`, `deferred` 중 택 1
- Legacy prose forms (`> Status:`, `**Status**:`) remain readable during migration,
  but new/updated phase docs must use YAML frontmatter.
- 구현 완료된 문서 제목에 `(fin)` 접두사 추가

### OfficeCLI

OfficeCLI is available for Office document operations (.docx, .xlsx, .pptx, .hwpx, and rhwp-backed .hwp). OOXML formats use the main binary. Binary HWP features are operation-gated by `officecli hwp doctor --json` and `officecli capabilities --json`; when rhwp sidecars are missing, commands must fail with explicit dependency reasons rather than silently converting to `.hwpx`.

```bash
officecli create file.docx                                          # create blank
officecli view file.docx text                                       # view content
officecli add file.docx /body --type paragraph --prop text="..."    # add content
officecli set data.xlsx /Sheet1/A1 --prop value="42"                # set cell
officecli add deck.pptx / --type slide --prop title="Title"         # add slide
officecli create file.hwpx                                          # create blank HWPX
officecli hwp doctor --json                                         # HWP/rhwp readiness
officecli create file.hwp --json                                    # create blank HWP when rhwp-field-bridge is ready
officecli validate file.docx                                        # validate
officecli get file.docx / --json                                    # JSON output
echo '[...]' | officecli batch data.xlsx --json                     # batch ops
```

- Install: `bash scripts/install-officecli.sh`
- Smoke test: `bash tests/smoke/test_officecli_integration.sh`
- Binary selection: smoke test prefers `OFFICECLI_BIN`, then global `officecli` on PATH, then `officecli/bin/release/officecli-*`, then `officecli/build-local/officecli` as compatibility fallback
- CJK/HWP-enhanced binary: global install defaults to `lidge-jun/OfficeCLI`; HWP sidecars should sit beside `officecli` as `rhwp-field-bridge` and `rhwp-officecli-bridge` or platform-suffixed equivalents
- Same-package safety: do not run multiple `officecli` processes in parallel against the same `.docx`, `.xlsx`, `.pptx`, `.hwpx`, or `.hwp` package; run inspections sequentially to avoid package lock collisions
- Full docs: [`docs/officecli-integration.md`](docs/officecli-integration.md)

#### OfficeCLI Rebase Hygiene

When rebasing the `officecli` submodule fork onto `iOfficeAI/OfficeCLI`, preserve the HWP/rhwp commits and keep generated Rust outputs out of history.

```bash
cd officecli
git fetch upstream
git status --short --branch
git branch backup/feat-hwpx-pre-rebase-$(date +%y%m%d-%H%M) feat/hwpx
git tag backup/feat-hwpx-pre-rebase-$(date +%y%m%d-%H%M) feat/hwpx
```

- Rebase onto `upstream/main`, then resolve conflicts by preserving upstream OfficeCLI core changes plus local HWP/rhwp routing, help, capability, fixture, and bridge code.
- If `src/rhwp-field-bridge/target/` or any Rust `target/` output blocks rebase/cherry-pick, move or delete that generated directory before continuing. It is build output, not source.
- If an old commit accidentally stages Rust build artifacts, stop before committing and run `git rm -r --cached src/rhwp-field-bridge/target` plus `rm -rf src/rhwp-field-bridge/target`; commit only source, fixtures, tests, and docs.
- After every rebase, verify `git ls-files 'src/rhwp-field-bridge/target/*' | wc -l` returns `0`.
- Required checks before force-pushing the rebased feature branch:
  - `dotnet build officecli.slnx`
  - `cargo build --manifest-path src/rhwp-field-bridge/Cargo.toml`
  - `dotnet test tests/OfficeCli.Tests/OfficeCli.Tests.csproj --filter FullyQualifiedName~HwpBridge --no-build`
  - `dotnet test tests/OfficeCli.Tests/OfficeCli.Tests.csproj --no-build`
- Push rebased `feat/hwpx` with `git push --force-with-lease origin feat/hwpx`, then commit the updated `officecli` submodule pointer in this repo.
