import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Point JAW_HOME to a temp dir BEFORE importing mcp-sync
const testHome = join(tmpdir(), `cli-jaw-cooldown-test-${Date.now()}`);
fs.mkdirSync(testHome, { recursive: true });
process.env.CLI_JAW_HOME = testHome;

const { shouldSkipClone, writeCloneMeta, readCloneMeta, CLONE_META_PATH, CLONE_COOLDOWN_MS } =
    await import('../../lib/mcp-sync.ts');

const metaPath = join(testHome, '.skills_clone_meta.json');

test.afterEach(() => {
    try { fs.unlinkSync(metaPath); } catch { /* may not exist */ }
    delete process.env.JAW_FORCE_CLONE;
});

test.after(() => {
    fs.rmSync(testHome, { recursive: true, force: true });
    delete process.env.CLI_JAW_HOME;
});

test('CCD-001: shouldSkipClone() returns false when no meta file exists', () => {
    assert.equal(shouldSkipClone(), false);
});

test('CCD-002: shouldSkipClone() returns false after a successful clone', () => {
    writeCloneMeta(true);
    assert.equal(shouldSkipClone(), false);
});

test('CCD-003: shouldSkipClone() returns true within cooldown after a failed clone', () => {
    writeCloneMeta(false);
    assert.equal(shouldSkipClone(), true);
});

test('CCD-004: shouldSkipClone() returns false after cooldown expires', () => {
    // Write meta with a timestamp older than the cooldown window
    const expired: { lastAttempt: number; success: boolean } = {
        lastAttempt: Date.now() - CLONE_COOLDOWN_MS - 1000,
        success: false,
    };
    fs.writeFileSync(metaPath, JSON.stringify(expired));
    assert.equal(shouldSkipClone(), false);
});

test('CCD-005: writeCloneMeta() creates valid JSON at expected path', () => {
    writeCloneMeta(true);
    assert.equal(fs.existsSync(metaPath), true);
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.equal(parsed.success, true);
    assert.equal(typeof parsed.lastAttempt, 'number');
    assert.ok(parsed.lastAttempt <= Date.now());
});

test('CCD-006: corrupted meta file → shouldSkipClone() returns false', () => {
    fs.writeFileSync(metaPath, 'not json{{{');
    assert.equal(shouldSkipClone(), false);
});

test('CCD-007: JAW_FORCE_CLONE=1 bypasses cooldown even within window', () => {
    writeCloneMeta(false);
    assert.equal(shouldSkipClone(), true); // cooldown active
    process.env.JAW_FORCE_CLONE = '1';
    assert.equal(shouldSkipClone(), false); // forced bypass
});

test('CCD-008: semantically invalid meta (wrong types) → shouldSkipClone() returns false', () => {
    fs.writeFileSync(metaPath, JSON.stringify({ lastAttempt: 'not-a-number', success: 'yes' }));
    assert.equal(shouldSkipClone(), false);
    assert.equal(readCloneMeta(), null);
});

test('CCD-009: partial meta (missing fields) → shouldSkipClone() returns false', () => {
    fs.writeFileSync(metaPath, JSON.stringify({ lastAttempt: Date.now() }));
    assert.equal(shouldSkipClone(), false);
    assert.equal(readCloneMeta(), null);
});
