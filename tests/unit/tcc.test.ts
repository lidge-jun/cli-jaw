// P04C: macOS TCC utilities (darwin-only, skip on other platforms)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTccAppleEventsGrants, getLaunchdProcessType }
    from '../../src/core/tcc.js';

const skip = process.platform !== 'darwin';

test('P04C-020: readTccAppleEventsGrants returns array', { skip }, () => {
    const grants = readTccAppleEventsGrants();
    assert.ok(Array.isArray(grants), 'expected array');
});

test('P04C-021: getLaunchdProcessType returns null for unknown label', { skip }, () => {
    const result = getLaunchdProcessType('com.nonexistent.label.' + Date.now());
    assert.equal(result, null);
});

test('P04C-024: readTccAppleEventsGrants entries have expected shape', { skip }, () => {
    const grants = readTccAppleEventsGrants();
    for (const g of grants) {
        assert.equal(typeof g.client, 'string');
        assert.equal(typeof g.clientType, 'number');
        assert.equal(typeof g.authValue, 'number');
        assert.equal(typeof g.authReason, 'number');
        assert.equal(g.service, 'kTCCServiceAppleEvents');
    }
});

test('P04C-025: non-darwin platforms return safely', () => {
    // This test runs on all platforms — sanity check that non-darwin doesn't crash
    if (process.platform === 'darwin') return;
    assert.deepEqual(readTccAppleEventsGrants(), []);
    assert.equal(getLaunchdProcessType('anything'), null);
});
