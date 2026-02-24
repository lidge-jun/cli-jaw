# Frontend — public/ (19 files, ~3000L)

> Web UI — Vanilla HTML + CSS + ES Modules. 인라인 JS/CSS 없음. CLI/모델은 API에서 동적 로딩.

---

## 파일 구조

```text
public/
├── index.html            ← HTML 뼈대 (440L, inline JS/CSS 없음, Copilot <option> 포함)
├── css/
│   ├── variables.css     ← CSS 커스텀 프로퍼티, 리셋 (47L)
│   ├── layout.css        ← 사이드바, 탭, 세이브바 (162L)
│   ├── chat.css          ← 채팅, 메시지, 타이핑, 첨부, 드롭다운, 멈춤 버튼 (369L)
│   ├── sidebar.css       ← 설정, 스킬 카드, 토글 (215L)
│   └── modals.css        ← 모달, 하트비트 카드 (171L)
└── js/
    ├── main.js           ← 앱 진입점 + 이벤트 바인딩 (222L)
    ├── state.js          ← 공유 상태 모듈 (16L)
    ├── constants.js      ← fetchCliRegistry() 동적 로딩 (MODEL_MAP 제거) (30L)
    ├── render.js         ← renderMarkdown, escapeHtml (20L)
    ├── ui.js             ← DOM 조작 유틸 + stop-mode 토글 (142L)
    ├── ws.js             ← WebSocket 연결 + 메시지 라우팅 (43L)
    └── features/
        ├── chat.js       ← 전송, 첨부, 드래그앤드롭, 멈춤, 큐 (154L)
        ├── settings.js   ← 설정, CLI 상태, MCP, 프롬프트, 폴백, perCli (copilot 포함) (400L)
        ├── skills.js     ← 로드, 토글, 필터, 기타 카테고리 (69L)
        ├── employees.js  ← 서브에이전트 CRUD (CLI 드롭다운 동적 생성) (100L)
        ├── heartbeat.js  ← 하트비트 모달/작업 (83L)
        ├── memory.js     ← 메모리 모달/설정 (90L)
        └── slash-commands.js ← 슬래시 커맨드 드롭다운 (220L)
```

---

## CLI/모델 동적 로딩 (cli-registry 통합)

하드코딩 `MODEL_MAP` 제거 → `/api/cli-registry` API에서 동적 로딩 + 서버 미기동 시 fallback:

```js
// public/js/constants.js (114L)
export const FALLBACK_CLI_REGISTRY = { /* cli-registry.js와 동일 */ };
export let MODEL_MAP = toModelMap(FALLBACK_CLI_REGISTRY);

export async function loadCliRegistry() {
    const data = await (await fetch('/api/cli-registry')).json();
    applyRegistry(data);
}
// settings.js, employees.js, main.js에서 동적 호출
```

### index.html 변경

- CLI 선택 `<select>`: 5개 `<option>` (claude, codex, gemini, opencode, **copilot**)
- CLI별 모델 `<select>`: copilot 모델 블록 추가 (gpt-4.1, gpt-5-mini, claude-sonnet-4.6 등)

---

## 모듈 구성

### Core Layer

| 모듈           | 역할                       | 라인 |
| -------------- | -------------------------- | ---- |
| `main.js`      | 앱 진입점, 이벤트 바인딩   | 222  |
| `state.js`     | 공유 상태                  | 16   |
| `constants.js` | `loadCliRegistry()` + FALLBACK | 114  |

### Utility Layer

| 모듈        | 역할                        | 라인 |
| ----------- | --------------------------- | ---- |
| `render.js` | Markdown 렌더 + HTML escape | 20   |
| `ui.js`     | DOM 유틸 + stop-mode        | 142  |
| `ws.js`     | WebSocket + 메시지 라우팅   | 43   |

### Features Layer

| 모듈                | 역할                          | 라인 |
| ------------------- | ----------------------------- | ---- |
| `chat.js`           | 전송, 첨부, 드래그앤드롭      | 154  |
| `settings.js`       | 설정 패널 + perCli (5개 CLI)  | 400  |
| `skills.js`         | 스킬 카드 UI                  | 69   |
| `employees.js`      | 서브에이전트 CRUD (동적 CLI)  | 100  |
| `heartbeat.js`      | 하트비트 모달                 | 83   |
| `memory.js`         | 메모리 모달                   | 90   |
| `slash-commands.js` | 슬래시 커맨드 드롭다운        | 220  |

---

## CSS 시스템

| 파일            | 역할                        | 라인 |
| --------------- | --------------------------- | ---- |
| `variables.css` | 커스텀 프로퍼티, 리셋, 테마 | 47   |
| `layout.css`    | 사이드바, 탭, 세이브바      | 162  |
| `chat.css`      | 채팅 영역 전체 스타일       | 369  |
| `sidebar.css`   | 설정, 스킬 카드, 토글       | 215  |
| `modals.css`    | 모달, 하트비트 카드         | 171  |

**총 CSS**: 964L · **총 JS**: ~1600L · **HTML**: 440L

---

## 의존 그래프

```mermaid
graph TD
    HTML[index.html] --> main.js
    main.js --> state.js
    main.js --> ws.js
    main.js --> ui.js
    main.js --> render.js
    main.js --> constants.js
    main.js --> F_CHAT[features/chat.js]
    main.js --> F_SET[features/settings.js]
    main.js --> F_SK[features/skills.js]
    main.js --> F_EMP[features/employees.js]
    main.js --> F_HB[features/heartbeat.js]
    main.js --> F_MEM[features/memory.js]
    main.js --> F_SC[features/slash-commands.js]
    F_CHAT --> state.js
    F_CHAT --> ui.js
    F_SET --> state.js
    F_SET --> constants.js
    F_EMP --> constants.js
    F_SC --> ui.js
    constants.js -->|"/api/cli-registry"| SERVER["server.js"]
```

> ES Module `<script type="module">` 사용. 모든 import는 상대 경로. CLI/모델 데이터는 서버 API에서 동적 로딩.
