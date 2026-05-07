// ─── Error Classification for Agent Exit ─────────────

export interface ErrorClassification {
    is429: boolean;
    isAuth: boolean;
    isStall: boolean;
    message: string;
}

export function classifyExitError(
    cli: string,
    code: number | null,
    stderrBuf: string,
    stallReason?: string,
): ErrorClassification {
    const is429 = /\b429\b/.test(stderrBuf)
        || stderrBuf.includes('RESOURCE_EXHAUSTED')
        || stderrBuf.includes('Too Many Requests');
    const isAuth = stderrBuf.includes('auth') || stderrBuf.includes('credentials');
    const isStall = !!stallReason;

    let message = `${cli} 실행 실패 (exit ${code})`;
    if (isStall) message = `⏱️ 응답 없음 — ${stallReason}`;
    else if (is429) message = '⚡ API 용량 초과 (429)';
    else if (isAuth) message = '🔐 인증 오류 — CLI 로그인 상태를 확인해주세요';
    else if (stderrBuf.trim()) message = stderrBuf.trim().slice(0, 200);

    return { is429, isAuth, isStall, message };
}
