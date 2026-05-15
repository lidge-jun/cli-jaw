import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSensitiveQueryParams, isPrivateHostname, redactTraceValue, validateFetchUrl, validateThirdPartyReaderTarget } from '../../src/browser/adaptive-fetch/safety.js';

test('adaptive fetch rejects private and special-use hosts by default', () => {
    const hosts = [
        'localhost',
        '127.0.0.1',
        '10.0.0.1',
        '172.16.0.1',
        '192.168.0.1',
        '169.254.1.1',
        '100.64.0.1',
        '[::1]',
        '[fc00::1]',
        '[fe80::1]',
        '[2001:db8::1]',
        '[2001:2::1]',
        '[64:ff9b:1::1]',
    ];
    for (const host of hosts) {
        assert.equal(isPrivateHostname(host), true, `${host} should be private/special-use`);
        assert.throws(() => validateFetchUrl(`http://${host}/`), /private or local host/);
    }
});

test('adaptive fetch accepts public http/https URLs without credentials', () => {
    assert.equal(validateFetchUrl('https://example.com/article').href, 'https://example.com/article');
    assert.throws(() => validateFetchUrl('file:///tmp/a'), /unsupported URL scheme/);
    assert.throws(() => validateFetchUrl('https://user:pass@example.com'), /credential-bearing URLs/);
});

test('third-party reader blocks sensitive query material and trace redacts it', () => {
    const sensitive = 'https://example.com/article?token=abc&client_secret=def&normal=ok';
    assert.equal(hasSensitiveQueryParams(sensitive), true);
    assert.throws(() => validateThirdPartyReaderTarget(sensitive), /sensitive query/);
    const redacted = redactTraceValue(sensitive);
    assert.equal(String(redacted).includes('abc'), false);
    assert.equal(String(redacted).includes('def'), false);
    assert.match(String(redacted), /normal=ok/);
});
