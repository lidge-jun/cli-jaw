import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadLocales } from '../../src/core/i18n.ts';
import { statusFromToolEvent, truncateStatus, sanitizeProgressDetail } from '../../src/slack/progress.ts';
loadLocales(fileURLToPath(new URL('../../public/locales', import.meta.url)));

test('legacy truncation helper remains bounded and single-line', () => {
    assert.equal(truncateStatus('  a\n\n b  '), 'a b');
    assert.equal(truncateStatus('x'.repeat(200)).length, 140);
});

test('tool summary uses a fixed category, never raw label/detail or fallback', () => {
    const safe = statusFromToolEvent({ label: 'Read', detail: 'src/private.ts', stepRef: 'private-ref' }, 'secret fallback');
    assert.ok(safe);
    assert.doesNotMatch(safe, /private|src|secret|Read/);
    assert.equal(statusFromToolEvent({ label: 'Read', detail: 'other command' }, 'different'), safe);
    for (const label of ['curl -H secret', '/private/path', '<!channel>', 'xoxb-private']) {
        const output = statusFromToolEvent({ label }, 'private fallback') ?? '';
        assert.ok(!output.includes(label));
        assert.ok(!output.includes('private'));
    }
    assert.equal(statusFromToolEvent({}, 'Working'), null);
    assert.equal(statusFromToolEvent({ label: 'Read', toolType: 'thinking' }, ''), null);
    assert.equal(statusFromToolEvent({ label: 'Read', icon: '💬' }, ''), null);
});

test('raw detail is not an external display authority, including relative paths and ordinary filenames', () => {
    for (const value of ['src/app.ts', 'README.md', 'a|b', 'chat.postMessage', 'curl -H x', 'private query']) {
        assert.equal(sanitizeProgressDetail(value), '');
    }
});
