import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readSrc(rel: string): string {
    return fs.readFileSync(join(__dirname, rel), 'utf8');
}

test('spawn.ts imports smoke-detector helpers', () => {
    const src = readSrc('../../src/agent/spawn.ts');
    assert.ok(src.includes("from './smoke-detector.js'"));
    assert.ok(src.includes('detectSmokeResponse'));
    assert.ok(src.includes('buildContinuationPrompt'));
});

test('spawn.ts standard and ACP exit handlers both run smoke detection before retry handling', () => {
    const src = readSrc('../../src/agent/spawn.ts');
    const stdExit = src.slice(src.indexOf("child.on('close'"));
    const acpExit = src.slice(src.indexOf("acp.on('exit'"));

    const stdSmokeIdx = stdExit.indexOf('detectSmokeResponse');
    const stdRetryIdx = stdExit.indexOf('429 delay retry');
    assert.ok(stdSmokeIdx > 0 && stdRetryIdx > 0 && stdSmokeIdx < stdRetryIdx);

    const acpSmokeIdx = acpExit.indexOf('detectSmokeResponse');
    const acpRetryIdx = acpExit.indexOf('429 delay retry');
    assert.ok(acpSmokeIdx > 0 && acpRetryIdx > 0 && acpSmokeIdx < acpRetryIdx);
});

test('spawn.ts smoke continuation keeps main-managed path and emits smoke event', () => {
    const src = readSrc('../../src/agent/spawn.ts');
    const smokeSection = src.slice(
        src.indexOf('_isSmokeContinuation: true'),
        src.indexOf('_isSmokeContinuation: true') + 320,
    );
    assert.ok(!smokeSection.includes('forceNew: true'));
    assert.ok(src.includes("'agent_smoke'"));
});

test('frontend and telegram consumers handle agent_smoke', () => {
    assert.ok(readSrc('../../public/js/ws.ts').includes('agent_smoke'));
    assert.ok(readSrc('../../src/telegram/bot.ts').includes('agent_smoke'));
});
