// Multi-Instance Phase 3: jaw clone command 검증 (fixture-based, CI-safe)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const JAW = `node ${join(projectRoot, 'dist/bin/cli-jaw.js')}`;

function cleanup(dir: string) {
    rmSync(dir, { recursive: true, force: true });
}

/** Create a minimal fixture source that clone accepts */
function createFixtureSource(dir: string) {
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'prompts'), { recursive: true });
    mkdirSync(join(dir, 'skills'), { recursive: true });
    mkdirSync(join(dir, 'memory'), { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ workingDir: dir, cli: 'claude', permissions: 'auto' }, null, 4));
    writeFileSync(join(dir, 'mcp.json'), '{}');
    writeFileSync(join(dir, 'heartbeat.json'), '{"jobs":[]}');
    writeFileSync(join(dir, 'prompts', 'A-1.md'), '# Test Prompt');
    writeFileSync(join(dir, 'memory', 'MEMORY.md'), '# Test Memory');
}

test('P3-001: clone creates all required directories', () => {
    const source = '/tmp/test-clone-src-001';
    const target = '/tmp/test-clone-p3-001';
    cleanup(source); cleanup(target);
    createFixtureSource(source);
    try {
        execSync(`${JAW} clone ${target} --from ${source}`, { cwd: projectRoot, stdio: 'pipe' });
        for (const dir of ['prompts', 'skills', 'worklogs', 'uploads', 'memory', 'logs']) {
            assert.ok(existsSync(join(target, dir)), `${dir}/ should exist`);
        }
        assert.ok(existsSync(join(target, 'settings.json')), 'settings.json should exist');
    } finally {
        cleanup(source); cleanup(target);
    }
});

test('P3-002: clone sets workingDir to target path', () => {
    const source = '/tmp/test-clone-src-002';
    const target = '/tmp/test-clone-p3-002';
    cleanup(source); cleanup(target);
    createFixtureSource(source);
    try {
        execSync(`${JAW} clone ${target} --from ${source}`, { cwd: projectRoot, stdio: 'pipe' });
        const settings = JSON.parse(readFileSync(join(target, 'settings.json'), 'utf8'));
        assert.equal(settings.workingDir, target);
    } finally {
        cleanup(source); cleanup(target);
    }
});

test('P3-003: clone does NOT copy jaw.db from source', () => {
    const source = '/tmp/test-clone-src-003';
    const target = '/tmp/test-clone-p3-003';
    cleanup(source); cleanup(target);
    createFixtureSource(source);
    writeFileSync(join(source, 'jaw.db'), 'fake-db-data-should-not-be-copied');
    try {
        execSync(`${JAW} clone ${target} --from ${source}`, { cwd: projectRoot, stdio: 'pipe' });
        if (existsSync(join(target, 'jaw.db'))) {
            const content = readFileSync(join(target, 'jaw.db'), 'utf8');
            assert.notEqual(content, 'fake-db-data-should-not-be-copied', 'jaw.db should not be copied from source');
        }
        assert.ok(true);
    } finally {
        cleanup(source); cleanup(target);
    }
});

test('P3-004: clone --with-memory copies MEMORY.md', () => {
    const source = '/tmp/test-clone-src-004';
    const target = '/tmp/test-clone-p3-004';
    cleanup(source); cleanup(target);
    createFixtureSource(source);
    try {
        execSync(`${JAW} clone ${target} --from ${source} --with-memory`, { cwd: projectRoot, stdio: 'pipe' });
        assert.ok(existsSync(join(target, 'memory', 'MEMORY.md')), 'MEMORY.md should be copied');
        assert.equal(readFileSync(join(target, 'memory', 'MEMORY.md'), 'utf8'), '# Test Memory');
    } finally {
        cleanup(source); cleanup(target);
    }
});

test('P3-005: clone --link-ref creates symlink for skills_ref', () => {
    const source = '/tmp/test-clone-src-005';
    const target = '/tmp/test-clone-p3-005';
    cleanup(source); cleanup(target);
    createFixtureSource(source);
    mkdirSync(join(source, 'skills_ref'), { recursive: true });
    writeFileSync(join(source, 'skills_ref', 'test.md'), 'ref');
    try {
        execSync(`${JAW} clone ${target} --from ${source} --link-ref`, { cwd: projectRoot, stdio: 'pipe' });
        const refPath = join(target, 'skills_ref');
        assert.ok(existsSync(refPath), 'skills_ref should exist');
        assert.ok(lstatSync(refPath).isSymbolicLink(), 'skills_ref should be a symlink');
    } finally {
        cleanup(source); cleanup(target);
    }
});

test('P3-006: clone to non-empty dir fails', () => {
    const target = '/tmp/test-clone-p3-006';
    cleanup(target);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'blocker.txt'), 'exists');
    try {
        assert.throws(
            () => execSync(`${JAW} clone ${target}`, { cwd: projectRoot, stdio: 'pipe' }),
            { status: 1 },
        );
    } finally {
        cleanup(target);
    }
});

test('P3-007: clone from non-existent source fails', () => {
    const target = '/tmp/test-clone-p3-007';
    cleanup(target);
    try {
        assert.throws(
            () => execSync(`${JAW} clone ${target} --from /tmp/does-not-exist-xyz`, { cwd: projectRoot, stdio: 'pipe' }),
            { status: 1 },
        );
    } finally {
        cleanup(target);
    }
});

test('P3-008: clone from invalid source (no settings.json) fails', () => {
    const source = '/tmp/test-clone-src-008';
    const target = '/tmp/test-clone-p3-008';
    cleanup(source); cleanup(target);
    mkdirSync(source, { recursive: true });
    // No settings.json → not a valid cli-jaw instance
    try {
        assert.throws(
            () => execSync(`${JAW} clone ${target} --from ${source}`, { cwd: projectRoot, stdio: 'pipe' }),
            { status: 1 },
        );
    } finally {
        cleanup(source); cleanup(target);
    }
});
