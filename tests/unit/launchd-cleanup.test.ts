// P04C: legacy cli-jaw LaunchAgent detection
import test from 'node:test';
import assert from 'node:assert/strict';
import { findLegacyCliJawLabels } from '../../src/core/launchd-cleanup.js';

test('P04C-010: detects com.cli-jaw.local as legacy', () => {
    const files = ['com.cli-jaw.default.plist', 'com.cli-jaw.local.plist'];
    assert.deepEqual(
        findLegacyCliJawLabels(files, 'com.cli-jaw.default'),
        ['com.cli-jaw.local']
    );
});

test('P04C-011: detects cli-jaw-<port>-<hash> as legacy', () => {
    const files = [
        'com.cli-jaw.default.plist',
        'com.cli-jaw.cli-jaw-3458-7ff0583f.plist',
        'com.cli-jaw.cli-jaw-3459.plist',
    ];
    const result = findLegacyCliJawLabels(files, 'com.cli-jaw.default').sort();
    assert.deepEqual(result, [
        'com.cli-jaw.cli-jaw-3458-7ff0583f',
        'com.cli-jaw.cli-jaw-3459',
    ]);
});

test('P04C-012: preserves current label', () => {
    const files = ['com.cli-jaw.default.plist'];
    assert.deepEqual(findLegacyCliJawLabels(files, 'com.cli-jaw.default'), []);
});

test('P04C-013: ignores unrelated LaunchAgents', () => {
    const files = ['com.apple.dock.plist', 'com.google.keystone.plist'];
    assert.deepEqual(findLegacyCliJawLabels(files, 'com.cli-jaw.default'), []);
});

test('P04C-014: does not flag custom instance hash labels as legacy', () => {
    // custom JAW_HOME → com.cli-jaw.<base>-<hash> (예: work-a1b2c3d4)
    // legacy pattern은 cli-jaw-<port>-<hash> 전용이어야 함
    const files = ['com.cli-jaw.work-a1b2c3d4.plist'];
    assert.deepEqual(findLegacyCliJawLabels(files, 'com.cli-jaw.default'), []);
});

test('P04C-015: handles empty file list', () => {
    assert.deepEqual(findLegacyCliJawLabels([], 'com.cli-jaw.default'), []);
});
