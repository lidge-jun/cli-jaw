import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePublicEndpointCandidates, DIRECT_CONTENT_LABELS, YTDLP_LABELS } from '../../src/browser/adaptive-fetch/endpoint-resolvers.js';
import { normalizePublicEndpointResult, hasPublicEndpointNormalizer } from '../../src/browser/adaptive-fetch/public-endpoint-normalizers.js';

test('adaptive fetch resolves core public endpoint shapes', () => {
    assert.deepEqual(resolvePublicEndpointCandidates('https://example.com/article'), []);
    assert.match(resolvePublicEndpointCandidates('https://github.com/org/repo/blob/main/README.md')[0]?.url ?? '', /raw\.githubusercontent\.com\/org\/repo\/main\/README\.md/);
    assert.match(resolvePublicEndpointCandidates('https://news.ycombinator.com/item?id=123')[0]?.url ?? '', /item\/123\.json/);
    assert.match(resolvePublicEndpointCandidates('https://en.wikipedia.org/wiki/Agentic_AI')[0]?.url ?? '', /api\/rest_v1\/page\/summary/);
});

test('adaptive fetch resolves broader non-browser public endpoint shapes', () => {
    const cases = [
        ['https://bsky.app/profile/alice.example/post/3abc', 'bluesky-post-thread', 'public.api.bsky.app/xrpc/app.bsky.feed.getPostThread'],
        ['https://mastodon.social/@alice/111222333', 'mastodon-status-api', 'mastodon.social/api/v1/statuses/111222333'],
        ['https://stackoverflow.com/questions/123/title', 'stackexchange-question-api', 'api.stackexchange.com/2.3/questions/123'],
        ['https://dev.to/alice/my-post', 'devto-article-api', 'dev.to/api/articles/alice/my-post'],
        ['https://doi.org/10.1000/example.doi', 'crossref-work-api', 'api.crossref.org/works/10.1000%2Fexample.doi'],
        ['https://openlibrary.org/works/OL45883W/Foo', 'openlibrary-works-json', 'openlibrary.org/works/OL45883W.json'],
        ['https://web.archive.org/web/20200101000000/https://example.com/a', 'wayback-cdx-api', 'web.archive.org/cdx/search/cdx?url=https%3A%2F%2Fexample.com%2Fa'],
        ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube-oembed', 'youtube.com/oembed'],
        ['https://x.com/alice/status/123456789', 'x-twitter-oembed', 'publish.twitter.com/oembed'],
        ['https://www.v2ex.com/t/12345', 'v2ex-topic-api', 'v2ex.com/api/topics/show.json?id=12345'],
        ['https://lobste.rs/s/abc123/title', 'lobsters-story-json', 'lobste.rs/s/abc123/title.json'],
    ];
    for (const [input, label, urlPart] of cases) {
        const candidate = resolvePublicEndpointCandidates(input)[0];
        assert.equal(candidate?.label, label);
        assert.equal(candidate?.source, 'public_endpoint');
        assert.match(candidate?.url ?? '', new RegExp(urlPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('adaptive fetch preserves Wayback query strings and resolves registry/academic endpoints', () => {
    assert.match(
        resolvePublicEndpointCandidates('https://web.archive.org/web/20200101000000/https://example.com/a?b=c&d=e')[0]?.url ?? '',
        /url=https%3A%2F%2Fexample\.com%2Fa%3Fb%3Dc%26d%3De/,
    );
    assert.match(
        resolvePublicEndpointCandidates('https://web.archive.org/web/20200101000000/https://example.com/search?q=a%26b&x=1')[0]?.url ?? '',
        /url=https%3A%2F%2Fexample\.com%2Fsearch%3Fq%3Da%2526b%26x%3D1/,
    );
    assert.equal(resolvePublicEndpointCandidates('https://www.npmjs.com/package/lodash')[0]?.label, 'npm-registry-latest');
    assert.equal(resolvePublicEndpointCandidates('https://www.npmjs.com/package/lodash')[0]?.url, 'https://registry.npmjs.org/lodash/latest');
    assert.equal(resolvePublicEndpointCandidates('https://www.npmjs.com/package/lodash/v/4.17.21')[0]?.label, 'npm-registry-version');
    assert.equal(resolvePublicEndpointCandidates('https://www.npmjs.com/package/lodash/v/4.17.21')[0]?.url, 'https://registry.npmjs.org/lodash/4.17.21');
    assert.equal(resolvePublicEndpointCandidates('https://www.npmjs.com/package/@npmcli/arborist')[0]?.url, 'https://registry.npmjs.org/%40npmcli%2Farborist/latest');
    assert.equal(resolvePublicEndpointCandidates('https://www.npmjs.com/package/%40npmcli/arborist')[0]?.url, 'https://registry.npmjs.org/%40npmcli%2Farborist/latest');
    assert.equal(resolvePublicEndpointCandidates('https://www.npmjs.com/package/%40npmcli%2Farborist')[0]?.url, 'https://registry.npmjs.org/%40npmcli%2Farborist/latest');
    assert.equal(resolvePublicEndpointCandidates('https://pypi.org/project/requests/')[0]?.url, 'https://pypi.org/pypi/requests/json');
    assert.equal(resolvePublicEndpointCandidates('https://pypi.org/project/requests%2Dcache/')[0]?.url, 'https://pypi.org/pypi/requests-cache/json');
    assert.equal(resolvePublicEndpointCandidates('https://arxiv.org/abs/2402.03300')[0]?.url, 'https://export.arxiv.org/api/query?id_list=2402.03300');
});

test('adaptive fetch keeps reddit json immutable and adds both Hacker News APIs', () => {
    assert.match(resolvePublicEndpointCandidates('https://www.reddit.com/r/test/comments/abc/title/')[0]?.url ?? '', /\.json$/);
    assert.deepEqual(resolvePublicEndpointCandidates('https://www.reddit.com/r/test/comments/abc/title/.json'), []);
    assert.deepEqual(resolvePublicEndpointCandidates('https://news.ycombinator.com/item?id=123').map(candidate => candidate.label), [
        'hacker-news-item-api',
        'hacker-news-algolia-item-api',
    ]);
});

// #694: the Naver finance window was pinned to a fixed pair of calendar dates,
// so it would have started truncating the newest sessions once the calendar
// passed the hardcoded end.

const resolverRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

function yyyymmdd(year: number, month: number, day: number): string {
    return `${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function seoulYyyymmddAt(epochMs: number): string {
    const shifted = new Date(epochMs + SEOUL_OFFSET_MS);
    return yyyymmdd(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

function seoulTwoYearsBackAt(epochMs: number): string {
    const shifted = new Date(epochMs + SEOUL_OFFSET_MS);
    const rolled = Date.UTC(shifted.getUTCFullYear() - 2, shifted.getUTCMonth(), shifted.getUTCDate());
    return seoulYyyymmddAt(rolled - SEOUL_OFFSET_MS);
}

test('#694-E naver finance computes its window on the Seoul calendar', () => {
    // The resolver reads its own clock, so bracket the call: if a Seoul
    // midnight lands inside those microseconds, either answer is correct and
    // the test must not flake on it.
    const before = Date.now();
    const candidates = resolvePublicEndpointCandidates('https://finance.naver.com/item/main.naver?code=005930');
    const after = Date.now();

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.label, 'naver-finance-json');

    const params = new URL(candidates[0]!.url).searchParams;
    const startTime = params.get('startTime') ?? '';
    const endTime = params.get('endTime') ?? '';
    assert.match(startTime, /^\d{8}$/);
    assert.match(endTime, /^\d{8}$/);

    // The end runs a Seoul day ahead so no offset can cut the newest session.
    const ends = [seoulYyyymmddAt(before + DAY_MS), seoulYyyymmddAt(after + DAY_MS)];
    assert.ok(ends.includes(endTime), `endTime ${endTime} is not the Seoul day after now (${ends.join(' or ')})`);

    // Two Seoul years back, computed the same way the resolver computes it, so
    // a constant that merely has the right year cannot pass.
    const starts = [seoulTwoYearsBackAt(before), seoulTwoYearsBackAt(after)];
    assert.ok(starts.includes(startTime), `startTime ${startTime} is not two Seoul years back (${starts.join(' or ')})`);

    // And it must be a date that exists: a naive year subtraction produces a
    // 29 February in years that have none.
    const roundTrip = new Date(Date.UTC(
        Number(startTime.slice(0, 4)),
        Number(startTime.slice(4, 6)) - 1,
        Number(startTime.slice(6)),
    ));
    assert.equal(roundTrip.getUTCMonth() + 1, Number(startTime.slice(4, 6)), 'startTime must be a real calendar date');
    assert.equal(roundTrip.getUTCDate(), Number(startTime.slice(6)), 'startTime must be a real calendar date');
});

test('#694-F the resolver source carries no frozen calendar constant', () => {
    const source = readFileSync(join(resolverRoot, 'src/browser/adaptive-fetch/endpoint-resolvers.ts'), 'utf8');
    assert.equal(/startTime=\d/.test(source), false, 'the query must not carry a literal start date');
    assert.equal(/endTime=\d/.test(source), false, 'the query must not carry a literal end date');
    assert.match(source, /startTime=\$\{start\}/);
    assert.match(source, /endTime=\$\{end\}/);
});

// #694: "23 platforms supported" was only ever a claim. Four labels reached no
// normalizer at all, and three of those pointed at endpoints that do not
// answer. These make the claim answerable by a test.

const PLATFORM_URLS = [
    'https://github.com/org/repo',
    'https://github.com/org/repo/blob/main/README.md',
    'https://www.reddit.com/r/test/comments/abc/title/',
    'https://news.ycombinator.com/item?id=123',
    'https://en.wikipedia.org/wiki/Node.js',
    'https://www.npmjs.com/package/cli-jaw',
    'https://pypi.org/project/requests/',
    'https://arxiv.org/abs/2301.00001',
    'https://bsky.app/profile/alice.bsky.social',
    'https://bsky.app/profile/alice.bsky.social/post/abc123',
    'https://mastodon.social/@user/123456',
    'https://mastodon.social/@user',
    'https://stackoverflow.com/questions/1',
    'https://dev.to/author/some-article',
    'https://doi.org/10.1000/xyz123',
    'https://openlibrary.org/works/OL1W',
    'https://openlibrary.org/books/OL1M',
    'https://web.archive.org/web/20200101000000/https://example.com/',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://x.com/user/status/123',
    'https://www.v2ex.com/t/123',
    'https://lobste.rs/s/abc/title',
    'https://blog.naver.com/someone/12345',
    'https://n.news.naver.com/mnews/article/001/0014567890',
    'https://finance.naver.com/item/main.naver?code=005930',
];

test('#694b-A every label the resolver can emit is accounted for', () => {
    const seen = new Set<string>();
    for (const url of PLATFORM_URLS) {
        const candidates = resolvePublicEndpointCandidates(url);
        assert.ok(candidates.length > 0, `${url} resolved to no candidate at all`);
        for (const candidate of candidates) seen.add(candidate.label);
    }
    assert.ok(seen.size >= 20, `expected the resolver to cover at least 20 labels, saw ${seen.size}`);

    for (const label of seen) {
        const accounted = hasPublicEndpointNormalizer(label)
            || (DIRECT_CONTENT_LABELS as readonly string[]).includes(label)
            || (YTDLP_LABELS as readonly string[]).includes(label);
        assert.ok(
            accounted,
            `"${label}" is produced by the resolver but has no normalizer, is not declared direct content, and is not the yt-dlp label — it would fall through to raw text while looking supported`,
        );
    }
});

test('#694b-B the three unanswerable oEmbed endpoints are gone', () => {
    // Checked live on 2026-09-11: medium 403 (Cloudflare), substack 404 on both
    // substack.com and the publication host, linkedin 404.
    for (const url of [
        'https://medium.com/@user/test-post-abc123',
        'https://bot-eat-brain.substack.com/p/some-post',
        'https://www.linkedin.com/posts/someone-activity-123',
        'https://www.linkedin.com/pulse/some-article',
    ]) {
        const labels = resolvePublicEndpointCandidates(url).map(candidate => candidate.label);
        for (const dead of ['medium-oembed', 'substack-oembed', 'linkedin-oembed']) {
            assert.equal(labels.includes(dead), false, `${url} still synthesises ${dead}`);
        }
    }
});

test('#694b-C naver finance is normalized from its non-JSON array response', () => {
    // The live shape: a single-quoted header row and double-quoted data rows,
    // which JSON.parse refuses outright.
    const raw = [
        "[['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],",
        '["20240911", 65100, 65500, 64200, 64900, 35809707, 55.2],',
        '["20240912", 66000, 66600, 65200, 66300, 35884106, 55.11],',
        '["20240913", 65000, 65500, 64300, 64400, 25045135, 54.9]]',
    ].join('\n');
    assert.throws(() => JSON.parse(raw), 'the fixture must be the real non-JSON shape');

    const normalized = normalizePublicEndpointResult({
        ok: true,
        status: 200,
        finalUrl: 'https://api.finance.naver.com/siseJson.naver?symbol=005930',
        contentType: 'text/plain',
        text: raw,
        evidence: [],
        warnings: [],
    }, { label: 'naver-finance-json', source: 'public_endpoint' });

    assert.ok(normalized, 'naver-finance-json must normalize');
    assert.ok(normalized!.evidence.includes('public-endpoint:naver-finance-json'));
    assert.equal(normalized!.metadata['sessions'], 3);
    assert.equal(normalized!.metadata['latestDate'], '20240913');
    assert.equal(normalized!.metadata['latestClose'], 64400);
    assert.match(normalized!.text, /Close: 64400/);
});

test('#694b-D a garbled naver payload is refused rather than half-parsed', () => {
    for (const raw of ['', 'not an array', "[['날짜']]", '[]']) {
        const normalized = normalizePublicEndpointResult({
            ok: true, status: 200, finalUrl: 'https://api.finance.naver.com/siseJson.naver?symbol=005930',
            contentType: 'text/plain', text: raw, evidence: [], warnings: [],
        }, { label: 'naver-finance-json', source: 'public_endpoint' });
        assert.equal(normalized, null, `"${raw.slice(0, 20)}" must not normalize`);
    }
});
