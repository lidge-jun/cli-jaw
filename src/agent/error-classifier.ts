// ─── Error Classification for Agent Exit ─────────────

export interface ErrorClassification {
    is429: boolean;
    isAuth: boolean;
    isStall: boolean;
    isModelCapacity: boolean;
    message: string;
}

export function classifyExitError(
    cli: string,
    code: number | null,
    stderrBuf: string,
    stallReason?: string,
    diagnosticText = '',
): ErrorClassification {
    const combined = `${stderrBuf}\n${diagnosticText}`;
    const isModelCapacity = cli === 'gemini'
        && (
            combined.includes('MODEL_CAPACITY_EXHAUSTED')
            || combined.includes('No capacity available for model')
        );
    const is429 = /\b429\b/.test(combined)
        || combined.includes('RESOURCE_EXHAUSTED')
        || combined.includes('Too Many Requests');
    const isAuth = combined.includes('auth') || combined.includes('credentials');
    const isStall = !!stallReason;

    let message = `${cli} 실행 실패 (exit ${code})`;
    if (isStall) message = `⏱️ 응답 없음 — ${stallReason}`;
    else if (isModelCapacity) message = '⚡ Gemini 모델 capacity 부족 — Auto로 임시 우회합니다';
    else if (is429) message = '⚡ API 용량 초과 (429)';
    else if (isAuth) message = '🔐 인증 오류 — CLI 로그인 상태를 확인해주세요';
    else if (combined.trim()) message = combined.trim().slice(0, 200);

    return { is429, isAuth, isStall, isModelCapacity, message };
}
