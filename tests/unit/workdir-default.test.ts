// Multi-Instance Phase 1: workingDir default 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSettings, JAW_HOME } from '../../src/core/config.ts';

test('P1-001: createDefaultSettings().workingDir === JAW_HOME', () => {
    const defaults = createDefaultSettings();
    assert.equal(defaults.workingDir, JAW_HOME);
    assert.ok(defaults.workingDir.endsWith('.cli-jaw'));
});

test('P1-002: A2_DEFAULT prompt contains ~/.cli-jaw not ~/', async () => {
    const builder = await import('../../src/prompt/builder.ts');
    const a2 = (builder as any).A2_DEFAULT;
    assert.ok(a2.includes('~/.cli-jaw'), 'A2_DEFAULT should reference ~/.cli-jaw');
    assert.ok(!a2.includes('- ~/\n'), 'A2_DEFAULT should NOT have bare "- ~/"');
});
