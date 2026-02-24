# Phase 6: Copilot 할당량 + 추론강도 + CLI-CLAW 브랜딩

> 예상 시간: 25분

---

## 6.1 Copilot 할당량 표시

### 인증 토큰

Copilot CLI는 `gh auth`와 **별도 인증** (macOS keychain):

```bash
security find-generic-password -s "copilot-cli" -w
# → gho_ImRi4X... (40자 OAuth)  account: jondo1323
```

### API

```
GET https://api.github.com/copilot_internal/user
Authorization: token {copilot-cli keychain token}
Editor-Version: vscode/1.95.0
```

### 응답 (테스트 완료)

```json
{
    "login": "jondo1323",
    "access_type_sku": "copilot_for_business_seat",
    "quota_reset_date": "2026-03-01",
    "quota_snapshots": {
        "premium_interactions": {
            "entitlement": 1500,
            "percent_remaining": 4.42,
            "remaining": 66,
            "unlimited": false
        },
        "chat": { "unlimited": true },
        "completions": { "unlimited": true }
    }
}
```

### 기존 UI 호환 (변경 불필요!)

`renderCliStatus()`가 이미 bar 그래프 + account 표시 지원:

```js
// 기존 quota 구조체 — copilot도 동일하게 반환하면 자동 표시
{
    account: { email: "jondo1323", plan: "Pro+" },
    windows: [{ label: "Premium", percent: 95.6 }],
    resetDate: "2026-03-01"
}
```

기존 CSS:
```css
/* bar 색상 (이미 구현됨) */
pct > 80  → #ef4444 (빨강)
pct > 50  → #fbbf24 (노랑)  
pct <= 50 → #38bdf8 (파랑)
```

### 파일 변경

#### [NEW] `lib/quota-copilot.js`

```js
import { execSync } from 'child_process';

export async function fetchCopilotQuota() {
    let token;
    try {
        token = execSync('security find-generic-password -s "copilot-cli" -w',
            { encoding: 'utf8', timeout: 3000 }).trim();
    } catch { return null; }
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

    if (!pi.unlimited && pi.entitlement) {
        windows.push({
            label: 'Premium',
            used: pi.entitlement - (pi.remaining || 0),
            limit: pi.entitlement,
            percent: 100 - (pi.percent_remaining || 0),
        });
    }

    return {
        account: {
            email: data.login,
            plan: data.access_type_sku?.replace(/_/g, ' '),
        },
        windows,
        resetDate: data.quota_reset_date,
    };
}
```

#### [MODIFY] `server.js` L599-606

```diff
 app.get('/api/quota', async (_, res) => {
-    const [claude, codex] = await Promise.all([
+    const [claude, codex, copilot] = await Promise.all([
         fetchClaudeUsage(readClaudeCreds()),
         fetchCodexUsage(readCodexTokens()),
+        fetchCopilotQuota(),
     ]);
     const gemini = readGeminiAccount();
-    res.json({ claude, codex, gemini, opencode: null, copilot: null });
+    res.json({ claude, codex, gemini, opencode: null, copilot });
 });
```

> 기존 `renderCliStatus()` 코드가 `account`, `windows` 구조를 그대로 소비하므로 프론트엔드 수정 불필요

---

## 6.2 추론강도 (Reasoning Effort)

### CLI별 비교

| CLI | 옵션 | 값 |
|-----|------|------|
| Claude | `--effort` | low, medium, high |
| Codex | `--reasoning` | low, medium, high, xhigh |
| Copilot | `--reasoning-effort` | low, medium, high |

> Copilot CLI v0.0.415의 `~/.copilot/config.json`에 `"reasoning_effort": "high"` 확인됨

### 파일 변경

#### [MODIFY] `src/acp-client.js`

```diff
 constructor({ model, workDir, permissions = 'safe' } = {}) {
     // ...
     this.model = model;
+    this.effort = null; // set before spawn
 }

 spawn() {
     const args = ['--acp'];
     if (this.model) args.push('--model', this.model);
+    if (this.effort) args.push('--reasoning-effort', this.effort);
```

#### [MODIFY] `src/agent.js` (copilot ACP branch)

```diff
-    const acp = new AcpClient({ model, workDir: settings.workingDir, permissions });
+    const acp = new AcpClient({ model, workDir: settings.workingDir, permissions });
+    if (effort) acp.effort = effort;
```

#### [MODIFY] `public/js/constants.js` — copilot efforts 배열

```diff
 copilot: {
     label: 'Copilot',
-    efforts: [],
+    efforts: ['low', 'medium', 'high'],
     models: [...]
 }
```

> UI는 이미 `syncPerCliModelAndEffortControls()`가 efforts 배열 기반으로 effortCopilot 드롭다운을 동적 생성하므로 HTML 변경 불필요

---

## 6.3 UI 브랜딩: CLAW → CLI-CLAW

#### [MODIFY] `public/index.html` — 3곳

```diff
-    <title>🦞 Claw Agent</title>
+    <title>🦞 CLI-CLAW</title>

-    <div class="logo">🦞 CLAW</div>
+    <div class="logo">🦞 CLI-CLAW</div>

-    <div class="chat-header">🦞 Claw Agent ● <span id="headerCli">claude</span></div>
+    <div class="chat-header">🦞 CLI-CLAW ● <span id="headerCli">claude</span></div>
```

---

## 6.4 구현 순서

| # | 작업 | 파일 | 시간 |
|---|------|------|------|
| 1 | 브랜딩 변경 | `index.html` (3곳) | 1분 |
| 2 | quota 모듈 | `lib/quota-copilot.js` [NEW] | 5분 |
| 3 | quota 라우트 | `server.js` (3줄) | 2분 |
| 4 | effort 전달 | `acp-client.js` + `agent.js` | 3분 |
| 5 | effort UI | `constants.js` (1줄) | 1분 |
| 6 | 테스트 | curl /api/quota + UI 확인 | 5분 |
| 7 | 커밋 + 푸시 | — | 2분 |
