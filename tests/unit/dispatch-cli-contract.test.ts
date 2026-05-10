import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { unwrapEmployeeSummaries } from '../../bin/commands/dispatch-helpers.ts';

const projectRoot = join(import.meta.dirname, '../..');
const dispatchSrc = readFileSync(join(projectRoot, 'bin/commands/dispatch.ts'), 'utf8');

test('dispatch helper unwraps legacy employee arrays', () => {
    assert.deepEqual(
        unwrapEmployeeSummaries([{ id: '1', name: 'Frontend' }, { bad: true }]),
        [{ id: '1', name: 'Frontend' }],
    );
});

test('dispatch helper unwraps standard { ok, data } employee envelopes', () => {
    assert.deepEqual(
        unwrapEmployeeSummaries({ ok: true, data: [{ id: '2', name: 'Backend' }] }),
        [{ id: '2', name: 'Backend' }],
    );
});

test('dispatch helper returns an empty list for malformed employee payloads', () => {
    assert.deepEqual(unwrapEmployeeSummaries({ ok: true, data: { id: 'bad' } }), []);
    assert.deepEqual(unwrapEmployeeSummaries(null), []);
});

test('dispatch CLI only resolves agent id from /api/employees for worker-busy polling', () => {
    const nonOkIdx = dispatchSrc.indexOf('if (!res.ok)');
    assert.ok(nonOkIdx >= 0, 'dispatch.ts should handle non-ok dispatch responses');
    const nonOkBlock = dispatchSrc.slice(nonOkIdx, dispatchSrc.indexOf('printDispatchResult(agent, body)', nonOkIdx));

    const status409Idx = nonOkBlock.indexOf('if (res.status === 409)');
    const resolveIdx = nonOkBlock.indexOf('await resolveAgentId(agent)');
    assert.ok(status409Idx >= 0, 'non-ok path should branch on HTTP 409 before polling');
    assert.ok(resolveIdx > status409Idx, 'resolveAgentId should only run inside the 409 branch');
    assert.ok(
        dispatchSrc.includes('unwrapEmployeeSummaries(await res.json() as unknown)'),
        'resolveAgentId should unwrap /api/employees envelope safely',
    );
});
