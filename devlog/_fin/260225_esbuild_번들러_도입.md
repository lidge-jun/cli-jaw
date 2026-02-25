# (fin) esbuild 번들러 도입

> 날짜: 2026-02-25  
> 범위: `esbuild.config.mjs`, `package.json`, `public/index.html`, `.gitignore`

---

## 배경

`public/js/` 디렉토리에 19개 JS 파일(2503줄)이 ES Module 체인으로 연결되어 있었음. `<script type="module">` 로딩 방식은 파일이 많아질수록 순서 관리와 네트워크 요청이 비효율적.

### 판단 기준
| 파일 수 | 권장 |
|---|---|
| 3-5개 이하 | 번들러 불필요 |
| 10개+ | 번들러 권장 |
| **19개 (현재)** | **번들러 도입 확정** |

## 변경 내역

### 1. esbuild 설치 및 설정 (`esbuild.config.mjs`)
- `esbuild`를 devDependency로 추가
- ESM 빌드 설정: `bundle: true`, `minify: true`, `sourcemap: true`
- 엔트리: `public/js/main.js` → 출력: `public/dist/bundle.js`
- `--watch` 모드 지원 (CLI 인자 분기)

### 2. NPM 스크립트 추가 (`package.json`)
```json
"build:frontend": "node esbuild.config.mjs",
"watch:frontend": "node esbuild.config.mjs --watch"
```

### 3. HTML 엔트리 변경 (`public/index.html`)
```diff
- <script type="module" src="/js/main.js"></script>
+ <script src="/dist/bundle.js"></script>
```

### 4. Git 제외 (`.gitignore`)
- `public/dist/` 추가 — 빌드 아티팩트는 커밋하지 않음

## 설계 결정

### CDN 라이브러리 유지
- `marked`, `highlight.js`, `katex`, `mermaid`, `DOMPurify`는 CDN에서 로드 유지
- 코드 내 `typeof X !== 'undefined'` 패턴으로 글로벌 접근 → 번들에 포함하면 오히려 복잡해짐
- 이 라이브러리들은 `<script>` 태그가 번들보다 먼저 로드되므로 순서 문제 없음

### 원본 소스 보존
- `public/js/*.js` 파일들은 그대로 유지 — 개발자가 직접 수정하는 대상
- 빌드 시 esbuild가 `main.js`부터 import 트리를 따라 자동 번들링

### Sourcemap 포함
- `bundle.js.map` 생성 → 브라우저 DevTools에서 원본 파일별 디버깅 가능

## 빌드 성능

| 항목 | 값 |
|---|---|
| 빌드 시간 | **16ms** |
| 입력 | 19개 파일, 2503줄 |
| 출력 | 1개 파일, 130줄 (minified) |
| 번들 크기 | **57.6KB** |
| Sourcemap | **159.9KB** |

## 사용법

```bash
npm run build:frontend   # 프로덕션 빌드 (minified + sourcemap)
npm run watch:frontend   # 개발 워치 모드 (변경 감지 자동 리빌드, no minify)
```

## 상태
✅ 완료
