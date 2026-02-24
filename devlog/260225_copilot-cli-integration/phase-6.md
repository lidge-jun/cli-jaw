# Phase 6: Copilot 할당량 + 추론강도 + UI 브랜딩

> 예상 시간: 25분

---

## 6.1 Copilot 할당량 표시

### 인증 토큰 (Copilot CLI 전용)

Copilot CLI는 `gh auth`와 **별도 인증**. macOS keychain에 저장:

```bash
# Copilot CLI 토큰 (gh auth token 과 다름!)
security find-generic-password -s "copilot-cli" -w
# → gho_ImRi4X... (40자 OAuth token)
```

| 항목 | `gh auth` | `copilot-cli` |
|------|-----------|---------------|
| account | bitkyc08-arch | jondo1323 |
| keychain service | gh:github.com | copilot-cli |
| plan | free_limited | Pro+ (1500 premium) |

### API 엔드포인트

```
GET https://api.github.com/copilot_internal/user
Authorization: token {copilot-cli keychain token}
Editor-Version: vscode/1.95.0
```

### 실제 응답 (테스트 완료)
```json
{
    "login": "jondo1323",
    "access_type_sku": "copilot_for_business_seat",
    "copilot_plan": "business",
    "chat_enabled": true,
    "quota_reset_date": "2026-03-01",
    "quota_snapshots": {
        "chat": {
            "unlimited": true,
            "percent_remaining": 100.0
        },
        "completions": {
            "unlimited": true,
            "percent_remaining": 100.0
        },
        "premium_interactions": {
            "entitlement": 1500,
            "percent_remaining": 4.42,
            "remaining": 66,
            "unlimited": false
        }
    }
}
```

### 표시 항목

| 항목 | 소스 필드 | 예시 |
|------|-----------|------|
| 계정 | `login` | jondo1323 |
| 플랜 | `access_type_sku` | copilot_for_business_seat |
| Premium 남은량 | `quota_snapshots.premium_interactions` | 66 / 1500 (4.4%) |
| Chat | `quota_snapshots.chat.unlimited` | ♾️ unlimited |
| Completions | `quota_snapshots.completions.unlimited` | ♾️ unlimited |
| 리셋일 | `quota_reset_date` | 2026-03-01 |

### 구현

```js
// lib/quota-copilot.js
import { execSync } from 'child_process';

export async function fetchCopilotQuota() {
    // macOS keychain에서 Copilot CLI 전용 토큰 획득
    const token = execSync(
        'security find-generic-password -s "copilot-cli" -w',
        { encoding: 'utf8' }
    ).trim();
    if (!token) return null;

    const res = await fetch('https://api.github.com/copilot_internal/user', {
        headers: {
            'Authorization': `token ${token}`,
            'Editor-Version': 'vscode/1.95.0',
        },
    });
    if (!res.ok) return null;
    const data = await res.json();

    const snap = data.quota_snapshots || {};
    const pi = snap.premium_interactions || {};
    const windows = [];

    if (!pi.unlimited) {
        windows.push({
            label: 'Premium Interactions',
            used: (pi.entitlement || 0) - (pi.remaining || 0),
            limit: pi.entitlement || 0,
            percent: 100 - (pi.percent_remaining || 0),
        });
    }

    return {
        account: { email: data.login, plan: data.access_type_sku },
        windows,
        resetDate: data.quota_reset_date,
        raw: data,
    };
}
```

---

## 6.2 추론강도 (Reasoning Effort)

Copilot CLI는 `--reasoning-effort` 플래그 지원:

| Level | 설명 |
|-------|------|
| `low` | Minimal thinking, 속도 우선 |
| `medium` | Balanced, 어려운 문제만 사고 |
| `high` (기본) | Optimal, 깊은 사고 |

### 적용 방법

AcpClient spawn 시 args에 추가:
```js
// src/acp-client.js spawn()
if (this.effort) args.push('--reasoning-effort', this.effort);
```

UI는 이미 `effortCopilot` 드롭다운 존재 → CLI_REGISTRY의 efforts 배열에 추가:
```js
copilot: {
    label: 'Copilot',
    efforts: ['low', 'medium', 'high'],  // ← 추가
    models: [...],
}
```

### 파일 변경
- `[MODIFY] src/acp-client.js` — constructor에 effort, spawn시 `--reasoning-effort`
- `[MODIFY] src/agent.js` — AcpClient에 effort 전달
- `[MODIFY] public/js/constants.js` — copilot.efforts 값 추가
- (서버 config는 이미 `perCli.copilot.effort` 지원)

---

## 6.3 UI 브랜딩: CLAW → CLI-CLAW

| 위치 | 현재 | 변경 |
|------|------|------|
| `div.logo` | 🦞 CLAW | 🦞 CLI-CLAW |
| `<title>` | 🦞 Claw Agent | 🦞 CLI-CLAW |
| `chat-header` | 🦞 Claw Agent ● ... | 🦞 CLI-CLAW ● ... |

### 파일 변경
- `[MODIFY] public/index.html` — 3곳 텍스트 변경

---

## 6.4 구현 순서

1. `index.html` 브랜딩 3곳 (1분)
2. `acp-client.js` + `agent.js` — effort 전달 (3분)
3. `constants.js` — copilot efforts 추가 (1분)
4. `lib/quota-copilot.js` [NEW] (5분)
5. `server.js` quota 라우트 수정 (3분)
6. 테스트 + 커밋 (5분)
