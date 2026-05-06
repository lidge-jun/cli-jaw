import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BROWSER_PRIMITIVES,
    listPrimitiveCommands,
    primitivesByCategory,
    auditPrimitiveCoverage,
    BROWSER_PRIMITIVE_SCHEMA_VERSION,
} from '../../src/browser/web-ai/action-breadth.js';

test('action-breadth: catalog is non-empty + frozen', () => {
    assert.ok(Array.isArray(BROWSER_PRIMITIVES));
    assert.ok(BROWSER_PRIMITIVES.length >= 18);
    assert.throws(() => { (BROWSER_PRIMITIVES as unknown as BrowserPrimitive[]).push({} as never); });
});

test('action-breadth: includes G03 form primitives', () => {
    const cmds = new Set(listPrimitiveCommands());
    for (const c of ['select', 'check', 'uncheck', 'upload', 'drag', 'scroll', 'wait-for']) {
        assert.ok(cmds.has(c), `missing primitive: ${c}`);
    }
});

test('action-breadth: every primitive has shape', () => {
    for (const p of BROWSER_PRIMITIVES) {
        assert.ok(p.command);
        assert.ok(p.category);
        assert.ok(p.description);
        assert.ok(Array.isArray(p.args));
    }
});

test('action-breadth: groups by category', () => {
    const groups = primitivesByCategory();
    assert.ok(groups.form && groups.form.length >= 4);
    assert.ok(groups.wait && groups.wait.length >= 4);
    assert.ok(groups.pointer && groups.pointer.length >= 2);
});

test('action-breadth: audit detects all wired', () => {
    const fakeSource = BROWSER_PRIMITIVES.map((p) => `case '${p.command}':\n`).join('');
    const r = auditPrimitiveCoverage(fakeSource);
    assert.equal(r.ok, true);
    assert.equal(r.missing.length, 0);
    assert.equal(r.found.length, BROWSER_PRIMITIVES.length);
});

test('action-breadth: audit reports missing', () => {
    const partial = BROWSER_PRIMITIVES.slice(0, 3).map((p) => `case '${p.command}':\n`).join('');
    const r = auditPrimitiveCoverage(partial);
    assert.equal(r.ok, false);
    assert.ok(r.missing.length >= 1);
});

test('action-breadth: schema version', () => {
    assert.equal(BROWSER_PRIMITIVE_SCHEMA_VERSION, 'browser-primitives-v1');
});

import type { BrowserPrimitive } from '../../src/browser/web-ai/action-breadth.js';
