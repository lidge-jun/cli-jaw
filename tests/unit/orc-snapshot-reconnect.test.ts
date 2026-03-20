// Orchestrator snapshot reconnect — Phase 9 (source-shape, no browser import)
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wsPath = join(__dirname, '../../public/js/ws.js');
const hasWs = existsSync(wsPath);

test('OSR-001: ws.js exports hydrateAgentPhases function', { skip: !hasWs && 'public/js/ws.js not found (frontend not built)' }, () => {
    const wsSrc = readFileSync(wsPath, 'utf8');
    assert.ok(wsSrc.includes('hydrateAgentPhases'),
        'ws.js should define hydrateAgentPhases');
});

test('OSR-002: hydrateAgentPhases handles phase and phaseLabel fields', { skip: !hasWs && 'public/js/ws.js not found' }, () => {
    const wsSrc = readFileSync(wsPath, 'utf8');
    assert.ok(wsSrc.includes('phase') && wsSrc.includes('phaseLabel'),
        'hydrateAgentPhases should reference phase and phaseLabel');
});
