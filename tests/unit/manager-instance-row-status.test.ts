import assert from 'node:assert/strict';
import test from 'node:test';
import {
    comparePinnedThenPort,
    composeInstanceRowTitle,
    formatWorkingDurationLabel,
    resolveInstanceRowStatus,
} from '../../public/manager/src/components/instance-row-status.js';

test('resolveInstanceRowStatus prefers transitioning then working then health', () => {
    assert.equal(resolveInstanceRowStatus({ status: 'error' }, { busy: true, transitioning: 'restart' }), 'transitioning');
    assert.equal(resolveInstanceRowStatus({ status: 'timeout' }, { busy: true }), 'working');
    assert.equal(resolveInstanceRowStatus({ status: 'online' }, { busy: false }), 'online');
    assert.equal(resolveInstanceRowStatus({ status: 'offline' }), 'offline');
    assert.equal(resolveInstanceRowStatus({ status: 'timeout' }), 'attention');
    assert.equal(resolveInstanceRowStatus({ status: 'error' }), 'attention');
    assert.equal(resolveInstanceRowStatus({ status: 'unknown' }), 'attention');
});

test('formatWorkingDurationLabel matches t3 Sidebar.logic L723-728', () => {
    assert.equal(formatWorkingDurationLabel(0), '0s');
    assert.equal(formatWorkingDurationLabel(42_000), '42s');
    assert.equal(formatWorkingDurationLabel(5 * 60_000), '5m');
    assert.equal(formatWorkingDurationLabel(90 * 60_000), '1h 30m');
    assert.equal(formatWorkingDurationLabel(-5_000), '0s');
    assert.equal(formatWorkingDurationLabel(Number.NaN), '0s');
});

test('composeInstanceRowTitle is native tooltip copy', () => {
    assert.equal(
        composeInstanceRowTitle({ port: 3457, homeDisplay: '~/.cli-jaw', currentCli: 'pi', currentModel: 'opus', version: '2.17.30' }),
        ':3457 · ~/.cli-jaw · pi · opus · v2.17.30',
    );
});

test('comparePinnedThenPort is favorite then ascending port', () => {
    const pinnedHighPort = { favorite: true, label: 'zulu', port: 3499 };
    const plainLowPort = { favorite: false, label: 'aaa', port: 3457 };
    assert.ok(comparePinnedThenPort(pinnedHighPort, plainLowPort) < 0);
    assert.ok(comparePinnedThenPort({ favorite: true, port: 3457 }, { favorite: true, port: 3499 }) < 0);
});

test('a custom label never moves an instance out of port order', () => {
    const rows = [
        { favorite: false, label: null, port: 3470 },
        { favorite: false, label: '내 작업방', port: 3457 },
        { favorite: false, label: 'zulu', port: 3462 },
        { favorite: false, label: null, port: 3468 },
    ];
    assert.deepEqual(
        [...rows].sort(comparePinnedThenPort).map(row => row.port),
        [3457, 3462, 3468, 3470],
    );
});

test('label string ordering does not survive digit-length changes', () => {
    const rows = [
        { favorite: false, label: 'cli-jaw 34570', port: 34570 },
        { favorite: false, label: 'cli-jaw 3458', port: 3458 },
    ];
    assert.deepEqual([...rows].sort(comparePinnedThenPort).map(row => row.port), [3458, 34570]);
});
