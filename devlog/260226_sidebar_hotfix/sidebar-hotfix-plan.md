# Hotfix: Sidebar UI — 작업 디렉토리 & Auto 버튼

> 날짜: 2026-02-26
> 파일: `public/index.html`, `public/css/sidebar.css`, `public/js/features/settings.js`, `public/js/main.js`

---

## 문제

### 1. 작업 디렉토리 (`inpCwd`) — 편집 가능 상태

현재 `<input type="text" id="inpCwd">` 로 랜더링되어 사용자가 값을 수정할 수 있다.
`change` 이벤트가 `updateSettings()`를 호출하여 서버에 수정된 값을 전송하는 구조.

**기대 동작**: 서버에서 제공하는 `workingDir` (= `JAW_HOME = ~/.cli-jaw`)을 **읽기 전용으로 표시**만 해야 한다.
동적으로 서버에서 받아온 값을 보여주되, 사용자가 편집할 수 없어야 함.

### 2. Auto 버튼 — 너비 부족 + 정렬

현재 인라인 스타일 `flex:none;padding:6px 14px` 로 고정 크기.
사이드바 전체 너비를 채우고 중앙 정렬되어야 한다.

---

## 수정 계획

### A. 작업 디렉토리 → 읽기 전용 표시

| 파일 | 변경 |
|------|------|
| `index.html:178-181` | `<input>` → `<span>` (읽기 전용 표시 엘리먼트) |
| `sidebar.css` | `.cwd-display` 스타일 추가 (monospace, dim, truncate) |
| `settings.js:133` | `.value =` → `.textContent =` |
| `settings.js:207` | `workingDir` 라인 제거 (서버에 전송 안 함) |
| `main.js:109` | `inpCwd` change 이벤트 리스너 제거 |

**HTML 변경:**
```html
<!-- Before -->
<input type="text" id="inpCwd" value="" placeholder="~/.cli-jaw">

<!-- After -->
<span id="inpCwd" class="cwd-display">~/.cli-jaw</span>
```

### B. Auto 버튼 — 너비 확장 + 중앙 정렬

| 파일 | 변경 |
|------|------|
| `index.html:174` | 인라인 `flex:none` 제거, `width:100%` 적용 |

**HTML 변경:**
```html
<!-- Before -->
<span class="perm-btn active" style="cursor:default;flex:none;padding:6px 14px">⚡ Auto</span>

<!-- After -->
<span class="perm-btn active" style="cursor:default;width:100%;padding:6px 14px">⚡ Auto</span>
```

`.perm-btn` 클래스에 이미 `text-align:center`가 있으므로 너비만 확장하면 자동 중앙 정렬.

---

## 영향 범위

- `updateSettings()`에서 `workingDir` 제거 → 서버 측 settings PUT에 `workingDir` 필드 누락, 하지만 서버는 `JAW_HOME`을 항상 config에서 직접 읽으므로 영향 없음
- 기존 테스트: `settings-merge.test.ts`에서 `workingDir` 관련 테스트 없음 → 영향 없음
- 프론트엔드 순수 UI 변경이므로 기존 자동 테스트 범위 밖

## 검증

```
npm test                 # 기존 테스트 패스 확인
```

브라우저 수동 확인:
1. 작업 디렉토리 필드가 서버 값을 표시하되 편집 불가해야 함
2. Auto 버튼이 사이드바 전체 너비를 채우고 중앙 정렬되어야 함
