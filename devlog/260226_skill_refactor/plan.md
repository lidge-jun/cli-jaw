# Skill Refactor Plan — Elevate All Dev Skills to Official Quality

## Downloaded Candidates (`candidates/`)

| # | File | Source | Stars | Category | Full SKILL.md? |
|---|---|---|---|---|---|
| 01 | `anthropic_frontend-design.md` | Anthropic Official | — | frontend | ✅ Full |
| 02 | `anthropic_webapp-testing.md` | Anthropic Official | — | testing | ✅ Full |
| 03 | `ecc_backend-patterns.md` | affaan/everything-claude-code | 52.6k ⭐ | backend | ✅ Full (10 sections) |
| 04 | `alirezarezvani_tdd-guide.md` | alirezarezvani/claude-skills | 53 skills | testing | ✅ Full |
| 05 | `community_catalog.md` | Multiple sources | — | all | Descriptions only |

> `05_community_catalog.md` contains 10 additional skill descriptions from repos that
> returned 404/429 on raw access. Clone commands provided for each repo.

### Recommended Clones for More Content

```bash
# alirezarezvani — 53 production-ready skills (backend-engineer, data-engineer, etc.)
git clone https://github.com/alirezarezvani/claude-skills.git

# obra/superpowers — 20+ battle-tested dev skills (TDD, debugging, planning)
git clone https://github.com/obra/superpowers.git

# QuestNova502 — 167 skills (senior-backend, data pipelines)
git clone https://github.com/QuestNova502/claude-skills-sync.git
```

---

## Background

The `skills_ref/` directory contains 5 custom dev skills used by the orchestrator to inject guidelines into sub-agents:

| Skill | Lang | Lines | Quality | Notes |
|---|---|---|---|---|
| `dev-frontend` | EN | 43 | ★★★ Reference | Matches Anthropic's official `frontend-design` verbatim |
| `dev-testing` | EN | 96 | ★★★ Reference | Matches Anthropic's official `webapp-testing` verbatim |
| `dev` | KR | 66 | ★☆☆ Needs refactor | Korean, project-specific, no license |
| `dev-data` | KR | 77 | ★☆☆ Needs refactor | Korean, project-specific code snippets |
| `dev-backend` | KR | 62 | ★☆☆ Needs refactor | Korean, project-specific code snippets |

## Web Research Results

### Authoritative Sources Identified

1. **Anthropic Official** — [`anthropics/skills`](https://github.com/anthropics/skills)
   - `frontend-design/SKILL.md` — Already our `dev-frontend` ✅
   - `webapp-testing/SKILL.md` — Already our `dev-testing` ✅
   - `mcp-builder/SKILL.md` — Reference for structured multi-phase skills
   - Template: `name` + `description` + `license` in YAML, then markdown body

2. **Community — [`awesome-claude-skills`](https://github.com/travisvn/awesome-claude-skills)**
   - No direct equivalents for `dev` / `dev-backend` / `dev-data`
   - Best practices: concise descriptions, actionable instructions, include examples

3. **Anthropic Docs** — [Agent Skills specification](https://anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
   - Progressive disclosure: frontmatter always loaded → SKILL.md loaded when relevant
   - Keep descriptions under 1024 chars, be specific about trigger conditions
   - Optional dirs: `scripts/`, `references/`, `assets/`, `examples/`

### Key Finding

> There are **NO official Anthropic skills** for general dev guidelines, backend development, or data engineering. These are **custom skills unique to this project**. Therefore, the refactor should follow the official SKILL.md format/style while keeping the content tailored to cli-jaw's architecture.

## Refactor Strategy

### Quality Standard (from `dev-frontend` / `dev-testing`)

- **Language**: English only
- **YAML frontmatter**: `name`, `description`, `license`
- **Tone**: Imperative, direct, actionable (like a senior engineer mentoring)
- **Structure**: Decision trees, bullet-point guidelines, anti-pattern warnings
- **No inline code blocks** unless illustrating a universal pattern (not project-specific)
- **No Korean** — all content in English
- **Project references**: Use relative paths, keep minimal

---

## Per-Skill Refactor Plan

### 1. `dev` → General Development Guidelines

**Current problems:**
- Written in Korean
- Contains project-specific file references that may become stale
- No license field
- Mixes concerns (modularity, self-reference, skill discovery, logging, safety)

**Refactored structure:**
```
dev/
├── SKILL.md        (rewritten in English)
└── LICENSE.txt     (added)
```

**Proposed sections:**
1. **Modular Development** — File size limits, single responsibility, ES Modules
2. **Self-Reference Pattern** — Treat this project as a living reference
3. **Skill Discovery** — How to find and use related skills
4. **Change Logging** — Required format for worklog entries
5. **Safety Rules** — Export preservation, import validation, config management, error handling

---

### 2. `dev-backend` → Backend Development Guide

**Current problems:**
- Written in Korean
- Express.js code snippet is overly specific
- SQLite section duplicates `dev-data`
- No license field

**Refactored structure:**
```
dev-backend/
├── SKILL.md        (rewritten in English)
└── LICENSE.txt     (added)
```

**Proposed sections:**
1. **API Design Principles** — RESTful conventions, consistent response format
2. **Route Architecture** — Grouping, middleware, error handling patterns
3. **Database Integration** — Prepared statements, transactions, migrations (generic, not SQLite-only)
4. **Security Fundamentals** — Input validation, injection prevention, secrets management
5. **Error Handling** — Try/catch patterns, user-facing vs internal errors, structured logging
6. **Performance** — Connection pooling, caching patterns, query optimization

---

### 3. `dev-data` → Data Engineering & Analysis Guide

**Current problems:**
- Written in Korean
- Code snippets are too specific (better-sqlite3 import, CSV parsing)
- Missing modern data patterns (streaming, validation schemas)
- No license field

**Refactored structure:**
```
dev-data/
├── SKILL.md        (rewritten in English)
└── LICENSE.txt     (added)
```

**Proposed sections:**
1. **Data Processing Principles** — Pipeline thinking, schema-first, defensive parsing
2. **ETL Patterns** — Extract → Transform → Load with error boundaries
3. **Data Sources** — SQL databases, JSON, CSV, APIs (generic patterns)
4. **Validation & Quality** — Schema validation, null handling, type coercion
5. **Analysis & Reporting** — Summary statistics, Markdown tables, visualization options
6. **Streaming & Scale** — Large dataset handling, chunk processing, memory management

---

### 4. `dev-frontend` — NO CHANGES ✅

Already matches Anthropic's official `frontend-design` skill verbatim.

### 5. `dev-testing` — NO CHANGES ✅

Already matches Anthropic's official `webapp-testing` skill verbatim.

---

## Style Guide for Rewritten Skills

| Aspect | Guideline |
|---|---|
| Language | English only |
| YAML fields | `name`, `description`, `license` |
| Description | ≤200 chars, include trigger conditions (e.g., "Injected when role=backend") |
| Tone | Direct, imperative, senior-engineer mentoring style |
| Anti-patterns | Use ❌/✅ markers like `dev-testing` does |
| Code snippets | Only for universal patterns, NOT project-specific implementations |
| Cross-references | Minimal, use `skills_ref/` relative paths |
| File length | Target 40–100 lines (matching reference skills) |

## Verification Plan

1. Validate YAML frontmatter parses correctly
2. Confirm `registry.json` entries are updated if name/description changes
3. Review each skill for Korean text remnants
4. Check cross-references point to valid skill directories
5. Manual review: read each skill and verify it provides actionable guidance without being project-specific
