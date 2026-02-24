# Phase 5 (finness): Web UI 개선 — CLI 인증 가이드 + 사이드바 CLI STATUS

> 작성일: 2026-02-25
> 상태: ✅ 완료

## 배경
- CLI 상태(`cliStatusList`)가 Settings 탭 안에 숨어있어 접근성 떨어짐
- CLI가 미설치/미인증일 때 사용자가 어떤 명령어를 실행해야 하는지 안내 없음
- README의 인증 명령어가 `--help`로 검증 안 된 부정확한 값

## 변경 내역

### 1. Web UI — CLI 인증 가이드 (`renderCliStatus`)
- `AUTH_HINTS` 맵 추가 — CLI별 설치 + 인증 명령어 정의
- 빨간 점(미설치) CLI에 노란 박스로 install/auth 힌트 표시:
  ```
  ⚠️ 설치 / 인증 필요
    npm i -g @anthropic-ai/claude-code
    claude auth
  ```
- `--help`로 검증된 정확한 명령어 사용

### 2. Web UI — CLI STATUS 사이드바 이동
- Settings 탭에서 CLI STATUS 섹션 전체 제거
- 왼쪽 사이드바(`sidebar-left`)에 그대로 이동
- 포함 요소: `cliStatusList`, 🔄 Refresh 버튼, 갱신 간격 select
- 페이지 로드 시 `loadCliStatus()` 자동 호출 (bootstrap)
- 불필요한 compact 렌더러(`renderCliStatusSidebar`, `loadCliStatusSidebar`, `AUTH_CMDS`) 삭제 → -98줄

### 3. README 인증 명령어 수정 (EN/KR/CN 3개 파일)

| CLI | 이전 | 수정 |
|-----|------|------|
| Claude | `claude` (첫 실행) | `claude auth` |
| Codex | `codex --login` | `codex login` |
| Copilot | `gh auth login` | `copilot login` |
| OpenCode | API key in config | `opencode auth` |
| Gemini | 변동 없음 | `gemini` (첫 실행) |

## 수정 파일
- `public/index.html` — CLI STATUS를 sidebar-left로 이동, settings에서 제거
- `public/js/features/settings.js` — AUTH_HINTS 추가, compact 렌더러 제거
- `public/js/main.js` — import 정리, bootstrap에 loadCliStatus() 추가
- `README.md` / `README.ko.md` / `README.zh-CN.md` — 인증 명령어 수정

## 커밋 히스토리
- `f9b3eed` feat: Web UI auth hints + fix auth commands
- `c0af86b` feat: CLI status widget in left sidebar (wiring)
- `f3a7407` refactor: move full CLI STATUS to left sidebar, remove compact duplicate
