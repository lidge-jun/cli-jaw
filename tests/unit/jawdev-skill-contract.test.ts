import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const devScaffoldingPath = join(root, 'skills_ref/dev-scaffolding/SKILL.md');
const devPath = join(root, 'skills_ref/dev/SKILL.md');
const devPabcdPath = join(root, 'skills_ref/dev-pabcd/SKILL.md');
const devlogAgentsPath = join(root, 'devlog/AGENTS.md');

const requiredDocs = [devScaffoldingPath, devPath, devPabcdPath, devlogAgentsPath];
const hasRequiredDocs = requiredDocs.every((path) => fs.existsSync(path));

function read(path: string): string {
    return fs.readFileSync(path, 'utf8');
}

test('JDS-001: dev-scaffolding documents numbered Jawdev phase filenames', { skip: !hasRequiredDocs && 'skills_ref/devlog submodules not checked out' }, () => {
    const skill = read(devScaffoldingPath);

    assert.match(skill, /Jawdev phase document naming is mandatory/);
    assert.match(skill, /00_overview\.md/);
    assert.match(skill, /01_phase1_<slug>\.md/);
    assert.match(skill, /02_phase2_<slug>\.md/);
    assert.match(skill, /Do not create new bare semantic phase files/);
    assert.match(skill, /PLAN\.md/);
    assert.match(skill, /DIFF_PLAN\.md/);
    assert.match(skill, /PHASES\.md/);
    assert.match(skill, /RCA\.md/);
    assert.match(skill, /scan sibling files and choose the next unused numeric prefix/);
});

test('JDS-002: common dev and PABCD skills propagate the Jawdev naming contract', { skip: !hasRequiredDocs && 'skills_ref/devlog submodules not checked out' }, () => {
    const dev = read(devPath);
    const devPabcd = read(devPabcdPath);

    assert.match(dev, /canonical numbered-prefix pattern/);
    assert.match(dev, /00_overview\.md/);
    assert.match(dev, /01_phase1_<slug>\.md/);
    assert.match(dev, /legacy bare-name files/);

    assert.match(devPabcd, /exact numbered Jawdev filenames/);
    assert.match(devPabcd, /Do not propose bare `PLAN\.md`/);
    assert.match(devPabcd, /numbered Jawdev filename convention/);
});

test('JDS-003: devlog local AGENTS file enforces phase document naming', { skip: !hasRequiredDocs && 'skills_ref/devlog submodules not checked out' }, () => {
    const devlogAgents = read(devlogAgentsPath);

    assert.match(devlogAgents, /## Phase Document Naming/);
    assert.match(devlogAgents, /00_overview\.md/);
    assert.match(devlogAgents, /01_phase1_<slug>\.md/);
    assert.match(devlogAgents, /Do not create new bare semantic files/);
    assert.match(devlogAgents, /pick the next unused numeric prefix/);
});

