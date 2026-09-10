import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    isRetiredCliSelection,
    RETIRED_CLI_SELECTIONS,
    RETIRED_RUNTIME_DIAGNOSTIC,
    retiredRuntimeDiagnostic,
    retiredRuntimeLabel,
} from '../../src/types/cli-engine.ts';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/types/cli-engine.ts'), 'utf8');

test('retiredRuntimeDiagnostic keeps the jwc literal and names the other engines', () => {
    assert.equal(RETIRED_RUNTIME_DIAGNOSTIC, 'retired_runtime:jwc');
    assert.equal(retiredRuntimeDiagnostic('jwc'), RETIRED_RUNTIME_DIAGNOSTIC);
    assert.equal(retiredRuntimeDiagnostic('jwc'), 'retired_runtime:jwc');
    assert.equal(retiredRuntimeDiagnostic('claude-e'), 'retired_runtime:claude-e');
    assert.equal(retiredRuntimeDiagnostic('ai-e'), 'retired_runtime:ai-e');
    assert.equal(retiredRuntimeLabel('jwc'), 'JWC (retired)');
    assert.equal(retiredRuntimeLabel('claude-e'), 'Claude E (retired)');
    assert.equal(retiredRuntimeLabel('ai-e'), 'AI-E (retired)');
    assert.equal(isRetiredCliSelection('jwc'), true);
    assert.equal(isRetiredCliSelection('claude-e'), true);
    assert.equal(isRetiredCliSelection('ai-e'), true);
    assert.equal(isRetiredCliSelection('claude'), false);
    assert.deepEqual([...RETIRED_CLI_SELECTIONS], ['ai-e', 'claude-e', 'jwc']);
    assert.match(src, /export const RETIRED_RUNTIME_DIAGNOSTIC = 'retired_runtime:jwc' as const;/);
    assert.doesNotMatch(src, /export const RETIRED_RUNTIME_DIAGNOSTIC = retiredRuntimeDiagnostic\(/);
});
