import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { normalizeScope, postDispatchDiffCheck } from '../../src/workflows/scope-sandbox.ts';

function makeTempRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-scope-sandbox-'));
}

test('normalizeScope rejects sibling paths with the same prefix', () => {
    const base = makeTempRoot();
    const root = path.join(base, 'app');
    const sibling = path.join(base, 'app-evil');
    try {
        fs.mkdirSync(root, { recursive: true });
        fs.mkdirSync(sibling, { recursive: true });
        assert.throws(() => normalizeScope(root, '../app-evil'), /escapes project root/);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('normalizeScope accepts absolute child paths inside project root', () => {
    const root = makeTempRoot();
    try {
        const child = path.join(root, '.ab-compare', 'frontend-employee');
        fs.mkdirSync(child, { recursive: true });
        assert.equal(normalizeScope(root, child), child);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('normalizeScope rejects symlink scopes outside project root', () => {
    const base = makeTempRoot();
    const root = path.join(base, 'app');
    const outside = path.join(base, 'outside');
    const link = path.join(root, 'linked');
    try {
        fs.mkdirSync(root, { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        fs.symlinkSync(outside, link, 'dir');
        assert.throws(() => normalizeScope(root, 'linked'), /Realpath of scope is outside project root/);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('postDispatchDiffCheck reports untracked files outside allowed scope', () => {
    const root = makeTempRoot();
    try {
        execSync('git init --quiet', { cwd: root });
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src', 'inside.ts'), 'export const ok = true;\n');
        fs.writeFileSync(path.join(root, 'outside.ts'), 'export const bad = true;\n');

        const result = postDispatchDiffCheck(root, 'src');
        assert.equal(result.ok, false);
        assert.deepEqual(result.modifiedOutside, ['outside.ts']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('postDispatchDiffCheck can ignore protected files inside the explicit directory scope', () => {
    const root = makeTempRoot();
    try {
        execSync('git init --quiet', { cwd: root });
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src', '.env'), 'SECRET=1\n');
        fs.writeFileSync(path.join(root, 'outside.env'), 'NO=1\n');
        const blocked = postDispatchDiffCheck(root, 'src');
        assert.equal(blocked.ok, false);
        assert.ok(blocked.modifiedOutside.includes('src/.env'));
        const allowed = postDispatchDiffCheck(root, 'src', { allowProtectedPaths: true });
        assert.equal(allowed.ok, false);
        assert.deepEqual(allowed.modifiedOutside, ['outside.env']);
        assert.ok(!allowed.modifiedOutside.includes('src/.env'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
