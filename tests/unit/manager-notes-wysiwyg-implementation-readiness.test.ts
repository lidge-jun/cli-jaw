import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const projectRoot = join(import.meta.dirname, '..', '..');

const requiredFiles = [
    'public/manager/src/notes/wysiwyg/wysiwyg-adapter-types.ts',
    'public/manager/src/notes/wysiwyg/markdown-roundtrip.ts',
    'public/manager/src/notes/wysiwyg/wysiwyg-fixtures.ts',
    'public/manager/src/notes/wysiwyg/wysiwyg-paste-policy.ts',
    'public/manager/src/notes/wysiwyg/wysiwyg-renderer-boundary.ts',
    'tests/unit/manager-notes-wysiwyg-adapter-contract.test.ts',
    'tests/unit/manager-notes-wysiwyg-dependency-gate.test.ts',
    'tests/unit/manager-notes-wysiwyg-fixture-contract.test.ts',
    'tests/unit/manager-notes-wysiwyg-no-ui-exposure-contract.test.ts',
    'tests/unit/manager-notes-wysiwyg-paste-security-contract.test.ts',
    'tests/unit/manager-notes-wysiwyg-renderer-boundary-contract.test.ts',
    'tests/unit/manager-notes-wysiwyg-roundtrip-normalization.test.ts',
];

test('23.0 implementation readiness gates exist', () => {
    for (const file of requiredFiles) {
        assert.equal(existsSync(join(projectRoot, file)), true, `${file} must exist before 23.1 can start`);
    }
});
