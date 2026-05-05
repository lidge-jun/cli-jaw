import test from 'node:test';
import assert from 'node:assert/strict';
import { commandLineMatchesDurableRuntimeOwner } from '../../src/browser/runtime-orphans.js';
import type { BrowserRuntimeOwner } from '../../src/browser/runtime-owner.js';

const owner: BrowserRuntimeOwner = {
    ownership: 'jaw-owned',
    pid: 1234,
    port: 9240,
    userDataDir: '/tmp/jaw/browser-profile',
    startedAt: '2026-05-05T00:00:00.000Z',
    lastUsedAt: '2026-05-05T00:00:00.000Z',
    headless: true,
    idleTimeoutMs: 600000,
    autoCloseEnabled: true,
    verified: true,
};

test('BRO-001: durable orphan proof accepts only matching main Chrome command', () => {
    assert.equal(commandLineMatchesDurableRuntimeOwner(
        owner,
        'Google Chrome --remote-debugging-port=9240 --user-data-dir=/tmp/jaw/browser-profile --headless=new about:blank',
    ), true);
});

test('BRO-002: durable orphan proof rejects Chrome helper processes', () => {
    assert.equal(commandLineMatchesDurableRuntimeOwner(
        owner,
        'Google Chrome Helper --type=renderer --remote-debugging-port=9240 --user-data-dir=/tmp/jaw/browser-profile',
    ), false);
});

test('BRO-003: durable orphan proof rejects wrong port or profile', () => {
    assert.equal(commandLineMatchesDurableRuntimeOwner(
        owner,
        'Google Chrome --remote-debugging-port=9241 --user-data-dir=/tmp/jaw/browser-profile',
    ), false);
    assert.equal(commandLineMatchesDurableRuntimeOwner(
        owner,
        'Google Chrome --remote-debugging-port=9240 --user-data-dir=/tmp/other-profile',
    ), false);
});

test('BRO-004: durable orphan proof rejects prefix-only port and profile matches', () => {
    assert.equal(commandLineMatchesDurableRuntimeOwner(
        owner,
        'Google Chrome --remote-debugging-port=92401 --user-data-dir=/tmp/jaw/browser-profile',
    ), false);
    assert.equal(commandLineMatchesDurableRuntimeOwner(
        owner,
        'Google Chrome --remote-debugging-port=9240 --user-data-dir=/tmp/jaw/browser-profile-extra',
    ), false);
});
