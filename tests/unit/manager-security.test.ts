import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assertRangeDoesNotContainPort,
    assertRangesDoNotOverlap,
    isAllowedProxyTarget,
    isExpectedHostHeader,
    parseHostHeader,
    toPortRange,
} from '../../src/manager/security.js';

const scanRange = toPortRange(3457, 50);
const previewRange = toPortRange(24602, 50);

test('proxy target allows loopback target inside configured range', () => {
    assert.equal(isAllowedProxyTarget('127.0.0.1', 3457, scanRange), true);
    assert.equal(isAllowedProxyTarget('localhost', 3506, scanRange), true);
});

test('proxy target rejects non-loopback or out-of-range targets', () => {
    assert.equal(isAllowedProxyTarget('169.254.169.254', 3457, scanRange), false);
    assert.equal(isAllowedProxyTarget('0.0.0.0', 3457, scanRange), false);
    assert.equal(isAllowedProxyTarget('example.com', 3457, scanRange), false);
    assert.equal(isAllowedProxyTarget('127.0.0.1', 3507, scanRange), false);
});

test('host header validator accepts exact preview origin and rejects foreign hosts', () => {
    assert.equal(isExpectedHostHeader('127.0.0.1:24602', { host: '127.0.0.1', port: 24602 }), true);
    assert.equal(isExpectedHostHeader('evil.test:24602', { host: '127.0.0.1', port: 24602 }), false);
    assert.equal(isExpectedHostHeader('127.0.0.1:24603', { host: '127.0.0.1', port: 24602 }), false);
});

test('host header parser rejects comma-separated host values', () => {
    assert.equal(parseHostHeader('127.0.0.1:24602, evil.test:24602'), null);
});

test('range validators reject preview overlap and manager port overlap', () => {
    assert.throws(() => assertRangesDoNotOverlap(toPortRange(3457, 50), toPortRange(3500, 50), 'scan and preview'), /overlap/);
    assert.throws(() => assertRangeDoesNotContainPort(previewRange, 24602, 'preview range'), /manager port/);
    assert.throws(() => assertRangeDoesNotContainPort(scanRange, 3457, 'scan range'), /manager port/);
});
