# Phase 2.1 — `telegram-send` 스킬 설계

> CLI 에이전트가 서버 REST API를 호출하여 텔레그램으로 음성/이미지/파일을 직접 전송.
> 일반 텍스트 응답은 기존 파이프라인 유지 — 파일 전송만 별도 채널.

---

## 아키텍처

```
CLI agent
├── 일반 응답 → stdout (NDJSON) → orchestrator → Telegram 텍스트 (기존)
└── 스킬 호출 → curl localhost:3457/api/telegram/send → server → Grammy → Telegram (파일/음성)
```

두 채널 독립 → 충돌 없음.

---

## 구현 항목

### 1. 서버 엔드포인트

**`server.js`** — `POST /api/telegram/send`

```js
app.post('/api/telegram/send', upload.single('file'), async (req, res) => {
    const { telegramBot, telegramActiveChatIds } = await import('./src/telegram.js');
    if (!telegramBot) return res.status(503).json({ error: 'Telegram not connected' });
    
    const chatId = req.body.chat_id || [...telegramActiveChatIds][0];
    if (!chatId) return res.status(400).json({ error: 'No active Telegram chat' });
    
    const type = req.body.type || 'text';
    const caption = req.body.caption || undefined;
    const filePath = req.file?.path || req.body.file_path;
    
    switch (type) {
        case 'text':     await telegramBot.api.sendMessage(chatId, req.body.text); break;
        case 'voice':    await telegramBot.api.sendVoice(chatId, new InputFile(filePath), { caption }); break;
        case 'photo':    await telegramBot.api.sendPhoto(chatId, new InputFile(filePath), { caption }); break;
        case 'document': await telegramBot.api.sendDocument(chatId, new InputFile(filePath), { caption }); break;
    }
    res.json({ ok: true, chat_id: chatId, type });
});
```

- `chat_id`: 자동감지 (`telegramActiveChatIds`에서 마지막 활성 채팅)
- `type`: text / voice / photo / document
- 파일: multipart form-data 또는 `file_path` (로컬 경로)

### 2. 스킬 문서

**`skills_ref/telegram-send/SKILL.md`**

```yaml
---
name: telegram-send
description: "Send files, voice messages, photos, or text directly to the user's Telegram chat. Use when the user requests file delivery, voice responses, or image sharing."
---
```

핵심 curl 예제 (전부 영어):

```bash
# Send voice message (MUST be OGG+OPUS)
curl -s -X POST http://localhost:3457/api/telegram/send \
  -F type=voice -F file=@/path/to/audio.ogg

# Send photo with caption
curl -s -X POST http://localhost:3457/api/telegram/send \
  -F type=photo -F file=@/path/to/image.png -F caption="Analysis result"

# Send document
curl -s -X POST http://localhost:3457/api/telegram/send \
  -F type=document -F file=@/path/to/report.pdf -F caption="Weekly report"

# Send text (separate from normal response)
curl -s -X POST http://localhost:3457/api/telegram/send \
  -H "Content-Type: application/json" \
  -d '{"type":"text","text":"Intermediate result notification"}'
```

### 3. 시스템 프롬프트

**`prompt.js`** — A1_CONTENT에 추가 (Browser Control 아래):

```markdown
## Telegram File Delivery (MANDATORY for non-text content)
Your normal text response will be delivered to the user automatically via the existing pipeline.
If you want to send the user any file, voice message, image, or document — NOT plain text — you MUST use the Telegram Send API. There is no other way to deliver non-text content to the user.

### Usage
curl -s -X POST http://localhost:3457/api/telegram/send \
  -F type=voice -F file=@/path/to/audio.ogg

curl -s -X POST http://localhost:3457/api/telegram/send \
  -F type=photo -F file=@/path/to/image.png -F caption="Description"

curl -s -X POST http://localhost:3457/api/telegram/send \
  -F type=document -F file=@/path/to/report.pdf -F caption="Report"

### Rules
- Supported types: voice, photo, document (text goes through normal response)
- Voice files MUST be OGG format with OPUS codec (`ffmpeg -i input.mp3 -c:a libopus output.ogg`)
- Only send files when the user explicitly requests it or the task requires file delivery
- Always provide a normal text response alongside the file delivery
```

서브에이전트(`getSubAgentPrompt`)에도 동일 추가.

### 4. 레지스트리

**`registry.json`**:

```json
"telegram-send": {
    "name": "Telegram Send",
    "emoji": "📨",
    "category": "communication",
    "description": "텔레그램으로 음성/이미지/파일 직접 전송"
}
```

---

## 검증

1. 서버 시작 → 텔레그램 메시지 수신 (chat_id 활성화)
2. CLI에서 `curl ...api/telegram/send -F type=text` → 텔레그램 수신 확인
3. TTS 생성 → OGG 변환 → voice 전송 → 재생 확인
4. 이미지 전송 → 캡션 포함 확인

## 체크리스트

- [ ] `POST /api/telegram/send` 엔드포인트
- [ ] `skills_ref/telegram-send/SKILL.md`
- [ ] `prompt.js` A1 + 서브에이전트 프롬프트 추가
- [ ] `registry.json` 등록
- [ ] 테스트
