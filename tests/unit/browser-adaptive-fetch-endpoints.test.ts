import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicEndpointCandidates } from '../../src/browser/adaptive-fetch/endpoint-resolvers.js';

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
