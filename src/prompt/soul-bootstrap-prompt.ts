/**
 * src/prompt/soul-bootstrap-prompt.ts
 *
 * Builds a one-shot prompt for LLM-driven soul.md personalization.
 * The active CLI agent receives this prompt and rewrites soul.md
 * based on available user context (system profile, legacy memory, KV data).
 */

export interface SoulBootstrapContext {
    systemProfile: string;
    currentSoul: string;
    profileContent: string;
    kvEntries: { key: string; value: string }[];
    lang: string;
    serverUrl: string;
    instanceHome: string;
}

export function buildSoulBootstrapPrompt(ctx: SoulBootstrapContext): string {
    const kvBlock = ctx.kvEntries.length
        ? ctx.kvEntries.map(m => `- ${m.key}: ${m.value}`).join('\n')
        : '(no entries)';

    const done = ctx.lang === 'ko' ? '✅ Soul 최적화 완료' : '✅ Soul optimization complete';
    const saveUrl = `${ctx.serverUrl}/api/jaw-memory/save`;
    const soulUrl = `${ctx.serverUrl}/api/jaw-memory/soul`;

    return `내 AI 어시스턴트의 soul.md를 개인화해줘. 아래 정보를 참고해서 기존 템플릿을 내 환경에 맞게 다시 작성해.

현재 soul.md:
\`\`\`markdown
${ctx.currentSoul}
\`\`\`

내 시스템 정보:
${ctx.systemProfile}

내 프로필:
${ctx.profileContent || '(비어있음)'}

메모리 (${ctx.kvEntries.length}개):
${kvBlock}

작업 방법:
- Core Values, Tone, Boundaries, Relationship, Defaults 섹션 구조는 유지
- 각 섹션 2-5개 bullet point, 구체적으로
- ALWAYS write in English (proper nouns may remain in their original language)
- 이 요청은 인스턴스 "${ctx.instanceHome}" 에서 발생했어. 반드시 이 인스턴스의 API 엔드포인트로 저장해야 다른 인스턴스를 덮어쓰지 않아.
- 완성된 전체 soul.md를 POST ${saveUrl} 로 저장 (body: { "file": "shared/soul.md", "content": "전체 내용" })
- 저장 후 POST ${soulUrl} 호출 (body: { "section": "Defaults", "action": "add", "content": "soul-bootstrap-complete", "confidence": "high", "reason": "soul-bootstrap" })
- 끝나면 "${done}" 이라고 답해줘`;
}
