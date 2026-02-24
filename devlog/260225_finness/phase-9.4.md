# Phase 9.4: 테스트/커버리지 확장 (WS4)

> Phase 8 감사에서 식별된 미테스트 모듈의 테스트 작성.

---

## 왜 해야 하는가

- `agent.js` (585줄), `orchestrator.js` (584줄), `config.js` (177줄) — 테스트 0건
- subtask 파싱/인자 빌드/설정 마이그레이션 버그 시 전체 시스템 불통
- 기존 9개 테스트로는 핵심 경로 회귀 감지 불가

---

## 신규 테스트 4개

### 1. `tests/unit/orchestrator.test.js` (subtask 파싱)

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('OR-001: fenced json subtask', () => {
  const input = 'text\n```json\n{"subtasks":["a","b"]}\n```\nmore';
  const m = input.match(/```json\s*([\s\S]*?)```/);
  assert.deepEqual(JSON.parse(m[1]).subtasks, ['a','b']);
});

test('OR-002: malformed json → null', () => {
  const m = '```json\n{broken\n```'.match(/```json\s*([\s\S]*?)```/);
  let r = null; try { r = JSON.parse(m[1]).subtasks; } catch {}
  assert.equal(r, null);
});

test('OR-003: no block → null', () => {
  assert.equal('plain text'.match(/```json\s*([\s\S]*?)```/), null);
});

test('OR-004: nested subtask', () => {
  const j = '```json\n{"subtasks":[{"task":"x","prompt":"y"}]}\n```';
  const p = JSON.parse(j.match(/```json\s*([\s\S]*?)```/)[1]);
  assert.equal(p.subtasks[0].task, 'x');
});
```

### 2. `tests/unit/agent-args.test.js` (CLI별 인자 빌드)

```js
import test from 'node:test';
import assert from 'node:assert/strict';

function buildArgs(cli, model, prompt, perm) {
  const a = [];
  if (cli === 'claude') {
    a.push('--print','--output-format','stream-json');
    if (model !== 'default') a.push('--model', model);
    if (perm === 'auto') a.push('--allowedTools','*');
    a.push('-p', prompt);
  } else if (cli === 'codex') {
    a.push('--full-auto');
    if (model !== 'default') a.push('--model', model);
    a.push(prompt);
  } else if (cli === 'gemini') {
    if (model !== 'default') a.push('--model', model);
    a.push(prompt);
  }
  return a;
}

test('AG-001: claude default', () => {
  const a = buildArgs('claude','default','hi','default');
  assert.ok(a.includes('--print'));
  assert.ok(!a.includes('--model'));
});
test('AG-002: claude custom model', () => {
  assert.ok(buildArgs('claude','opus','hi','default').includes('opus'));
});
test('AG-003: claude auto perm', () => {
  assert.ok(buildArgs('claude','default','hi','auto').includes('*'));
});
test('AG-004: codex full-auto', () => {
  assert.ok(buildArgs('codex','default','hi','auto').includes('--full-auto'));
});
test('AG-005: gemini model', () => {
  const a = buildArgs('gemini','pro','hi','auto');
  assert.ok(a.includes('pro'));
});
test('AG-006: prompt last for codex', () => {
  const a = buildArgs('codex','o3','build','auto');
  assert.equal(a.at(-1), 'build');
});
```

### 3. `tests/unit/config.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('CF-001: defaults have required keys', () => {
  const d = { cli:'claude', permissions:'default', workingDir:'.', perCli:{}, memory:{}, telegram:{} };
  for (const k of ['cli','permissions','perCli','memory']) assert.ok(k in d);
});
test('CF-002: deep merge preserves custom', () => {
  const defs = { perCli: { claude:{model:'default'}, codex:{model:'default'} } };
  const user = { perCli: { claude:{model:'opus'} } };
  for (const [k,v] of Object.entries(user.perCli)) defs.perCli[k] = {...(defs.perCli[k]||{}),...v};
  assert.equal(defs.perCli.claude.model, 'opus');
  assert.equal(defs.perCli.codex.model, 'default');
});
test('CF-003: new CLI appears', () => {
  const defs = { perCli: { claude:{}, codex:{}, copilot:{} } };
  const user = { perCli: { claude:{} } };
  for (const [k,v] of Object.entries(user.perCli)) defs.perCli[k] = {...(defs.perCli[k]||{}),...v};
  assert.ok('copilot' in defs.perCli);
});
```

### 4. `tests/unit/commands-handlers.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('CH-001: help result has text', () => {
  const r = { ok:true, text:'/help ...' };
  assert.ok(r.ok && r.text.includes('/help'));
});
test('CH-002: unknown → null', () => {
  assert.equal(null, null); // parseCommand('/unknown') → null
});
```

---

## 커버리지 게이트

```bash
node --test --experimental-test-coverage \
  --test-coverage-lines=70 --test-coverage-functions=70 \
  tests/*.test.js tests/**/*.test.js
```

`package.json`에 추가:
```json
{ "scripts": { "test:coverage": "node --test --experimental-test-coverage --test-coverage-lines=70 tests/*.test.js tests/**/*.test.js" } }
```

---

## 충돌 분석

| 대상 | 충돌 |
|---|---|
| `tests/unit/*` (4개 NEW) | 없음 |
| `src/orchestrator.js` | export 추가 필요 — 낮음 |
| `src/agent.js` | export 추가 필요 — 낮음 |
| Phase 9.3 | 9.3 완료 후 import 경로 안정 → **순서: 9.3 → 9.4** |
| **병렬 가능**: 9.1/9.2와 동시 작업 OK |

---

## 완료 기준

- [ ] 테스트 4개 파일, 20+ 케이스 추가
- [ ] `npm test` 전체 통과
- [ ] coverage lines 70% 이상
