# Phase 6: Copilot 할당량 + UI 브랜딩

> 예상 시간: 20분

---

## 6.1 Copilot 할당량 표시

### API 엔드포인트 (copilotstats.com 방식)

```
GET https://api.github.com/copilot_internal/user
Authorization: token {gh_auth_token}
Editor-Version: vscode/1.95.0
```

### 실제 응답 (테스트 확인됨)
```json
{
    "login": "bitkyc08-arch",
    "access_type_sku": "free_limited_copilot",
    "copilot_plan": "individual",
    "chat_enabled": true,
    "is_mcp_enabled": true,
    "limited_user_quotas": {
        "chat": 490,        // ← 남은 chat 할당량
        "completions": 4000  // ← 남은 completions 할당량
    },
    "monthly_quotas": {
        "chat": 500,         // ← 월간 총 chat 할당량
        "completions": 4000  // ← 월간 총 completions 할당량
    },
    "limited_user_reset_date": "2026-03-22",
    "endpoints": {
        "api": "https://api.individual.githubcopilot.com",
        "proxy": "https://proxy.individual.githubcopilot.com"
    }
}
```

### 토큰 획득
```bash
gh auth token  # → gho_xxxxx
```

서버에서 `execSync('gh auth token')` 으로 자동 획득.

### 표시 항목

| 항목 | 소스 필드 | 표시 |
|------|-----------|------|
| 계정 | `login` | bitkyc08-arch |
| 플랜 | `access_type_sku` | free_limited_copilot |
| Chat 남은량 | `limited_user_quotas.chat` / `monthly_quotas.chat` | 490 / 500 (98%) |
| Completions | `limited_user_quotas.completions` / `monthly_quotas.completions` | 4000 / 4000 |
| 리셋일 | `limited_user_reset_date` | 2026-03-22 |
| MCP | `is_mcp_enabled` | ✅ |

### 파일 변경
- `[NEW] lib/quota-copilot.js` — `gh auth token` → API 호출 → 파싱
- `[MODIFY] server.js` — `/api/quota` 에 copilot 추가
- `[MODIFY] public/js/features/settings.js` — renderCliStatus에 bar 그래프 표시

### quota-copilot.js 구현 스케치
```js
import { execSync } from 'child_process';

export async function fetchCopilotQuota() {
    const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
    if (!token) return null;

    const res = await fetch('https://api.github.com/copilot_internal/user', {
        headers: {
            'Authorization': `token ${token}`,
            'Editor-Version': 'vscode/1.95.0',
        },
    });
    if (!res.ok) return null;
    const data = await res.json();

    const remaining = data.limited_user_quotas || {};
    const total = data.monthly_quotas || {};

    return {
        account: {
            email: data.login,
            plan: data.access_type_sku || data.copilot_plan,
        },
        windows: [
            {
                label: 'Chat',
                used: (total.chat || 0) - (remaining.chat || 0),
                limit: total.chat || 0,
                percent: total.chat ? ((total.chat - (remaining.chat || 0)) / total.chat * 100) : 0,
            },
            {
                label: 'Completions',
                used: (total.completions || 0) - (remaining.completions || 0),
                limit: total.completions || 0,
                percent: total.completions ? ((total.completions - (remaining.completions || 0)) / total.completions * 100) : 0,
            },
        ],
        resetDate: data.limited_user_reset_date,
    };
}
```

---

## 6.2 UI 브랜딩: CLAW → CLI-CLAW

### 변경 대상

| 위치 | 현재 | 변경 |
|------|------|------|
| `div.logo` | 🦞 CLAW | 🦞 CLI-CLAW |
| `<title>` | 🦞 Claw Agent | 🦞 CLI-CLAW |
| `chat-header` | 🦞 Claw Agent ● ... | 🦞 CLI-CLAW ● ... |

### 파일 변경
- `[MODIFY] public/index.html` — 3곳 텍스트 변경

---

## 6.3 구현 순서

1. `index.html` 브랜딩 텍스트 3곳 변경 (1분)
2. `lib/quota-copilot.js` 생성 (5분)  
3. `server.js` quota 라우트 수정 (3분)
4. 테스트 + 커밋 (5분)
