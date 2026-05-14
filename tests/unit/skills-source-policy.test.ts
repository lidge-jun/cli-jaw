import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import {
    isDiscoverableSkillDirName,
    isSkillSourceEntryName,
    shouldUpdateSkillDirectory,
    shouldUseLocalSkillsSource,
} from '../../lib/mcp/skills-utils.js';

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
    const previous = process.env[name];
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
    try {
        return fn();
    } finally {
        if (previous === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = previous;
        }
    }
}

function makeSkillDir(parent: string, name: string, content: string, mtime: Date): string {
    const dir = join(parent, name);
    fs.mkdirSync(dir, { recursive: true });
    const skillMd = join(dir, 'SKILL.md');
    fs.writeFileSync(skillMd, content);
    fs.utimesSync(skillMd, mtime, mtime);
    return dir;
}

test('skills policy excludes backup directories from discovery and source sync', () => {
    assert.equal(isDiscoverableSkillDirName('hwp'), true);
    assert.equal(isDiscoverableSkillDirName('hwp.bak'), false);
    assert.equal(isDiscoverableSkillDirName('.shadow'), false);

    assert.equal(isSkillSourceEntryName('hwp'), true);
    assert.equal(isSkillSourceEntryName('hwp.bak'), false);
    assert.equal(isSkillSourceEntryName('.git'), false);
});

test('skills policy supports local bundled source opt-in during postinstall/reset', () => {
    assert.equal(withEnv('JAW_SKILLS_SOURCE', undefined, shouldUseLocalSkillsSource), false);
    assert.equal(withEnv('JAW_SKILLS_SOURCE', 'local', shouldUseLocalSkillsSource), true);
    assert.equal(withEnv('JAW_SKILLS_SOURCE', 'bundled', shouldUseLocalSkillsSource), true);
    assert.equal(withEnv('JAW_SKILLS_SOURCE', 'package', shouldUseLocalSkillsSource), true);
    assert.equal(withEnv('JAW_SKILLS_SOURCE', 'remote', shouldUseLocalSkillsSource), false);
});

test('skills policy updates same-version skills when source SKILL.md is newer', () => {
    const root = fs.mkdtempSync(join(os.tmpdir(), 'jaw-skills-policy-'));
    try {
        const srcRoot = join(root, 'src');
        const dstRoot = join(root, 'dst');
        const oldTime = new Date('2026-01-01T00:00:00Z');
        const newTime = new Date('2026-01-02T00:00:00Z');
        makeSkillDir(srcRoot, 'hwp', 'source', newTime);
        makeSkillDir(dstRoot, 'hwp', 'dest', oldTime);

        assert.equal(
            shouldUpdateSkillDirectory('hwp', join(srcRoot, 'hwp'), join(dstRoot, 'hwp'), { skills: {} }, { skills: {} }),
            true,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('skills policy prefers semver promotion over timestamp state', () => {
    const root = fs.mkdtempSync(join(os.tmpdir(), 'jaw-skills-policy-'));
    try {
        const srcRoot = join(root, 'src');
        const dstRoot = join(root, 'dst');
        const oldTime = new Date('2026-01-01T00:00:00Z');
        const newTime = new Date('2026-01-02T00:00:00Z');
        makeSkillDir(srcRoot, 'hwp', 'source', oldTime);
        makeSkillDir(dstRoot, 'hwp', 'dest', newTime);

        assert.equal(
            shouldUpdateSkillDirectory(
                'hwp',
                join(srcRoot, 'hwp'),
                join(dstRoot, 'hwp'),
                { skills: { hwp: { version: '1.2.0' } } },
                { skills: { hwp: { version: '1.1.9' } } },
            ),
            true,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
