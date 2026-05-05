const SENTENCE_SPLIT = /(?<=[.!?])\s+/u;
const MARKDOWN_LINK = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s)]+/g;
const ABSENCE_PATTERN = /\b(no|none|never|not found|not available|does not exist|cannot find)\b/i;

export interface SourceClaim {
    id: string;
    text: string;
    sources: string[];
}

export interface SourceQualityRow {
    claimId: string;
    source: string;
    host: string | null;
    quality: 'primary' | 'research' | 'secondary' | 'unknown';
}

export interface SourceAuditResult {
    claims: SourceClaim[];
    claimsWithInlineSource: SourceClaim[];
    unsourcedClaims: SourceClaim[];
    sourceQualityRows: SourceQualityRow[];
    gaps: Array<{ code: string; message: string }>;
    ok: boolean;
    checkedScope: string | null;
    checkedDate: string | null;
}

export function auditSources(text = '', input: {
    requiredSourceRatio?: number;
    checkedScope?: string | null;
    checkedDate?: string | null;
} = {}): SourceAuditResult {
    const requiredSourceRatio = input.requiredSourceRatio ?? 1;
    const checkedScope = input.checkedScope || null;
    const checkedDate = input.checkedDate || null;
    const claims = extractClaims(text);
    const claimsWithInlineSource = claims.filter(claim => claim.sources.length > 0);
    const unsourcedClaims = claims.filter(claim => claim.sources.length === 0);
    const sourceQualityRows = buildSourceQualityRows(claims);
    const gaps: SourceAuditResult['gaps'] = [];

    if (claims.length && claimsWithInlineSource.length / claims.length < requiredSourceRatio) {
        gaps.push({
            code: 'unsourced-claims',
            message: `${unsourcedClaims.length} claim(s) lack inline sources`,
        });
    }

    const absenceClaims = claims.filter(claim => ABSENCE_PATTERN.test(claim.text));
    if (absenceClaims.length && (!checkedScope || !checkedDate)) {
        gaps.push({
            code: 'absence-scope-missing',
            message: 'absence claims require checkedScope and checkedDate',
        });
    }

    return {
        claims,
        claimsWithInlineSource,
        unsourcedClaims,
        sourceQualityRows,
        gaps,
        ok: gaps.length === 0,
        checkedScope,
        checkedDate,
    };
}

export function extractClaims(text = ''): SourceClaim[] {
    const claims: SourceClaim[] = [];
    const normalized = stripCodeFences(String(text));
    let index = 0;

    for (const rawLine of normalized.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || /^>\s*출처:/.test(line)) continue;
        const parts = line
            .replace(/^[-*]\s+/, '')
            .split(SENTENCE_SPLIT)
            .map(part => part.trim())
            .filter(Boolean);

        for (const part of parts) {
            if (!looksLikeClaim(part)) continue;
            const sources = extractInlineSources(part);
            claims.push({
                id: `claim-${String(index + 1).padStart(3, '0')}`,
                text: part,
                sources,
            });
            index += 1;
        }
    }

    return claims;
}

export function extractInlineSources(text = ''): string[] {
    const sources = new Set<string>();
    for (const match of String(text).matchAll(MARKDOWN_LINK)) {
        sources.add(cleanUrl(match[1] || ''));
    }
    for (const match of String(text).matchAll(BARE_URL)) {
        sources.add(cleanUrl(match[0] || ''));
    }
    return Array.from(sources).filter(Boolean);
}

function buildSourceQualityRows(claims: SourceClaim[]): SourceQualityRow[] {
    const rows: SourceQualityRow[] = [];
    for (const claim of claims) {
        for (const source of claim.sources) {
            rows.push({
                claimId: claim.id,
                source,
                host: hostOf(source),
                quality: classifySourceQuality(source),
            });
        }
    }
    return rows;
}

function stripCodeFences(text: string): string {
    return text.replace(/```[\s\S]*?```/g, '');
}

function looksLikeClaim(text: string): boolean {
    return /[A-Za-z0-9가-힣]/.test(text) && text.length >= 8;
}

function cleanUrl(url: string): string {
    return String(url).replace(/[.,;:!?]+$/g, '');
}

function hostOf(url: string): string | null {
    try {
        return new URL(url).host;
    } catch {
        return null;
    }
}

function classifySourceQuality(url: string): SourceQualityRow['quality'] {
    const host = hostOf(url) || '';
    if (/\b(openai|google|microsoft|github|npmjs|mozilla|w3|chromium)\b/i.test(host)) return 'primary';
    if (/\b(arxiv|doi|acm|ieee|nature|science)\b/i.test(host)) return 'research';
    if (host) return 'secondary';
    return 'unknown';
}
