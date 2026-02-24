# Phase 6 (finness): Web UI 테마 시스템 + 사이드바 접기

> 목표: 다크/라이트/커스텀 테마 전환 + 좌우 사이드바 접기/펼치기

---

## 난이도

| 항목 | 난이도 | 근거 |
|------|--------|------|
| CSS 변수 테마 분리 | ★★☆☆☆ | 기존 `variables.css`가 이미 CSS 변수 체계, 라이트 값만 추가 |
| 하드코딩 색상 변수화 | ★★☆☆☆ | 기계적 치환 작업 (6개 파일, ~15곳) |
| 테마 토글 JS | ★★☆☆☆ | `localStorage` + `data-theme` + hljs 테마시트 교체 |
| 사이드바 접기 | ★★★☆☆ | `grid-template-columns` 동적 전환 + 애니메이션 + 상태 저장 |
| **종합** | **★★★☆☆ (중)** | **예상 작업 시간: 3~4시간** |

> 로직 변경 아닌 CSS/JS 스타일링 작업 위주. 서버 코드 0% 터치.

---

## 현재 레이아웃

```
┌──────────────┬─────────────────────────────────┬───────────────┐
│  sidebar-left │           chat-area              │ sidebar-right │
│   (220px)     │            (1fr)                 │  (260px)      │
│               │                                  │               │
│  Status       │  🦞 CLI-CLAW ● claude           │  Agents tab   │
│  Memory       │                                  │  Skills tab   │
│  Stats        │  [chat messages]                 │  Settings tab │
│  CLI STATUS   │                                  │               │
│  /clear       │  [input area]                    │               │
│  Heartbeat    │                                  │               │
└──────────────┴─────────────────────────────────┴───────────────┘

body { grid-template-columns: 220px 1fr 260px; }
```

---

## Part A: 사이드바 접기/펼치기

### 접힌 상태 레이아웃

```
┌──┬──────────────────────────────────────────┬──┐
│◀ │              chat-area                    │▶ │
│  │              (1fr)                        │  │
│🦞│  🦞 CLI-CLAW ● claude                    │🤖│
│  │                                           │📦│
│  │  [chat messages]                          │🔧│
│  │                                           │  │
│  │  [input area]                             │  │
└──┴──────────────────────────────────────────┴──┘

좌: 48px (아이콘만), 우: 48px (탭 아이콘만)
```

### Step 1: CSS 그리드 동적 전환

#### [MODIFY] `public/css/variables.css`
```css
:root {
    /* 기존 변수 유지 + 추가 */
    --sidebar-left-w: 220px;
    --sidebar-right-w: 260px;
    --sidebar-collapsed-w: 48px;
}

body {
    grid-template-columns: var(--sidebar-left-w) 1fr var(--sidebar-right-w);
    /* transition으로 부드러운 전환 */
    transition: grid-template-columns 0.25s ease;
}
```

#### [MODIFY] `public/css/layout.css`

**좌측 사이드바 접기:**
```css
body.left-collapsed {
    --sidebar-left-w: var(--sidebar-collapsed-w);
}

body.left-collapsed .sidebar-left {
    padding: 12px 6px;
    align-items: center;
}

/* 접힌 상태에서 텍스트 요소 숨김 */
body.left-collapsed .sidebar-left .section-title,
body.left-collapsed .sidebar-left .stat,
body.left-collapsed .sidebar-left #cliStatusList,
body.left-collapsed .sidebar-left #cliStatusInterval,
body.left-collapsed .sidebar-left .btn-clear:not(.collapse-btn) {
    display: none;
}

/* 접힌 상태에서 로고 → 이모지만 */
body.left-collapsed .logo {
    font-size: 16px;
    text-align: center;
}
```

**우측 사이드바 접기:**
```css
body.right-collapsed {
    --sidebar-right-w: var(--sidebar-collapsed-w);
}

body.right-collapsed .sidebar-right .tab-content,
body.right-collapsed .sidebar-right .sidebar-save-bar {
    display: none;
}

body.right-collapsed .tab-bar {
    flex-direction: column;
    border-bottom: none;
}

body.right-collapsed .tab-btn {
    padding: 10px 0;
    font-size: 14px;       /* 이모지 크기 */
    letter-spacing: 0;
}
```

### Step 2: 접기 버튼 UI

#### [MODIFY] `public/index.html`

좌측 사이드바 상단 (로고 옆):
```html
<div style="display:flex;align-items:center;justify-content:space-between">
    <div class="logo">🦞 CLI-CLAW</div>
    <button class="collapse-btn" id="collapseLeft" title="사이드바 접기">◀</button>
</div>
```

우측 사이드바 탭바 상단:
```html
<button class="collapse-btn" id="collapseRight" title="사이드바 접기">▶</button>
```

#### [NEW] collapse 버튼 CSS (`layout.css` 추가)
```css
.collapse-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
    padding: 4px 6px;
    border-radius: 4px;
    transition: color 0.2s, background 0.2s;
}

.collapse-btn:hover {
    color: var(--accent);
    background: var(--border);
}
```

### Step 3: 접기 로직

#### [NEW] `public/js/features/sidebar.js` (~30L)

| 함수 | 역할 |
|------|------|
| `initSidebar()` | `localStorage`에서 접힘 상태 복원, 이벤트 바인딩 |
| `toggleLeft()` | `body.classList.toggle('left-collapsed')` + 버튼 텍스트 ◀↔▶ + 저장 |
| `toggleRight()` | `body.classList.toggle('right-collapsed')` + 버튼 텍스트 ▶↔◀ + 저장 |

접힌 상태에서 버튼 화살표 방향 반전:
- 좌측 열림: `◀` (접기) → 좌측 접힘: `▶` (펼치기)
- 우측 열림: `▶` (접기) → 우측 접힘: `◀` (펼치기)

---

## Part B: 테마 시스템 (Light Mode + Custom Colors)

### 현재 상태

`variables.css` `:root`에 12개 CSS 변수가 다크 전용으로 하드코딩:
```css
:root {
    --bg: #0a0a0f;    --surface: #12121a;
    --border: #1e1e2e; --text: #e4e4ef;
    --text-dim: #6e6e8a; --accent: #ff6b6b;
    --accent2: #ffa07a;  --green: #4ade80;
    --user-bg: #1a1a2e;  --agent-bg: #0f0f1a;
}
```

CSS 파일 6개에 하드코딩 색상이 산재:
| 파일 | 하드코딩 값 | 용도 |
|------|------------|------|
| `layout.css` | `#1a2e1a`, `#2e2a1a` | status-idle/running 배경 |
| `sidebar.css` | `#1a0a0a` | perm-btn/skill-filter active 배경 |
| `chat.css` | `#ef4444`, `#dc2626` | stop 버튼 |
| `markdown.css` | `#0d1117`, `#60a5fa`, `#8b949e` | 코드블록/링크/라벨 |
| `modals.css` | `#555`, `#f55` | toggle off, delete |
| `index.html` | hljs `github-dark.min.css` | 코드 하이라이트 |

### Step 4: CSS 변수 확장 — 테마별 분리

#### [MODIFY] `public/css/variables.css`

기존 `:root` → 다크 기본값 유지 + 하드코딩 색상 → 변수 승격:
```css
:root {
    /* 기존 12개 + 아래 추가 */
    --status-idle-bg: #1a2e1a;
    --status-running-bg: #2e2a1a;
    --active-bg: #1a0a0a;
    --stop-btn: #ef4444;
    --stop-btn-hover: #dc2626;
    --code-bg: #0d1117;
    --link-color: #60a5fa;
    --code-label: #8b949e;
    --toggle-off: #555;
    --delete-color: #f55;
}

[data-theme="light"] {
    --bg: #f5f5f7;
    --surface: #ffffff;
    --border: #e0e0e6;
    --text: #1a1a2e;
    --text-dim: #6e6e8a;
    --accent: #e05252;
    --accent2: #d4845a;
    --green: #22c55e;
    --user-bg: #e8e8f0;
    --agent-bg: #f0f0f8;
    --status-idle-bg: #dcfce7;
    --status-running-bg: #fef9c3;
    --active-bg: #fee2e2;
    --stop-btn: #dc2626;
    --stop-btn-hover: #b91c1c;
    --code-bg: #f6f8fa;
    --link-color: #2563eb;
    --code-label: #57606a;
    --toggle-off: #d1d5db;
    --delete-color: #dc2626;
}
```

### Step 5: 하드코딩 색상 → 변수 교체

6개 CSS 파일에서 기계적 치환 (~15곳):

| 파일 | 변경 |
|------|------|
| `layout.css` | `#1a2e1a` → `var(--status-idle-bg)`, `#2e2a1a` → `var(--status-running-bg)` |
| `sidebar.css` | `#1a0a0a` → `var(--active-bg)`, `#444` → `var(--toggle-off)` |
| `chat.css` | `#ef4444` → `var(--stop-btn)`, `#dc2626` → `var(--stop-btn-hover)` |
| `markdown.css` | `#0d1117` → `var(--code-bg)`, `#60a5fa` → `var(--link-color)`, `#8b949e` → `var(--code-label)` |
| `modals.css` | `#555` → `var(--toggle-off)`, `#f55` → `var(--delete-color)` |

### Step 6: 테마 토글 UI + 로직

#### [MODIFY] `public/index.html`
- `<html data-theme="dark">` 기본값
- 좌측 사이드바: 로고 행에 테마 토글 버튼
```html
<button id="themeToggle" class="collapse-btn" title="테마 전환">🌙</button>
```

#### [NEW] `public/js/features/theme.js` (~40L)

| 함수 | 역할 |
|------|------|
| `initTheme()` | `localStorage` 또는 `prefers-color-scheme` 감지 → 적용 |
| `toggleTheme()` | `data-theme` 토글 + localStorage + hljs 테마시트 교체 + 버튼 이모지 전환 |
| `setTheme(name)` | 직접 지정 (커스텀 팔레트 확장용) |
| `swapHljsTheme(theme)` | `<link>` href를 `github-dark` ↔ `github` 교체 |

highlight.js 라이트:
```
https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github.min.css
```

버튼 이모지: 다크 `🌙` ↔ 라이트 `☀️`

---

## Part C: 디자인 방향 (dev-frontend 참고)

> Phase 5에서 마크다운 렌더링 도입으로 콘텐츠 레이어는 개선됨.
> Phase 6에서는 **프레임(뼈대)** 레이어를 개선해서 "앱"다운 느낌을 강화.

| 원칙 | 적용 |
|------|------|
| **Spatial Composition** | 사이드바 접기로 채팅 영역 극대화 — 집중 모드 |
| **Motion** | `transition: grid-template-columns 0.25s ease` — 사이드바 슬라이드 |
| **Typography** | (유지) SF Mono / JetBrains Mono |
| **Color & Theme** | CSS 변수 체계 강화 → 라이트/다크 각각 응집력 있는 팔레트 |
| **Background** | 라이트 모드: 미세한 warm gray, 코드블록 `#f6f8fa` (GitHub 스타일) |

---

## 수정 대상 파일 요약

| 파일 | 변경 유형 | 비고 |
|------|----------|------|
| `public/css/variables.css` | MODIFY | 테마 변수 분리 + 사이드바 폭 변수 |
| `public/css/layout.css` | MODIFY | collapse 관련 클래스 + 하드코딩 치환 |
| `public/css/sidebar.css` | MODIFY | 접힌 상태 스타일 + 하드코딩 치환 |
| `public/css/chat.css` | MODIFY | 하드코딩 치환 |
| `public/css/markdown.css` | MODIFY | 하드코딩 치환 |
| `public/css/modals.css` | MODIFY | 하드코딩 치환 |
| `public/index.html` | MODIFY | `data-theme` + 접기 버튼 + 테마 버튼 |
| `public/js/features/theme.js` | **NEW** | 테마 전환 모듈 (~40L) |
| `public/js/features/sidebar.js` | **NEW** | 사이드바 접기 모듈 (~30L) |
| `public/js/main.js` | MODIFY | `initTheme()` + `initSidebar()` import |

---

## 완료 기준

| 항목 | 조건 |
|------|------|
| 테마 토글 | 🌙↔☀️ 클릭 → 즉시 다크↔라이트 전환, 깜빡임 없음 |
| 좌측 접기 | ◀ 클릭 → 48px 아이콘 모드로 슬라이드, 채팅 영역 확장 |
| 우측 접기 | ▶ 클릭 → 48px 탭 아이콘만, 채팅 영역 확장 |
| 새로고침 유지 | 테마 + 사이드바 상태 `localStorage` 복원 |
| 하드코딩 0건 | CSS에 `#hex` 직접 참조 없음 (변수 100% 치환) |
| hljs 연동 | 코드블록 하이라이트도 테마 동기 전환 |
| 전환 애니메이션 | 사이드바 슬라이드 0.25s ease |
