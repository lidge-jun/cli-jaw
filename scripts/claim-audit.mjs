// @ts-check
/**
 * G10 mirror — cli-jaw claim audit.
 *
 * cli-jaw is a multi-CLI agent runtime that talks to local Chrome via the
 * `agbrowse` skill. cli-jaw itself does NOT operate hosted/cloud browsers,
 * does NOT expose remote CDP, does NOT bypass CAPTCHA/Cloudflare/stealth,
 * and does NOT publish benchmark leaderboard scores.
 *
 * This script enforces those positioning boundaries on cli-jaw's own claim
 * surfaces (READMEs, capability truth table). Wired through
 * `scripts/release-gates.mjs` as `gate:no-cloud-claims` and mirrors
 * `agbrowse/web-ai/claim-audit.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';

const TARGETS = [
    { file: 'README.md', sectionMode: 'ready' },
    { file: 'README.ko.md', sectionMode: 'ready' },
    { file: 'README.ja.md', sectionMode: 'ready' },
    { file: 'README.zh-CN.md', sectionMode: 'ready' },
    { file: 'structure/CAPABILITY_TRUTH_TABLE.md', sectionMode: 'ready' },
];

const FORBIDDEN = [
    { term: 'hosted browser', re: /hosted\s+browser/i, why: 'cli-jaw delegates to local Chrome via agbrowse only' },
    { term: 'cloud browser', re: /cloud\s+browser/i, why: 'no managed/cloud browser runtime' },
    { term: 'cloud runtime', re: /cloud\s+runtime/i, why: 'no managed/cloud runtime' },
    { term: 'cloud agent', re: /cloud\s+agent/i, why: 'no hosted agent service' },
    { term: 'remote CDP', re: /remote[-\s]+cdp/i, why: 'remote CDP is deferred upstream (agbrowse docs/EXTERNAL_CDP.md)' },
    { term: 'external CDP', re: /external[-\s]+cdp/i, why: 'external CDP is deferred upstream' },
    { term: 'stealth', re: /\bstealth\b/i, why: 'no stealth/anti-detection support' },
    { term: 'CAPTCHA bypass', re: /captcha\s+bypass/i, why: 'no CAPTCHA bypass' },
    { term: 'Cloudflare bypass', re: /cloudflare\s+bypass/i, why: 'no Cloudflare bypass' },
    { term: 'leaderboard', re: /leaderboard/i, why: 'no benchmark leaderboard claim' },
];

const EXPERIMENTAL_HEADERS = [
    /experimental/i,
    /deferred/i,
    /out\s+of\s+scope/i,
    /forbidden/i,
    /not\s+implemented/i,
    /known\s+gaps/i,
    /comparison\s+rules/i,
    /mirror\s+rules/i,
    /known\s+limitations/i,
    /comparison(\s+(boundary|vs|with|against|table))?/i,
    /^current\s+positioning/i,
    /^positioning/i,
    /support\s+labels?/i,
    /public\s+claim\s+gate/i,
    /^status$/i,
    /^phase\s+status/i,
    /claim[-\s]*audit/i,
    /boundary/i,
];

const NEGATION_MARKERS = [
    /\bno\b/i,
    /\bnot\b/i,
    /\bdeferred\b/i,
    /\bdeferral\b/i,
    /\bdo(?:es)?\s+not\b/i,
    /\bwon['’]t\b/i,
    /\bnever\b/i,
    /\bout\s+of\s+scope\b/i,
    /\bexperimental\b/i,
    /\bforbidden\b/i,
    /\bdeprecated\b/i,
    /\bn\/?a\b/i,
    /\bpending\b/i,
    /\bdeliberately\b/i,
    /\bdoes\s+not\s+offer\b/i,
];

/**
 * @param {string} text
 * @returns {Array<{ start: number, end: number, head: string, isExperimental: boolean }>}
 */
function partitionSections(text) {
    const lines = text.split('\n');
    const sections = [];
    let cur = { start: 0, head: '(prologue)', isExperimental: false };
    for (let i = 0; i < lines.length; i += 1) {
        const m = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i]);
        if (m) {
            sections.push({ start: cur.start, end: i, head: cur.head, isExperimental: cur.isExperimental });
            const head = m[1];
            const isExp = EXPERIMENTAL_HEADERS.some((re) => re.test(head));
            cur = { start: i + 1, head, isExperimental: isExp };
        }
    }
    sections.push({ start: cur.start, end: lines.length, head: cur.head, isExperimental: cur.isExperimental });
    return sections;
}

/**
 * @param {{ repoRoot: string }} opts
 */
export function auditClaims({ repoRoot }) {
    const offending = [];
    const scanned = [];
    for (const target of TARGETS) {
        const abs = path.join(repoRoot, target.file);
        if (!fs.existsSync(abs)) continue;
        scanned.push(target.file);
        const text = fs.readFileSync(abs, 'utf8');
        const sections = partitionSections(text);
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.startsWith('```') || trimmed.startsWith('//')) continue;
            const sec = sections.find((s) => i >= s.start && i < s.end);
            if (target.sectionMode === 'ready' && sec && sec.isExperimental) continue;
            const lineHasNegation = NEGATION_MARKERS.some((re) => re.test(line));
            let paragraphHasNegation = false;
            for (let j = i - 1, scannedBack = 0; j >= 0 && scannedBack < 3; j -= 1) {
                const back = lines[j].trim();
                if (!back) continue;
                scannedBack += 1;
                if (NEGATION_MARKERS.some((re) => re.test(back))) {
                    paragraphHasNegation = true;
                    break;
                }
            }
            for (const f of FORBIDDEN) {
                if (f.re.test(line)) {
                    if (lineHasNegation || paragraphHasNegation) continue;
                    offending.push({
                        file: target.file,
                        line: i + 1,
                        term: f.term,
                        why: f.why,
                        section: sec ? sec.head : '(unknown)',
                    });
                }
            }
        }
    }
    return { ok: offending.length === 0, scanned, offending };
}

export function formatClaimAuditReport(report) {
    const lines = [];
    lines.push(`claim-audit: scanned ${report.scanned.length} file(s)`);
    for (const f of report.scanned) lines.push(`  - ${f}`);
    if (report.ok) {
        lines.push('result: PASS — no forbidden cloud/stealth/external-CDP claims in non-experimental sections');
    } else {
        lines.push(`result: FAIL — ${report.offending.length} offending hit(s)`);
        for (const o of report.offending) {
            lines.push(`  ${o.file}:${o.line}  [${o.term}]  section="${o.section}"  reason=${o.why}`);
        }
    }
    return lines.join('\n');
}
