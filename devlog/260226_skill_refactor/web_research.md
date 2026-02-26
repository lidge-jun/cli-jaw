# Web Research — Authoritative Skill References

> Research date: 2026-02-26

## 1. Anthropic Official Skills Repository

**URL**: https://github.com/anthropics/skills

The official repository contains example skills published by Anthropic. Key findings:

### Official Development Skills

| Skill | Description | Our Equivalent |
|---|---|---|
| `frontend-design` | Anti-AI-slop frontend design guide | `dev-frontend` ✅ identical |
| `webapp-testing` | Playwright-based web app testing | `dev-testing` ✅ identical |
| `mcp-builder` | MCP server creation guide | N/A |
| `web-artifacts-builder` | React/Tailwind artifact builder | N/A |

### No Official Equivalents Found For

- ❌ General development guidelines (`dev`)
- ❌ Backend development (`dev-backend`)
- ❌ Data engineering (`dev-data`)

**Conclusion**: These three skills are **custom/unique** — no official Anthropic or major community equivalent exists. The refactor should follow official format conventions while keeping cli-jaw-relevant content.

---

## 2. Agent Skills Specification

**Source**: Anthropic docs + `anthropics/skills/spec/`

### SKILL.md Required Format

```yaml
---
name: kebab-case-name     # required, ≤64 chars
description: "..."        # required, ≤1024 chars, trigger conditions
license: Complete terms in LICENSE.txt  # recommended
---
```

### Progressive Disclosure Architecture

```
Loading Order:
1. YAML frontmatter (name + description) → ALWAYS loaded into system prompt
2. SKILL.md body → loaded ONLY when skill is deemed relevant
3. references/, scripts/, examples/ → loaded ON DEMAND by the agent
```

### Directory Structure Convention

```
skill-name/
├── SKILL.md           # required — instructions
├── LICENSE.txt        # recommended — license terms
├── scripts/           # optional — executable helpers
├── references/        # optional — supplementary docs
├── examples/          # optional — example patterns
└── assets/            # optional — templates, fonts, icons
```

---

## 3. Community Skills — `awesome-claude-skills`

**URL**: https://github.com/travisvn/awesome-claude-skills

### Notable Collections

- **obra/superpowers** — 20+ battle-tested skills (TDD, debugging, collaboration)
- **Trail of Bits Security Skills** — Security-focused development
- **Expo Skills** — React Native / Expo development

### Best Practices from Community

1. Keep descriptions concise — used for skill discovery
2. Write instructions as if for a human collaborator
3. Include specific examples in SKILL.md
4. Document dependencies and prerequisites
5. Test thoroughly across different scenarios

---

## 4. Anthropic Engineering Blog

**URL**: https://anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

Key design principles:
- Skills = self-contained packages of instructions, scripts, and resources
- Emphasis on **repeatability** and **specialization**
- Token efficiency through progressive disclosure
- Skills should enable Claude to be a **specialist** rather than a generalist

---

## 5. Cross-Agent Compatibility

The SKILL.md format is now supported across multiple AI coding agents:

| Agent | Support |
|---|---|
| Claude Code | ✅ Native |
| Claude.ai | ✅ Native |
| Claude API | ✅ Via project knowledge |
| OpenAI Codex CLI | ✅ Adopted format |
| Google Gemini CLI | ✅ Adopted format |
| GitHub Copilot | ✅ Adopted format |

This means well-written SKILL.md files are **portable** across agents.
