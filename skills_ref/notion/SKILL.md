---
name: notion
description: Notion API for creating and managing pages, databases, and blocks.
homepage: https://developers.notion.com
metadata:
  {
    "openclaw":
      { "emoji": "📝", "requires": { "env": ["NOTION_API_KEY"] }, "primaryEnv": "NOTION_API_KEY" },
  }
---

# notion

Use the Notion API to create/read/update pages, data sources (databases), and blocks.

## Setup

1. Create an integration at https://notion.so/my-integrations
2. Copy the API key (starts with `ntn_` or `secret_`)
3. Store it:

```bash
mkdir -p ~/.config/notion
echo "ntn_your_key_here" > ~/.config/notion/api_key
```

4. Share target pages/databases with your integration (click "..." → "Connect to" → your integration name)

## API Basics

All requests need:

```bash
NOTION_KEY=$(cat ~/.config/notion/api_key)
curl -X GET "https://api.notion.com/v1/..." \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json"
```

> **Note:** The `Notion-Version` header is required. This skill uses `2025-09-03` (latest). In this version, databases are called "data sources" in the API.

## Common Operations

**Search for pages and data sources:**

```bash
curl -X POST "https://api.notion.com/v1/search" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{"query": "page title"}'
```

**Get page:**

```bash
curl "https://api.notion.com/v1/pages/{page_id}" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03"
```

**Get page content (blocks):**

```bash
curl "https://api.notion.com/v1/blocks/{page_id}/children" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03"
```

**Create page in a data source:**

```bash
curl -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"database_id": "xxx"},
    "properties": {
      "Name": {"title": [{"text": {"content": "New Item"}}]},
      "Status": {"select": {"name": "Todo"}}
    }
  }'
```

**Query a data source (database):**

```bash
curl -X POST "https://api.notion.com/v1/data_sources/{data_source_id}/query" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {"property": "Status", "select": {"equals": "Active"}},
    "sorts": [{"property": "Date", "direction": "descending"}]
  }'
```

**Create a data source (database):**

```bash
curl -X POST "https://api.notion.com/v1/data_sources" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"page_id": "xxx"},
    "title": [{"text": {"content": "My Database"}}],
    "properties": {
      "Name": {"title": {}},
      "Status": {"select": {"options": [{"name": "Todo"}, {"name": "Done"}]}},
      "Date": {"date": {}}
    }
  }'
```

**Update page properties:**

```bash
curl -X PATCH "https://api.notion.com/v1/pages/{page_id}" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{"properties": {"Status": {"select": {"name": "Done"}}}}'
```

**Add blocks to page:**

```bash
curl -X PATCH "https://api.notion.com/v1/blocks/{page_id}/children" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "children": [
      {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"text": {"content": "Hello"}}]}}
    ]
  }'
```

## Property Types

Common property formats for database items:

- **Title:** `{"title": [{"text": {"content": "..."}}]}`
- **Rich text:** `{"rich_text": [{"text": {"content": "..."}}]}`
- **Select:** `{"select": {"name": "Option"}}`
- **Multi-select:** `{"multi_select": [{"name": "A"}, {"name": "B"}]}`
- **Date:** `{"date": {"start": "2024-01-15", "end": "2024-01-16"}}`
- **Checkbox:** `{"checkbox": true}`
- **Number:** `{"number": 42}`
- **URL:** `{"url": "https://..."}`
- **Email:** `{"email": "a@b.com"}`
- **Relation:** `{"relation": [{"id": "page_id"}]}`

## Key Differences in 2025-09-03

- **Databases → Data Sources:** Use `/data_sources/` endpoints for queries and retrieval
- **Two IDs:** Each database now has both a `database_id` and a `data_source_id`
  - Use `database_id` when creating pages (`parent: {"database_id": "..."}`)
  - Use `data_source_id` when querying (`POST /v1/data_sources/{id}/query`)
- **Search results:** Databases return as `"object": "data_source"` with their `data_source_id`
- **Parent in responses:** Pages show `parent.data_source_id` alongside `parent.database_id`
- **Finding the data_source_id:** Search for the database, or call `GET /v1/data_sources/{data_source_id}`

## Current Environment

### API Key
- **Location:** `~/.config/notion/access_token` (also copied to `~/.config/notion/api_key`)
- **Format:** `ntn_` prefix
- **Load:** `NOTION_KEY=$(cat ~/.config/notion/api_key)`
- **OAuth config:** `~/.config/notion/oauth.env` (client_id, client_secret, redirect_uri)
- **OAuth docs:** `~/Documents/BlogProject/NOTION_OAUTH_SETUP.md`

### Workspace Structure

```
ROOT
├── Lidge AI [30eaee4f-954b-8033-8989-f275d1a9abca]
│   ├── 개인 작업함 [310aee4f-954b-8116-bc2f-d6fc87991451]
│   │   ├── 개요 [310aee4f-954b-816c-90c8-ef302ed2005e]
│   │   ├── 260223개발노트 (다른컴에 있음) [310aee4f-954b-81df-910d-fc8d64dce37d]
│   │   ├── 260224개발노트 (지금개발 반영) [310aee4f-954b-81bc-8052-c31c6c0e5b83]
│   │   └── 구현 계획 체크리스트 [310aee4f-954b-81d7-ad4c-d7e0e13be87a]
│   ├── 운영 [310aee4f-954b-8152-8cd7-cf14762daa24]
│   ├── 회의록 [310aee4f-954b-81b3-b257-c3f2ff4eda3d]
│   ├── 콘텐츠 [310aee4f-954b-819d-a127-c273e1f94896]
│   ├── 대시보드 [310aee4f-954b-81cf-9343-edbc1ee7f162]
│   └── 아카이브 [310aee4f-954b-8109-9f17-d7b9026baf21]
├── 2026년 3월 출범 [310aee4f-954b-81b5-a45a-e644fe305164]
│   └── Cliclaw [310aee4f-954b-8187-97fe-e5ec8b258264]
│       ├── 개요
│       ├── mvp 개발노트
│       ├── 260223개발노트
│       ├── 260224개발노트
│       ├── 전체 개발 히스토리 (MVP → Finness 6.9) [311aee4f-954b-816d-9af0-ea7786004a13]
│       └── 구현 계획 체크리스트
```

### Key Page IDs (Quick Reference)
- **Lidge AI (root):** `30eaee4f-954b-8033-8989-f275d1a9abca`
- **개인 작업함:** `310aee4f-954b-8116-bc2f-d6fc87991451`
- **Cliclaw:** `310aee4f-954b-8187-97fe-e5ec8b258264`
- **전체 개발 히스토리:** `311aee4f-954b-816d-9af0-ea7786004a13`

### Heartbeat Integration
- heartbeat job `notion_hourly_upgrade` (120min 주기)가 `Lidge AI/개인 작업함` 범위에서 소규모 개선 자동 수행
- heartbeat 설정: `~/.cli-claw/heartbeat.json`

## Notes

- Page/database IDs are UUIDs (with or without dashes)
- The API cannot set database view filters — that's UI-only
- Rate limit: ~3 requests/second average
- Use `is_inline: true` when creating data sources to embed them in pages
