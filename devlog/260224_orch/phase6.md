# Phase 6: Message Triage — 복잡한 작업만 오케스트레이션

> **의존**: Phase 5 완료
> **목표**: 복잡한 코딩/개발 작업만 planning pipeline 실행, 나머지는 직접 응답

---

## 문제

orchestrate()가 **모든 메시지**를 풀 파이프라인으로 처리:
- "안녕" → planning + worklog + subtask + verdict
- "그래서 대답이 뭐냐고" → planning + worklog + subtask + verdict
- "서버 상태 어때?" → planning + worklog + subtask + verdict

## 설계 (역전 로직)

~~기존: 간단한 거 걸러내기~~ → **복잡한 작업만 파이프라인 태우기**

```
orchestrate(prompt)
  ├── needsOrchestration(prompt) === true  → full pipeline
  └── else                                  → spawnAgent(prompt) 직접
```

### `needsOrchestration()` — 복잡 작업 탐지

**조건: 아래 중 2개 이상** 충족 시 orchestrate:

1. **길이**: 80자 이상
2. **코드 키워드**: 파일 경로(.js/.ts/.py...), "구현", "작성", "만들어", "수정", "리팩토링", "코딩", "버그", "디버그", "테스트", "빌드", "배포", "API", "함수", "클래스", "컴포넌트"
3. **멀티 작업 신호**: "그리고", "다음에", "먼저...그리고", 줄바꿈 2개+, 번호 목록 (1. 2. 3.)
4. **파일 경로 패턴**: `/path/to/file`, `src/`, `bin/`, `public/`

**1개만 충족**: 코드 키워드 1개 있어도 "API 어때?" 같은 짧은 질문은 direct.
**2개 이상**: "src/agent.js의 함수를 리팩토링하고 테스트 작성해줘" → orchestrate.

| 입력                                                             | 키워드 | 길이 | 멀티 | 판정           |
| ---------------------------------------------------------------- | ------ | ---- | ---- | -------------- |
| "안녕"                                                           | 0      | ✗    | ✗    | direct         |
| "그래서 대답이 뭐냐고"                                           | 0      | ✗    | ✗    | direct         |
| "서버 상태 어때?"                                                | 0      | ✗    | ✗    | direct         |
| "API가 뭐야?"                                                    | 1      | ✗    | ✗    | direct (1개만) |
| "코드 리뷰해줘"                                                  | 1      | ✗    | ✗    | direct (1개만) |
| "src/agent.js 수정해줘"                                          | 2      | ✗    | ✗    | orchestrate ✅  |
| "API 만들고 테스트 작성해"                                       | 2      | ✗    | 1    | orchestrate ✅  |
| "메모리 시스템 리팩토링하고 벡터 DB 추가해줘 그리고 테스트도..." | 3      | ✅    | ✅    | orchestrate ✅  |

---

## 변경 파일

| 파일                  | 작업                                          |
| --------------------- | --------------------------------------------- |
| `src/orchestrator.js` | [MODIFY] `needsOrchestration()` + triage 분기 |

---

## 검증

```bash
# Unit test
node -e "
import { needsOrchestration } from './src/orchestrator.js';
const cases = [
  ['안녕', false],
  ['그래서 대답이 뭐냐고', false],
  ['API가 뭐야?', false],
  ['서버 상태 어때?', false],
  ['ㅇㅇ', false],
  ['고마워', false],
  ['코드 리뷰해줘', false],
  ['src/agent.js 수정해줘', true],
  ['API 엔드포인트 만들어줘', true],
  ['메모리 시스템 리팩토링하고 벡터 DB 추가해줘', true],
];
"
```
