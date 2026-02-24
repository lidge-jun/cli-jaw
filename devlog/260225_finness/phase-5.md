# Phase 5 (finness): Web UI 마크다운 렌더링 개선

> 완료: 2026-02-25T01:01

---

## 변경 전

`render.js` 21줄 regex 파서:
- 코드블록 (언어 무시), 인라인코드, 볼드, 헤딩만 지원
- 테이블, 리스트, 링크, 인용, 수학식, 다이어그램 ❌

---

## 도입 라이브러리 (CDN)

| 라이브러리 | 버전 | 용도 | 크기 (gzip) |
|-----------|------|------|------------|
| **marked** | v14 | GFM 마크다운 → HTML | ~35KB |
| **highlight.js** | v11 | 코드블록 구문 강조 | ~30KB |
| **KaTeX** | v0.16 | 수학식 렌더링 ($, $$) | ~100KB |
| **Mermaid** | v11 | 다이어그램 렌더링 | ~200KB |

> 모두 `defer`로 로드 — 페이지 렌더링 차단 없음. CDN 실패 시 기존 regex fallback 자동.

---

## 파일 변경

### [MODIFY] `public/index.html`
- CDN `<script defer>` 4개 + `<link>` CSS 2개 추가

### [NEW] `public/css/markdown.css` (120L)
- 테이블 스타일 (border, hover, stripe)
- 코드블록 (`#0d1117` 배경, 언어 라벨)
- blockquote (accent 좌측 border)
- 리스트, 링크, 수평선, 헤딩
- KaTeX display/inline
- Mermaid 컨테이너

### [REWRITE] `public/js/render.js` (130L)
모듈별 역할:
| 함수 | 역할 |
|------|------|
| `stripOrchestration()` | subtask JSON 제거 |
| `ensureMarked()` | marked.js 설정 + highlight.js/mermaid 연동 |
| `renderer.code()` | 언어별 분기 (mermaid→div, 나머지→hljs) |
| `renderMath()` | KaTeX `$$...$$` block + `$...$` inline |
| `renderMermaidBlocks()` | DOM 삽입 후 mermaid.render() 호출 |
| `renderFallback()` | CDN 실패 시 기존 regex |
| `renderMarkdown()` | 메인 export — 위 함수 조합 |

---

## 지원 요소

| 요소 | 렌더러 | 예시 |
|------|--------|------|
| **테이블** | marked GFM | `\| col \| col \|` |
| **코드블록** | highlight.js | ` ```js ... ``` ` |
| **인라인코드** | marked | `` `code` `` |
| **수학식** | KaTeX | `$E=mc^2$`, `$$\int$$` |
| **다이어그램** | Mermaid | ` ```mermaid ... ``` ` |
| **리스트** | marked | `- item`, `1. item` |
| **링크** | marked | `[text](url)` |
| **인용** | marked | `> quote` |
| **수평선** | marked | `---` |
| **이탈릭/볼드** | marked | `*i*`, `**b**` |
| **헤딩** | marked | `# H1`, `## H2` |
