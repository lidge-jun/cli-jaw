/**
 * Redirects a server child's Slack traffic at a local fixture.
 *
 * Seam: src/slack/api.ts hardcodes SLACK_API_BASE and resolves a BARE fetch at
 * call time (options.fetchImpl || fetch), and initSlack constructs
 * SlackSocketClient without fetchImpl or socketFactory. So inside a spawned
 * server there is exactly one interception point — globalThis.fetch — and no
 * product change is needed to use it. Registered with
 * NODE_OPTIONS=--import <this file>, which bin/commands/serve.ts forwards to the
 * real server process because it spreads ...process.env.
 *
 * Two rewrites:
 *   1. the Slack Web API base -> JAW_TEST_SLACK_API_BASE (must end in '/', or
 *      'auth.test' concatenates into '.../apiauth.test');
 *   2. https on loopback -> http. src/slack/slack-file.ts REJECTS any
 *      upload_url whose protocol is not https:, so the fixture hands back an
 *      https loopback URL to satisfy that validation and the request is
 *      downgraded here. No TLS, no certificate, no product edit.
 *
 * Everything else is delegated untouched, so the server's own HTTP still works.
 */
const SLACK_BASE = 'https://slack.com/api/';
const fixture = process.env['JAW_TEST_SLACK_API_BASE'] ?? '';
const inner = globalThis.fetch;

function rewrite(url) {
    if (fixture && url.startsWith(SLACK_BASE)) return fixture + url.slice(SLACK_BASE.length);
    if (url.startsWith('https://127.0.0.1:')) return 'http://' + url.slice('https://'.length);
    return url;
}

globalThis.fetch = function patchedFetch(input, init) {
    if (typeof input === 'string') return inner(rewrite(input), init);
    if (input instanceof URL) return inner(rewrite(input.toString()), init);
    if (input && typeof input === 'object' && typeof input.url === 'string') {
        const target = rewrite(input.url);
        if (target !== input.url) return inner(new Request(target, input), init);
    }
    return inner(input, init);
};
