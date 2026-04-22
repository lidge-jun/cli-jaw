import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCliEnvDefaults, buildSessionResumeKey } from '../../src/agent/spawn-env.ts';

test('enables Exa by default for opencode when unset', () => {
    assert.deepEqual(
        applyCliEnvDefaults('opencode', {}, {}),
        { OPENCODE_ENABLE_EXA: 'true' },
    );
});

test('preserves explicit opencode override', () => {
    assert.deepEqual(
        applyCliEnvDefaults('opencode', { OPENCODE_ENABLE_EXA: 'false' }, {}),
        { OPENCODE_ENABLE_EXA: 'false' },
    );
});

test('preserves inherited opencode env when already set', () => {
    assert.deepEqual(
        applyCliEnvDefaults('opencode', { OTHER_FLAG: '1' }, { OPENCODE_ENABLE_EXA: '1' }),
        { OTHER_FLAG: '1' },
    );
});

test('does not modify non-opencode env', () => {
    assert.deepEqual(
        applyCliEnvDefaults('claude', { OTHER_FLAG: '1' }, {}),
        { OTHER_FLAG: '1' },
    );
});

test('builds opencode resume key from effective Exa env', () => {
    assert.equal(buildSessionResumeKey('opencode', { OPENCODE_ENABLE_EXA: 'true' }), 'exa=1');
    assert.equal(buildSessionResumeKey('opencode', { OPENCODE_ENABLE_EXA: '1' }), 'exa=1');
    assert.equal(buildSessionResumeKey('opencode', { OPENCODE_ENABLE_EXA: 'false' }), 'exa=0');
    assert.equal(buildSessionResumeKey('claude', {}), null);
});
