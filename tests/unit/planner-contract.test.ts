import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    PLANNER_RESULT_SCHEMA_VERSION,
    isValidCandidateAction,
} from '../../src/browser/web-ai/planner-contract';

describe('G01 planner-contract mirror', () => {
    it('result schema version is frozen at planner-result-v1', () => {
        assert.equal(PLANNER_RESULT_SCHEMA_VERSION, 'planner-result-v1');
    });

    it('isValidCandidateAction accepts all 8 kinds', () => {
        for (const kind of ['observe', 'click', 'type', 'press', 'scroll', 'wait', 'extract', 'finalize']) {
            assert.equal(isValidCandidateAction({ kind }), true, `expected ${kind} to validate`);
        }
    });

    it('isValidCandidateAction rejects unknown kinds and falsy input', () => {
        assert.equal(isValidCandidateAction({ kind: 'rm-rf' }), false);
        assert.equal(isValidCandidateAction(null), false);
        assert.equal(isValidCandidateAction(undefined), false);
        assert.equal(isValidCandidateAction({}), false);
    });
});
