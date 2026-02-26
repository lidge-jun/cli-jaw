# Skill Refactor — Concrete Integration Plan v2

> 기반: 18개 후보 SKILL.md (`candidates/` 디렉토리)
> 대상: `dev`, `dev-backend`, `dev-data` (3개 커스텀 스킬)
> `dev-frontend`, `dev-testing`은 이미 Anthropic 공식과 동일 → 건드리지 않음

---

## 포터블 원칙 (모든 스킬 공통)

이하 규칙을 위반하는 내용은 전부 삭제/교체:

| 금지 | 이유 |
|---|---|
| `~/.cli-jaw/skills_ref/` 등 프로젝트 경로 | 이 스킬은 어떤 프로젝트에서든 주입됨 |
| `server.js`, `config.js`, `db.js` 등 특정 파일 참조 | 프로젝트마다 다름 |
| `better-sqlite3`, `Express.js` 등 특정 라이브러리 한정 | 프레임워크 무관해야 함 |
| "이 프로젝트에서는..." 맥락 | 범용 가이드에 적합하지 않음 |
| "다른 스킬 참고하세요" 류 안내 | 스킬은 자체 완결형 |
| 한국어 | 영어가 표준 |

---

## 1. `dev` — Common Development Guidelines

### 현재 문제 (66줄, 한국어)

- §2 Self-Reference: cli-jaw 전용 파일 경로 나열 → **삭제**
- §3 스킬 탐색: `~/.cli-jaw/skills_ref/react-best-practices/` 등 → **삭제**
- §1 모듈화, §4 변경로그, §5 안전규칙: 내용은 좋으나 한국어+미흡 → **영어 확장**

### 새 구조 (목표 ~200줄)

각 섹션의 **실제 내용 초안**:

---

#### §1. Modular Development (from 현재 §1, + code-reviewer thresholds)

```markdown
## 1. Modular Development

Every file, function, and class should have a single, clear responsibility.

**Hard limits:**
| Metric | Threshold | Action |
|--------|-----------|--------|
| File length | >500 lines | Split into focused modules |
| Function length | >50 lines | Extract helper functions |
| Class methods | >20 methods | Split by responsibility |
| Nesting depth | >4 levels | Flatten with early returns or extraction |
| Function parameters | >5 | Use an options/config object |

**Rules:**
- ES Module (`import`/`export`) only. No CommonJS.
- One default export per file when the file has a primary purpose.
- Follow existing naming conventions in the project.
- New files must match the directory structure and naming patterns already in use.
```

> **Source**: alirezarezvani `code-reviewer` 임계값 테이블 + 기존 dev §1 규칙

---

#### §2. Systematic Debugging (NEW — from obra)

```markdown
## 2. Systematic Debugging

Random fixes waste time and create new bugs. Follow this process for ANY issue.

**The four phases (each must complete before the next):**

### Phase 1: Root Cause Investigation
1. Read the FULL error message and stack trace — don't skip past them.
2. Reproduce consistently — exact steps, every time.
3. Check recent changes — `git diff`, recent commits, config changes.
4. Trace data flow — where does the bad value originate? Trace backward.

### Phase 2: Pattern Analysis
1. Find working code that does something similar in the same codebase.
2. List every difference between working and broken — however small.

### Phase 3: Hypothesis Testing
1. Form ONE hypothesis: "X is the root cause because Y."
2. Make the SMALLEST possible change to test it.
3. One variable at a time. Don't fix multiple things at once.

### Phase 4: Implementation
1. Create a failing test that reproduces the bug.
2. Implement a single fix addressing the root cause.
3. Verify: test passes, no regressions.

**If 3+ fix attempts fail:** Stop. The problem is architectural, not a bug.
Discuss with your human partner before attempting more fixes.

**Red flags — stop and go back to Phase 1:**
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "I don't fully understand but this might work"
```

> **Source**: obra `systematic-debugging` (297줄) → 핵심 패턴만 추출

---

#### §3. Verification Before Completion (NEW — from obra)

```markdown
## 3. Verification Before Completion

Never claim work is complete without running verification.

**The gate (mandatory before ANY completion claim):**
1. **IDENTIFY**: What command proves this claim?
2. **RUN**: Execute the full command (fresh, not cached).
3. **READ**: Full output. Check exit code.
4. **VERIFY**: Does output confirm the claim?
5. **Only then**: State the claim WITH evidence.

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| "Tests pass" | Test command output showing 0 failures | "Should pass", previous run |
| "Build succeeds" | Build command exit 0 | Linter passing |
| "Bug fixed" | Original symptom verified fixed | "Code changed" |
| "Feature complete" | Each requirement checked line-by-line | "Tests pass" |

**Red flags:**
- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Done!")
- Relying on partial verification
```

> **Source**: obra `verification-before-completion` (140줄) → 게이트 함수 + 실패 테이블 그대로 채용

---

#### §4. Change Documentation (from 현재 §4)

```markdown
## 4. Change Documentation

When a worklog or changelog file is provided, record every change:

**Format:**
### [filename] — [reason for change]
- **Changes**: what was modified
- **Impact**: modules that import or depend on this file
- **Verification**: how the change was tested
```

> **Source**: 기존 dev §4를 영어 번역 + 간소화

---

#### §5. Safety Rules (from 현재 §5)

```markdown
## 5. Safety Rules

- **Never delete existing exports** — other modules may depend on them.
- **Verify imports exist** before adding new import statements.
- **No hardcoded configuration** — use config files or environment variables.
- **Error handling is mandatory** — `try/catch` for all async operations.
  No silent failures. At minimum, log the error.
- **No destructive operations without confirmation** — deleting files,
  dropping tables, or resetting state require explicit user approval.
```

> **Source**: 기존 dev §5 + obra safety philosophy

---

#### §6. Code Quality Signals (NEW — from code-reviewer)

```markdown
## 6. Code Quality Signals

Watch for these anti-patterns and fix immediately:

| Anti-Pattern | Symptom | Fix |
|---|---|---|
| God class | >20 methods, mixed responsibilities | Split by domain |
| Long method | >50 lines, does multiple things | Extract functions |
| Deep nesting | >4 levels of if/for/try | Early returns, guard clauses |
| Magic numbers | Hardcoded `86400`, `1024`, `3` | Named constants |
| Stringly typed | Using strings where enums/types belong | Define type/enum |
| Missing error handling | No catch, no validation | Add try/catch, validate inputs |
| Floating promises | async call without await | Always await or handle rejection |
```

> **Source**: alirezarezvani `code-reviewer` antipatterns + obra general principles

---

## 2. `dev-backend` — Backend Development Guide

### 현재 문제 (62줄, 한국어)

- Express.js + better-sqlite3 코드 예제 → **프레임워크 무관 패턴으로 교체**
- `server.js 참고` → **삭제**
- `~/.cli-jaw/skills_ref/postgres/` → **삭제**
- 얕은 내용 (API + DB + 에러 + 보안만, 각 5줄씩) → **깊이 확장**

### 새 구조 (목표 ~250줄)

---

#### §1. API Design Patterns

```markdown
## 1. API Design Patterns

### RESTful Conventions
| Method | Purpose | Example |
|--------|---------|---------|
| GET | Read (list or single) | `GET /api/users`, `GET /api/users/:id` |
| POST | Create | `POST /api/users` |
| PUT | Full replace | `PUT /api/users/:id` |
| PATCH | Partial update | `PATCH /api/users/:id` |
| DELETE | Remove | `DELETE /api/users/:id` |

### Consistent Response Format
‎```json
// Success
{ "success": true, "data": { ... }, "meta": { "requestId": "abc-123" } }

// Error
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
‎```

### HTTP Status Codes
| Code | When to Use |
|------|-------------|
| 200 | Success (GET, PUT, PATCH) |
| 201 | Created (POST) |
| 204 | No Content (DELETE) |
| 400 | Validation error |
| 401 | Authentication required |
| 403 | Permission denied |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

### Query Parameters
Use for filtering, sorting, and pagination:
`GET /api/users?role=admin&sort=name&limit=20&offset=0`
```

> **Source**: alirezarezvani `senior-backend` + ECC `backend-patterns` RESTful section

---

#### §2. Architecture Patterns

```markdown
## 2. Architecture Patterns

### Layered Architecture
‎```
Routes → Controllers → Services → Repositories → Database
  │          │             │            │
  │          │             │            └── Data access (SQL, ORM)
  │          │             └── Business logic, validation
  │          └── HTTP parsing, response formatting
  └── URL mapping, middleware chain
‎```

**Rules:**
- Routes only call controllers. Never put business logic in routes.
- Services never touch HTTP objects (req, res). They receive plain data.
- Repositories abstract database access. Services don't write raw SQL.

### When to Split
- **Extract a module** when: it has different scaling needs,
  a separate team owns it, or it needs a different technology.
- **Default to monolith** for teams <10 developers.
- **Don't microservice** until domain boundaries are well understood.
```

> **Source**: alirezarezvani `senior-architect` decision workflows + `senior-backend` middleware pattern

---

#### §3. Database Patterns

```markdown
## 3. Database Patterns

### Query Optimization
‎```sql
-- ✅ Select only needed columns
SELECT id, name, email FROM users WHERE role = 'admin' LIMIT 20;

-- ❌ Never SELECT * in production code
SELECT * FROM users;
‎```

### N+1 Prevention
‎```
❌ BAD: Fetch list → loop → fetch related (N queries)
✅ GOOD: Fetch list → collect IDs → batch fetch related (2 queries)
‎```

### Index Strategy
| Type | Use Case |
|------|----------|
| Single column | Equality lookups (`WHERE email = ?`) |
| Composite | Multi-column queries (`WHERE user_id = ? AND status = ?`) |
| Partial | Filtered subsets (`WHERE status = 'active'`) |
| Covering | Avoid table lookups (include all selected columns) |

### Transactions
Wrap multi-step writes in a transaction. If any step fails, all roll back.
Always use the framework's transaction API — never manual BEGIN/COMMIT.

### Migrations
- One migration file per schema change.
- Always include a rollback.
- Never modify a migration that has already been applied.
```

> **Source**: alirezarezvani `senior-backend` DB optimization + ECC `backend-patterns` N+1/transaction

---

#### §4. Error Handling

```markdown
## 4. Error Handling

### Centralized Error Handler
Define custom error classes to distinguish operational errors (user input,
network failure) from programmer errors (undefined variable, type error):

- **Operational errors**: Return appropriate HTTP status. Log at warn level.
- **Programmer errors**: Return 500. Log at error level with stack trace.

### Retry with Backoff
For transient failures (network, rate limits), retry with exponential backoff:
- Attempt 1: immediate
- Attempt 2: wait 1s
- Attempt 3: wait 2s
- Attempt 4: wait 4s
- Max retries: 3-5 depending on operation

### Structured Error Response
Every error response must include:
- Error code (machine-readable, e.g. `VALIDATION_ERROR`)
- Message (human-readable)
- Details (optional, field-level validation errors)
- Request ID (for log correlation)
```

> **Source**: alirezarezvani `senior-backend` + ECC `backend-patterns` error handling

---

#### §5. Security

```markdown
## 5. Security

**Input Validation:**
- Validate ALL user input at the API boundary (schema validation).
- Reject unknown fields. Coerce types. Enforce length limits.

**Authentication:**
- Tokens must expire. Short-lived access tokens + refresh tokens.
- Never hardcode secrets in source code. Use environment variables.
- Verify tokens on every protected endpoint.

**Authorization:**
- Define permission roles (read, write, delete, admin).
- Check permissions in middleware, not in business logic.

**Rate Limiting:**
- Apply per-IP and per-user rate limits on all public endpoints.
- Return 429 with Retry-After header when exceeded.

**Headers:**
- Enable security headers (CORS, CSP, HSTS, X-Frame-Options).
- Disable X-Powered-By.
```

> **Source**: alirezarezvani `senior-backend` security workflow + ECC `backend-patterns` auth/rate-limiting

---

#### §6. Logging & Middleware

```markdown
## 6. Logging & Middleware

### Structured Logging
Log as JSON with consistent fields:
- `timestamp`, `level` (info/warn/error), `message`
- `requestId` (for tracing across services)
- `userId` (when authenticated)
- `duration` (for performance tracking)

### Middleware Pipeline
Order matters:
1. Request ID generation
2. Logging (request start)
3. Authentication
4. Authorization
5. Input validation
6. Route handler
7. Error handler
8. Logging (request end with duration)
```

> **Source**: ECC `backend-patterns` structured logging + alirezarezvani patterns

---

## 3. `dev-data` — Data Engineering & Analysis Guide

### 현재 문제 (77줄, 한국어)

- SQLite + CSV 전용 코드 예제 → **형식 무관 패턴으로 교체**
- `better-sqlite3` import 예제 → **삭제**
- `~/.cli-jaw/skills_ref/postgres/` → **삭제**
- ETL 패턴이 5줄짜리 → **프로덕션 수준 확장**

### 새 구조 (목표 ~200줄)

---

#### §1. Data Processing Principles

```markdown
## 1. Data Processing Principles

- **Pipeline thinking**: Every pipeline is Extract → Transform → Load.
  Keep each stage as an independent, testable function.
- **Schema-first**: Define expected columns, types, and constraints
  BEFORE writing any transformation logic.
- **Defensive parsing**: External data will have nulls, wrong types,
  extra columns, missing columns, and encoding issues. Assume all of these.
- **Idempotent operations**: Running the same pipeline twice on the same
  input must produce the same output with no side effects.
- **Fail fast, fail loud**: Invalid data should raise errors immediately,
  not silently produce wrong results downstream.
```

> **Source**: 기존 dev-data §1 원칙 + alirezarezvani `senior-data-engineer` philosophy

---

#### §2. Data Ingestion Patterns

```markdown
## 2. Data Ingestion Patterns

### Format Decision
| Format | When to Use | Watch Out For |
|--------|-------------|---------------|
| CSV | Simple tabular, human-readable | Encoding, delimiter ambiguity, multiline values |
| JSON | Nested structures, APIs | Large files (stream, don't load all), encoding |
| Parquet | Large analytical datasets | Requires library support, not human-readable |
| Excel | Business user sources | Multiple sheets, merged cells, formulas |
| Database | Production systems | Connection pooling, query timeout, read replicas |

### Incremental Loading
For large or frequently updated sources:
- Use a **watermark column** (e.g., `updated_at`) to track last processed record.
- Store watermark after successful load. Restart from watermark on failure.
- Process in batches, not all-at-once.

### Schema Validation on Ingest
Before processing, validate:
- Expected columns exist
- Data types match expectations
- Required fields are not null
- Values are within expected ranges
```

> **Source**: alirezarezvani `senior-data-engineer` incremental + 기존 CSV/JSON 섹션 확장

---

#### §3. ETL/ELT Pipeline Design

```markdown
## 3. ETL/ELT Pipeline Design

### Layer Architecture
‎```
Raw / Staging    →    Transformation    →    Marts / Output
(exact copy of       (cleaning, joins,       (business-ready
 source data)         deduplication)          aggregations)
‎```

### Key Practices
- **Staging is sacrosanct**: Never modify raw data. Copy first, transform second.
- **Incremental processing**: Process only new/changed records, not full reloads.
- **Idempotent writes**: Use upsert (INSERT ON CONFLICT UPDATE) or replace patterns.
- **Separation of concerns**: One transformation step per logical operation.
  Don't combine cleaning + joining + aggregation in one function.

### Error Handling in Pipelines
- **Dead letter queue**: Invalid records go to a separate table/file for review.
  Don't drop them silently.
- **Retry with backoff**: For transient source failures (API timeouts, network).
- **Alerting**: Pipeline failures must notify (email, Slack, log alert).

### Orchestration Basics
- Define tasks as a DAG (directed acyclic graph).
- Each task is retryable independently.
- Set `depends_on_past = False` unless strict ordering is required.
- Set reasonable retries (2-3) with delay (5 min).
```

> **Source**: alirezarezvani `senior-data-engineer` batch ETL workflow + dbt model pattern 핵심 추출

---

#### §4. Data Quality

```markdown
## 4. Data Quality

### Validation Checks (run after every pipeline step)

| Check | What It Validates | Example |
|-------|-------------------|---------|
| **Not null** | Required fields have values | `order_id IS NOT NULL` |
| **Unique** | No duplicates on key columns | `COUNT(DISTINCT id) = COUNT(id)` |
| **Range** | Values within expected bounds | `amount BETWEEN 0 AND 1000000` |
| **Categorical** | Values in allowed set | `status IN ('active', 'inactive')` |
| **Freshness** | Data is recent enough | `MAX(updated_at) > NOW() - 1 day` |
| **Row count** | No unexpected data loss | `COUNT(*) > 0` and within ±10% of previous run |
| **Referential** | Foreign keys point to existing records | `customer_id EXISTS IN customers` |

### Data Contracts
For shared datasets, define a contract:
- **Schema**: column names, types, nullability
- **SLA**: max delay (e.g., data must be <1 hour old)
- **Completeness**: min percentage (e.g., 99.9% rows must be valid)
- **Owner**: team/person responsible for data quality
- **Consumers**: who uses this data and for what
```

> **Source**: alirezarezvani `senior-data-engineer` data quality framework + Great Expectations 패턴

---

#### §5. Analysis & Reporting

```markdown
## 5. Analysis & Reporting

### Start with Summary Statistics
Before deep analysis, always provide:
- Row count
- Column count and types
- Null counts per column
- Min/Max/Mean for numeric columns
- Unique value counts for categorical columns

### Output Formats
- **Markdown tables**: For inline reports (≤50 rows)
- **JSON**: For programmatic consumption
- **HTML + Chart.js / Mermaid**: For visual dashboards
- **CSV export**: For further analysis in spreadsheets

### Statistical Methods
When analysis requires statistics:
- Clearly state the method and its assumptions
- Report confidence intervals, not just point estimates
- Visualize distributions, not just averages
```

> **Source**: 기존 dev-data 분석 섹션 + alirezarezvani `senior-data-scientist` analytics overlay

---

#### §6. Architecture Decisions

```markdown
## 6. Architecture Decisions

### Batch vs Streaming
‎```
Is real-time insight required (<1 min)?
├── Yes → Streaming (Kafka, Kinesis, Pub/Sub)
└── No → Batch
    └── Data volume >1TB/day?
        ├── Yes → Distributed processing (Spark)
        └── No → Single-node processing (SQL, Python, dbt)
‎```

### Storage Format
| Need | Choose |
|------|--------|
| SQL analytics, BI dashboards | Data warehouse (Snowflake, BigQuery, PostgreSQL) |
| ML training, unstructured data | Data lake (S3/GCS + Parquet/Delta) |
| Both | Lakehouse (Delta Lake, Iceberg) |
| Real-time key-value lookups | Redis, DynamoDB |
```

> **Source**: alirezarezvani `senior-data-engineer` architecture decision framework (decision trees)

---

## 삭제 목록 (확인용)

현재 스킬에서 **반드시 삭제**해야 할 항목:

| 스킬 | 삭제 대상 | 이유 |
|---|---|---|
| `dev` | §2 Self-Reference 패턴 (cli-jaw 파일 참조) | 프로젝트 종속 |
| `dev` | §3 `~/.cli-jaw/skills_ref/` 스킬 탐색 경로 | 프로젝트 종속 |
| `dev-backend` | `Express.js 패턴 (이 프로젝트 기준)` 제목 + 코드 | 프레임워크 종속 |
| `dev-backend` | `데이터베이스 (better-sqlite3)` 섹션 | 라이브러리 종속 |
| `dev-backend` | `참고 스킬: ~/.cli-jaw/skills_ref/postgres/` | 프로젝트 종속 |
| `dev-data` | `SQLite (이 프로젝트)` 섹션 + `better-sqlite3` import | 프로젝트/라이브러리 종속 |
| `dev-data` | `참고 스킬: ~/.cli-jaw/skills_ref/...` | 프로젝트 종속 |

---

## 검증 계획

```bash
# 1. 한국어 잔존 검사
grep -rP '[\xAC00-\xD7AF]' skills_ref/dev*/SKILL.md

# 2. 프로젝트 특정 참조 검사
grep -ri 'cli-jaw\|skills_ref\|better-sqlite\|server\.js\|config\.js\|db\.js' skills_ref/dev*/SKILL.md

# 3. "다른 스킬 참고하세요" 류 안내 검사
grep -ri 'skills_ref/\|다른.*스킬.*참고\|See also.*skill' skills_ref/dev*/SKILL.md

# 4. 줄 수 확인 (각 500줄 이하)
wc -l skills_ref/dev/SKILL.md skills_ref/dev-backend/SKILL.md skills_ref/dev-data/SKILL.md
```

### 품질 체크리스트
- [ ] 모든 코드 예제가 프레임워크 무관 (또는 주석으로 복수 프레임워크 표기)
- [ ] 한국어 없음
- [ ] 프로젝트 경로 없음
- [ ] 각 섹션이 후보 소스에서 추적 가능
- [ ] Imperative tone ("Use X", not "You should consider...")
- [ ] 의사결정 트리 또는 테이블로 판단 지원
- [ ] `dev-frontend`, `dev-testing`은 변경 없음

---

## 4. `dev-code-reviewer` — Code Review Guide (신규 스킬)

### 위치/활성화 전략

- **역할 종속 아님** — 모든 에이전트가 참고 가능 (browser, github처럼 범용 레퍼런스)
- `registry.json`에 `orchestration` 카테고리로 등록
- `dev` SKILL.md Companion Skills 테이블에 추가
- 시스템/직원 프롬프트에서 코드 리뷰 시 참고하라고 안내

### 후보 소스 (3개)

| 소스 | 줄 수 | 핵심 내용 | 채용 |
|---|---|---|---|
| alirezarezvani `code-reviewer` | 178L | PR 분석, 코드 품질 체크 (SOLID/임계값), 리뷰 리포트 생성, 안티패턴 카탈로그, 6개 언어 지원 | §1 Review Process, §2 Quality Thresholds, §3 Antipatterns |
| obra `receiving-code-review` | 214L | 리뷰 받을 때: 검증 후 구현, pushback 패턴, YAGNI 체크, 수행적 동의 금지, 소스별 대응 | §4 Receiving Review |
| obra `requesting-code-review` | 106L | 리뷰 요청: 언제/어떻게, git SHA 기반 diff, 피드백 우선순위, 워크플로 통합 | §5 Requesting Review |

### 새 구조 (목표 ~180줄)

---

#### §1. Review Process

```markdown
## 1. Code Review Process

### Pre-Review Checklist
Before reviewing any code:
- [ ] Build passes (no compile/type errors)
- [ ] Tests pass (all green)
- [ ] PR description explains WHAT and WHY
- [ ] Diff is reasonable size (<500 lines, split if larger)

### Review Order
1. **Architecture** — Does the approach make sense? Right layer? Right abstraction?
2. **Correctness** — Logic errors, edge cases, off-by-one, null handling
3. **Security** — Input validation, injection, auth, secrets exposure
4. **Performance** — N+1 queries, unbounded collections, missing indexes
5. **Maintainability** — Names, structure, complexity, test coverage
6. **Style** — Last priority. Don't bikeshed formatting.
```

> **Source**: alirezarezvani `code-reviewer` review checklist reference, reordered by impact

---

#### §2. Quality Thresholds

```markdown
## 2. Quality Thresholds

Flag these automatically during review:

| Issue | Threshold | Severity |
|-------|-----------|----------|
| Long function | >50 lines | Medium |
| Large file | >500 lines | Medium |
| God class | >20 methods | High |
| Too many parameters | >5 | Medium |
| Deep nesting | >4 levels | Medium |
| High cyclomatic complexity | >10 branches | High |
| Missing error handling | any unhandled async | High |
| Hardcoded secrets | API keys, passwords in source | Critical |
| SQL injection | string concatenation in queries | Critical |
| Debug statements | console.log, debugger left in | Low |
| TODO/FIXME | unresolved in production code | Low |

### Review Verdict

| Score Indicator | Verdict |
|-----------------|---------|
| No high/critical issues | ✅ Approve |
| ≤2 high issues, fixable | 🔧 Approve with suggestions |
| Multiple high issues | ⚠️ Request changes |
| Any critical issue | 🚫 Block until resolved |
```

> **Source**: alirezarezvani `code-reviewer` thresholds + verdict table

---

#### §3. Common Antipatterns

```markdown
## 3. Common Antipatterns

### Structural
| Pattern | Symptom | Fix |
|---------|---------|-----|
| God class | One class does everything | Split by single responsibility |
| Long method | Function does 5+ distinct things | Extract named helpers |
| Deep nesting | 4+ levels of if/for/try | Guard clauses, early returns |
| Feature envy | Method uses another object's data more than its own | Move method |

### Logic
| Pattern | Symptom | Fix |
|---------|---------|-----|
| Boolean blindness | `doThing(true, false, true)` | Use named options/enums |
| Stringly typed | `status === 'actve'` (typo = silent bug) | Define enum/union type |
| Magic numbers | `if (retries > 3)` | Named constant: `MAX_RETRIES` |

### Security
| Pattern | Symptom | Fix |
|---------|---------|-----|
| SQL injection | String concat in queries | Parameterized queries |
| Hardcoded secrets | `apiKey = "sk-..."` | Environment variables |
| Missing input validation | Raw user input in logic | Schema validation at boundary |

### Performance
| Pattern | Symptom | Fix |
|---------|---------|-----|
| N+1 queries | Loop→query per item | Batch fetch with WHERE IN |
| Unbounded collections | `.all()` without LIMIT | Pagination, streaming |
| Missing index | Slow repeated lookups | Add database index |

### Async
| Pattern | Symptom | Fix |
|---------|---------|-----|
| Floating promise | `doAsync()` without await | Always await or catch |
| Callback hell | 4+ nested callbacks | async/await refactor |
```

> **Source**: alirezarezvani `code-reviewer` antipattern catalog (structural/logic/security/performance/async)

---

#### §4. Receiving Code Review

```markdown
## 4. Receiving Code Review

### The Response Pattern
WHEN receiving feedback:
1. **READ** — Complete feedback without reacting
2. **UNDERSTAND** — Restate the requirement in your own words
3. **VERIFY** — Check against codebase reality
4. **EVALUATE** — Technically sound for THIS codebase?
5. **RESPOND** — Technical acknowledgment or reasoned pushback
6. **IMPLEMENT** — One item at a time, test each

### When to Push Back
Push back when:
- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI (feature is unused — grep to verify)
- Technically incorrect for this stack
- Conflicts with existing architectural decisions

How: Use technical reasoning, reference working tests/code.

### Implementation Order (for multi-item feedback)
1. Clarify ALL unclear items FIRST — don't implement partial understanding
2. Blocking issues (breaks, security)
3. Simple fixes (typos, imports, naming)
4. Complex fixes (refactoring, logic changes)
5. Test EACH fix individually. Verify no regressions.

### Acknowledging Feedback
✅ "Fixed. [Brief description of what changed]"
✅ "Good catch — [specific issue]. Fixed in [location]."
✅ Just fix it and show the code.
❌ "You're absolutely right!" (performative)
❌ "Great point!" (performative)
```

> **Source**: obra `receiving-code-review` — response pattern, pushback rules, YAGNI checks, implementation order

---

#### §5. Requesting Code Review

```markdown
## 5. Requesting Code Review

### When to Request
**Mandatory:** After major feature, before merge to main, before refactoring
**Optional:** When stuck, after complex bug fix

### How to Request
1. Ensure build passes and tests are green
2. Identify the diff range (base commit vs head commit)
3. Summarize: what was implemented, what it should do, what to focus on

### Acting on Feedback
| Severity | Action |
|----------|--------|
| Critical | Fix immediately, re-request review |
| Important | Fix before proceeding to next task |
| Minor | Note for later, proceed if non-blocking |
| Style | Apply if trivial, otherwise defer |
```

> **Source**: obra `requesting-code-review` — trigger conditions, feedback priority

---

### `dev` 수정사항 (Companion Skills 업데이트)

`draft_dev.md` Companion Skills 테이블에 추가:

```markdown
| `dev-code-reviewer/SKILL.md` | Any agent, during code review | Review process, quality thresholds, antipatterns, giving/receiving feedback |
```

### `registry.json` 추가 엔트리

```json
"dev-code-reviewer": {
    "name": "Dev Code Reviewer",
    "name_ko": "Dev Code Reviewer",
    "name_en": "Dev Code Reviewer",
    "emoji": "🔍",
    "category": "orchestration",
    "description": "코드 리뷰 가이드. Quality thresholds, antipatterns, push-back rules. role 무관, 모든 에이전트 참고 가능.",
    "desc_ko": "코드 리뷰 가이드. Quality thresholds, antipatterns, push-back rules. role 무관, 모든 에이전트 참고 가능.",
    "desc_en": "Code review guide. Quality thresholds, antipatterns, push-back rules. Available to all agents regardless of role.",
    "requires": null,
    "install": null
}
```

