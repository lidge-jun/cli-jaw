import test from 'node:test';
import assert from 'node:assert/strict';
import { clearNativeStartFailure, nativeStartFailure, recordNativeStartFailure, startFailureCode }
    from '../../src/agent/runtime/start-failure.ts';
import { NativeRunFailure } from '../../src/agent/native-runtime-run.ts';

const outcome = { status: 'error' as const, finalText: null, partialText: '' };
const wrap = (...errors: unknown[]) => new NativeRunFailure(outcome, new AggregateError(errors, 'run'));

test('finds the code a failed start raised, through the aggregate the host throws', () => {
    assert.equal(startFailureCode(wrap(new Error('acp_config_unsupported_model'))), 'acp_config_unsupported_model');
    assert.equal(startFailureCode(wrap(new Error('acp_config_ambiguous_effort'))), 'acp_config_ambiguous_effort');
    // A code with an appended detail contributes only its leading code.
    assert.equal(startFailureCode(wrap(new Error('cursor_acp_invalid_cwd: /home/someone/project'))), 'cursor_acp_invalid_cwd');
    // Nested causes are walked, which is how the ACP layer reports.
    assert.equal(startFailureCode(wrap(new Error('outer failure', { cause: new Error('acp_auth_method_unavailable') }))),
        'acp_auth_method_unavailable');
});

test('provider text and credentials cannot take the shape this store records', () => {
    for (const message of ['Request failed with sk-live-abcdef', 'ENOENT /Users/someone/.cursor/config',
        'CamelCase_error', 'model "claude-4.6-opus-high" is not available', 'Native runtime run failed', '']) {
        assert.equal(startFailureCode(wrap(new Error(message))), '', message);
    }
    // A silent walk records nothing rather than falling back to a raw message.
    recordNativeStartFailure('cursor', wrap(new Error('Request failed with sk-live-abcdef')));
    assert.equal(nativeStartFailure('cursor'), undefined);
});

test('a cyclic or deeply nested chain terminates instead of hanging the failure path', () => {
    const cyclic = new Error('outer');
    cyclic.cause = cyclic;
    assert.equal(startFailureCode(cyclic), '');
    let deep: Error = new Error('acp_config_unsupported_model');
    for (let i = 0; i < 64; i++) deep = new Error('outer', { cause: deep });
    assert.equal(startFailureCode(deep), '');
});

test('records the failed start per cli and retires it once a later start reaches its lease', () => {
    recordNativeStartFailure('cursor', wrap(new Error('acp_config_unsupported_model')), 1_700_000_000_000);
    recordNativeStartFailure('grok', wrap(new Error('acp_auth_method_unavailable')), 1_700_000_000_001);
    assert.deepEqual(nativeStartFailure('cursor'), { code: 'acp_config_unsupported_model', at: 1_700_000_000_000 });
    assert.deepEqual(nativeStartFailure('grok'), { code: 'acp_auth_method_unavailable', at: 1_700_000_000_001 });

    clearNativeStartFailure('cursor');
    assert.equal(nativeStartFailure('cursor'), undefined);
    assert.deepEqual(nativeStartFailure('grok'), { code: 'acp_auth_method_unavailable', at: 1_700_000_000_001 });
    clearNativeStartFailure('grok');
    assert.equal(nativeStartFailure('grok'), undefined);
    assert.equal(nativeStartFailure('claude'), undefined);
});
