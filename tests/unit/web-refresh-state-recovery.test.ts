import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wsPathTs = join(__dirname, '../../public/js/ws.ts');
const wsPathJs = join(__dirname, '../../public/js/ws.js');
const uiPathTs = join(__dirname, '../../public/js/ui.ts');
const uiPathJs = join(__dirname, '../../public/js/ui.js');
const wsPath = existsSync(wsPathTs) ? wsPathTs : wsPathJs;
const uiPath = existsSync(uiPathTs) ? uiPathTs : uiPathJs;
const hasWs = existsSync(wsPath);
const hasUi = existsSync(uiPath);

test('WRS-001: reconnect snapshot owns status instead of forced idle reset', { skip: !hasWs && 'public/js/ws source not found' }, () => {
    const wsSrc = readFileSync(wsPath, 'utf8');
    assert.ok(wsSrc.includes('refreshRuntimeSnapshot({ hydrateRun: true })'), 'ws reconnect should hydrate runtime snapshot');
    assert.ok(!wsSrc.includes("m.setStatus('idle');"), 'ws reconnect should not force idle before snapshot');
});

test('WRS-002: queue updates rehydrate queued overlay from snapshot', { skip: !hasWs && 'public/js/ws source not found' }, () => {
    const wsSrc = readFileSync(wsPath, 'utf8');
    const queueBlock = wsSrc.slice(wsSrc.indexOf("msg.type === 'queue_update'"), wsSrc.indexOf("msg.type === 'worklog_created'"));
    assert.ok(queueBlock.includes('refreshRuntimeSnapshot().catch'), 'queue updates should refresh snapshot state');
    assert.ok(queueBlock.includes('updateQueueBadge(msg.pending || 0)'), 'queue updates should still refresh badge count');
});

test('WRS-003: hydrateActiveRun keeps live process block expanded', { skip: !hasUi && 'public/js/ui source not found' }, () => {
    const uiSrc = readFileSync(uiPath, 'utf8');
    const start = uiSrc.indexOf('export function hydrateActiveRun');
    const end = uiSrc.indexOf('export function appendAgentText');
    const hydrateBlock = uiSrc.slice(start, end);
    assert.ok(hydrateBlock.includes('hydrateStreamRenderer'), 'hydrateActiveRun should seed stream renderer state');
    assert.ok(!hydrateBlock.includes('collapseBlock('), 'hydrateActiveRun should not collapse in-flight process blocks');
});

test('WRS-004: queued overlays are keyed by queued id to avoid duplicate bubbles', { skip: !hasUi && 'public/js/ui source not found' }, () => {
    const uiSrc = readFileSync(uiPath, 'utf8');
    assert.ok(uiSrc.includes('data-queued-id'), 'queued overlay markup should preserve queued ids');
    assert.ok(uiSrc.includes('data-queued-overlay="true"'), 'queued overlay cleanup should target only queued overlays');
});
