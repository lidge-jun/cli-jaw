# Phase 5.1 (finness): 테이블 + KaTeX 렌더링 폴리시

> 문제: 테이블 border 안 보임 (dark theme에서 `#3b3f47` 구분 불가)

---

## 테이블 개선

### 현재 문제
1. border 색이 배경과 거의 동일 → 줄 안 보임
2. 셀 내용이 길면 테이블이 화면 밖으로 벗어남
3. 긴 텍스트 줄바꿈 안 됨

### 수정 계획

```css
/* 형광 accent line */
.msg-body table {
    border: 1px solid #4ade80;          /* 밝은 초록 */
    max-width: 100%;
    display: block;
    overflow-x: auto;                   /* 가로 스크롤 */
}
.msg-body th, .msg-body td {
    border: 1px solid rgba(74,222,128,0.3);  /* 반투명 초록 */
    word-break: break-word;             /* 긴 단어 줄바꿈 */
    max-width: 300px;                   /* 셀 최대 너비 */
}
.msg-body th {
    border-bottom: 2px solid #4ade80;   /* 헤더 하단 강조 */
}
```

### 동적 조절
- `max-width: 100%` + `overflow-x: auto` → 넓은 테이블은 가로 스크롤
- `word-break: break-word` → 긴 단어/URL 자동 줄바꿈
- `max-width: 300px` per cell → 한 셀이 너무 넓어지지 않게

---

## KaTeX 줄바꿈

### 현재 문제
- 긴 수식이 `overflow: hidden`으로 잘림
- display math가 컨테이너 폭 초과 시 내용 안 보임

### 수정 계획

```css
.msg-body .katex-display {
    overflow-x: auto;                   /* 긴 수식 가로 스크롤 */
    overflow-y: hidden;
    padding: 4px 0;
}
.msg-body .katex {
    font-size: 1.05em;                  /* 약간만 크게 */
}
.msg-body .katex-display > .katex {
    white-space: normal;                /* 긴 식 줄바꿈 허용 */
}
```

---

## 파일 변경

| 파일 | 변경 |
|------|------|
| `css/markdown.css` | 테이블 border 색 + 동적 크기 + KaTeX overflow |
