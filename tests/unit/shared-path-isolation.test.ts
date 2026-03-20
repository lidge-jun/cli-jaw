/**
 * Shared Path Isolation Tests — Issue #58
 *
 * Ensures cli-jaw does not contaminate shared harness paths
 * (~/.agents, ~/.agent, ~/.claude) by default.
 *
 * Test types:
 *   - String-based (SPI-001..008, 010): policy regression guards on source files
 *   - Behavioral (SPI-009b, 011, 012): real function calls in isolated temp dirs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

const postinstallSrc = fs.readFileSync(join(projectRoot, 'bin/postinstall.ts'), 'utf8');
const serverSrc = fs.readFileSync(join(projectRoot, 'server.ts'), 'utf8');
const commandCtxSrc = fs.readFileSync(join(projectRoot, 'src/cli/command-context.ts'), 'utf8');
const mcpSyncSrc = fs.readFileSync(join(projectRoot, 'lib/mcp-sync.ts'), 'utf8');
const doctorSrc = fs.readFileSync(join(projectRoot, 'bin/commands/doctor.ts'), 'utf8');
const readmeSrc = fs.readFileSync(join(projectRoot, 'README.md'), 'utf8');

// ── SPI-001: postinstall is isolated by default ──

test('SPI-001: postinstall has CLI_JAW_MIGRATE_SHARED_PATHS guard', () => {
    assert.ok(
        postinstallSrc.includes('CLI_JAW_MIGRATE_SHARED_PATHS'),
        'postinstall must check CLI_JAW_MIGRATE_SHARED_PATHS env var',
    );
});

// ── SPI-002: postinstall migration env guard exists ──

test('SPI-002: postinstall migration is opt-in via env', () => {
    assert.ok(
        postinstallSrc.includes('CLI_JAW_MIGRATE_SHARED_PATHS'),
        'env guard for shared path migration',
    );
    assert.ok(
        postinstallSrc.includes('npm_config_jaw_migrate_shared_paths'),
        'npm config alias for shared path migration',
    );
});

// ── SPI-003: postinstall default log says migration skipped ──

test('SPI-003: postinstall logs shared path migration skipped message', () => {
    assert.ok(
        postinstallSrc.includes('shared path migration skipped'),
        'postinstall must log that shared migration was skipped by default',
    );
});

// ── SPI-004: server.ts uses ensureWorkingDirSkillsLinks ──

test('SPI-004: server.ts calls ensureWorkingDirSkillsLinks (not ensureSkillsSymlinks)', () => {
    assert.ok(
        serverSrc.includes('ensureWorkingDirSkillsLinks'),
        'server must use the working-dir-only helper',
    );
    assert.ok(
        !serverSrc.includes('ensureSkillsSymlinks'),
        'server must NOT use the old shared helper',
    );
});

// ── SPI-005: command-context.ts uses centralized reset helper ──

test('SPI-005: command-context.ts uses runSkillReset, not inline repair flow', () => {
    assert.ok(
        commandCtxSrc.includes('runSkillReset'),
        'resetSkills must use the centralized reset helper',
    );
    assert.ok(
        !commandCtxSrc.includes('ensureSkillsSymlinks'),
        'resetSkills must NOT use old shared helper',
    );
});

// ── SPI-005b: server startup keeps onConflict skip ──

test('SPI-005b: server startup uses onConflict skip by default', () => {
    const serverStartup = serverSrc.slice(serverSrc.indexOf('ensureWorkingDirSkillsLinks'));
    assert.ok(
        serverStartup.includes("onConflict: 'skip'") || serverStartup.includes('onConflict: \'skip\''),
        'server startup must use onConflict skip',
    );
});

// ── SPI-006: doctor has shared path contamination check ──

test('SPI-006: doctor.ts checks shared path contamination', () => {
    assert.ok(
        doctorSrc.includes('detectSharedPathContamination') || doctorSrc.includes('Shared path isolation'),
        'doctor must include shared path contamination check',
    );
});

// ── SPI-007: doctor does not treat ~/.agents/skills existence as healthy ──

test('SPI-007: doctor does not report symlinked as positive', () => {
    assert.ok(
        !doctorSrc.includes("(symlinked)"),
        'doctor must NOT show (symlinked) as a positive health signal',
    );
});

// ── SPI-008: README does not instruct removing shared harness paths ──

test('SPI-008: README does not instruct removing shared harness paths', () => {
    assert.ok(
        !readmeSrc.includes('rm -rf ~/.agents ~/.agent'),
        'README must not instruct removing shared harness paths',
    );
});

// ── SPI-009: working-dir helper does not create home shared links ──

test('SPI-009: mcp-sync exports ensureWorkingDirSkillsLinks (not shared home)', () => {
    assert.ok(
        mcpSyncSrc.includes('export function ensureWorkingDirSkillsLinks'),
        'ensureWorkingDirSkillsLinks must be exported',
    );
});

// ── SPI-010: shared helper is opt-in only ──

test('SPI-010: ensureSharedHomeSkillsLinks is exported as opt-in API', () => {
    assert.ok(
        mcpSyncSrc.includes('export function ensureSharedHomeSkillsLinks'),
        'ensureSharedHomeSkillsLinks must be exported for opt-in use',
    );
});

// ── SPI-009b (behavioral): ensureWorkingDirSkillsLinks does not touch homedir ──

test('SPI-009b: ensureWorkingDirSkillsLinks does not create home shared links', async () => {
    const { ensureWorkingDirSkillsLinks } = await import('../../lib/mcp-sync.js');

    const fakeHome = mkdtempSync(join(tmpdir(), 'jaw-home-'));
    const workDir = mkdtempSync(join(tmpdir(), 'jaw-wd-'));
    const fakeSkillsSource = join(fakeHome, '.cli-jaw', 'skills');
    mkdirSync(fakeSkillsSource, { recursive: true });

    try {
        ensureWorkingDirSkillsLinks(workDir, {
            includeClaude: true,
            _homedir: fakeHome,
            _jawHome: join(fakeHome, '.cli-jaw'),
        });

        // workingDir should have links
        assert.ok(existsSync(join(workDir, '.agents', 'skills')), 'workDir/.agents/skills should exist');
        // home shared paths must NOT be touched
        assert.ok(!existsSync(join(fakeHome, '.agents', 'skills')), 'home .agents/skills must not exist');
        assert.ok(!existsSync(join(fakeHome, '.agent', 'skills')), 'home .agent/skills must not exist');
        assert.ok(!existsSync(join(fakeHome, '.claude', 'skills')), 'home .claude/skills must not exist');
    } finally {
        rmSync(fakeHome, { recursive: true, force: true });
        rmSync(workDir, { recursive: true, force: true });
    }
});

// ── SPI-011 (behavioral): workingDir === homedir is skipped ──

test('SPI-011: ensureWorkingDirSkillsLinks skips when workingDir is homedir', async () => {
    const { ensureWorkingDirSkillsLinks } = await import('../../lib/mcp-sync.js');

    const fakeHome = mkdtempSync(join(tmpdir(), 'jaw-home-'));
    const fakeSkillsSource = join(fakeHome, '.cli-jaw', 'skills');
    mkdirSync(fakeSkillsSource, { recursive: true });

    try {
        const report = ensureWorkingDirSkillsLinks(fakeHome, {
            includeClaude: true,
            _homedir: fakeHome,
            _jawHome: join(fakeHome, '.cli-jaw'),
        });
        assert.ok(report.skipped === true, 'report.skipped must be true');
        assert.ok(report.reason?.includes('workingDir is homedir'), 'reason must mention homedir');
    } finally {
        rmSync(fakeHome, { recursive: true, force: true });
    }
});

// ── SPI-012 (behavioral): existing unmanaged repo-local .agents is not replaced ──

test('SPI-012: existing unmanaged repo-local .agents is not replaced', async () => {
    const { ensureWorkingDirSkillsLinks } = await import('../../lib/mcp-sync.js');

    const fakeHome = mkdtempSync(join(tmpdir(), 'jaw-home-'));
    const workDir = mkdtempSync(join(tmpdir(), 'jaw-wd-'));
    const fakeSkillsSource = join(fakeHome, '.cli-jaw', 'skills');
    mkdirSync(fakeSkillsSource, { recursive: true });

    // Pre-existing .agents/skills owned by another harness
    const existingAgents = join(workDir, '.agents', 'skills');
    mkdirSync(existingAgents, { recursive: true });
    writeFileSync(join(existingAgents, 'other-harness.txt'), 'do not touch');

    try {
        ensureWorkingDirSkillsLinks(workDir, {
            onConflict: 'skip',
            _homedir: fakeHome,
            _jawHome: join(fakeHome, '.cli-jaw'),
        });

        // Existing directory must be preserved
        assert.ok(
            existsSync(join(existingAgents, 'other-harness.txt')),
            'other harness file must be preserved',
        );
    } finally {
        rmSync(fakeHome, { recursive: true, force: true });
        rmSync(workDir, { recursive: true, force: true });
    }
});

// ── SPI-013 (behavioral): allowReplaceManaged updates stale cli-jaw symlink ──

test('SPI-013: allowReplaceManaged updates stale cli-jaw symlink', async () => {
    const { ensureWorkingDirSkillsLinks } = await import('../../lib/mcp-sync.js');

    const fakeHome = mkdtempSync(join(tmpdir(), 'jaw-home-'));
    const workDir = mkdtempSync(join(tmpdir(), 'jaw-wd-'));
    const jawHome = join(fakeHome, '.cli-jaw');
    const skillsSource = join(jawHome, 'skills');
    mkdirSync(skillsSource, { recursive: true });

    // Pre-existing stale symlink pointing to old cli-jaw path
    const staleTarget = join(jawHome, 'old-skills');
    mkdirSync(staleTarget, { recursive: true });
    const agentsSkills = join(workDir, '.agents', 'skills');
    mkdirSync(join(workDir, '.agents'), { recursive: true });
    symlinkSync(staleTarget, agentsSkills);

    try {
        const report = ensureWorkingDirSkillsLinks(workDir, {
            onConflict: 'skip',
            allowReplaceManaged: true,
            _homedir: fakeHome,
            _jawHome: jawHome,
        });

        // Stale managed symlink must be replaced, not skipped
        const agentsLink = report.links?.find((l: any) => l.name === 'wdAgents');
        assert.ok(agentsLink, 'wdAgents link must exist in report');
        assert.strictEqual(agentsLink.action, 'replace_symlink', 'stale managed symlink must be replaced');
        assert.ok(agentsLink.managed === true, 'link must be flagged as managed');

        // Verify symlink now points to current skills source
        const actual = readlinkSync(agentsSkills);
        assert.strictEqual(resolve(dirname(agentsSkills), actual), resolve(skillsSource),
            'symlink must point to current skills source');
    } finally {
        rmSync(fakeHome, { recursive: true, force: true });
        rmSync(workDir, { recursive: true, force: true });
    }
});

// ── SPI-013b (behavioral): allowReplaceManaged does NOT replace unmanaged stale symlink ──

test('SPI-013b: allowReplaceManaged skips unmanaged stale symlink', async () => {
    const { ensureWorkingDirSkillsLinks } = await import('../../lib/mcp-sync.js');

    const fakeHome = mkdtempSync(join(tmpdir(), 'jaw-home-'));
    const workDir = mkdtempSync(join(tmpdir(), 'jaw-wd-'));
    const jawHome = join(fakeHome, '.cli-jaw');
    const skillsSource = join(jawHome, 'skills');
    mkdirSync(skillsSource, { recursive: true });

    // Pre-existing symlink owned by ANOTHER harness (not cli-jaw)
    const otherHarnessTarget = join(fakeHome, 'other-harness', 'skills');
    mkdirSync(otherHarnessTarget, { recursive: true });
    const agentsSkills = join(workDir, '.agents', 'skills');
    mkdirSync(join(workDir, '.agents'), { recursive: true });
    symlinkSync(otherHarnessTarget, agentsSkills);

    try {
        const report = ensureWorkingDirSkillsLinks(workDir, {
            onConflict: 'skip',
            allowReplaceManaged: true,
            _homedir: fakeHome,
            _jawHome: jawHome,
        });

        // Unmanaged symlink must NOT be replaced even with allowReplaceManaged
        const agentsLink = report.links?.find((l: any) => l.name === 'wdAgents');
        assert.ok(agentsLink, 'wdAgents link must exist in report');
        assert.strictEqual(agentsLink.action, 'conflict_skip',
            'unmanaged stale symlink must be skipped, not replaced');

        // Verify original symlink is preserved
        const actual = readlinkSync(agentsSkills);
        assert.strictEqual(resolve(dirname(agentsSkills), actual), resolve(otherHarnessTarget),
            'original symlink target must be preserved');
    } finally {
        rmSync(fakeHome, { recursive: true, force: true });
        rmSync(workDir, { recursive: true, force: true });
    }
});

// ── SPI-015 (behavioral): reset repair backs up known legacy dir before relinking ──

test('SPI-015: reset repair backs up known legacy managed dir before relinking', async () => {
    const { repairManagedSkillLinksAfterReset } = await import('../../lib/mcp-sync.js');

    const fakeHome = mkdtempSync(join(tmpdir(), 'jaw-home-'));
    const jawHome = join(fakeHome, '.cli-jaw');
    const skillsSource = join(jawHome, 'skills');
    mkdirSync(skillsSource, { recursive: true });

    const legacyAgentsSkills = join(jawHome, '.agents', 'skills');
    mkdirSync(join(legacyAgentsSkills, 'legacy-skill'), { recursive: true });
    writeFileSync(join(legacyAgentsSkills, 'legacy-skill', 'SKILL.md'), '# stale\n');

    try {
        const report = repairManagedSkillLinksAfterReset(jawHome, {
            includeClaude: false,
            _homedir: fakeHome,
            _jawHome: jawHome,
        });

        assert.deepEqual(report.repairedPaths, [legacyAgentsSkills], 'legacy dir must be repaired');
        assert.ok(report.symlinks, 'symlink report must be returned for trusted target');
        const agentsLink = report.symlinks?.links?.find((l: any) => l.name === 'wdAgents');
        assert.ok(agentsLink, 'wdAgents link must exist in report');
        assert.ok(
            agentsLink.action === 'create' || agentsLink.action === 'replace_symlink',
            'reset repair must create or refresh the wdAgents symlink',
        );
        const actual = readlinkSync(legacyAgentsSkills);
        assert.strictEqual(resolve(dirname(legacyAgentsSkills), actual), resolve(skillsSource),
            'legacy directory must be replaced by a symlink to the current skills source');

        const backupDir = join(jawHome, 'backups', 'skills-conflicts');
        assert.ok(existsSync(backupDir), 'backup directory must exist after repair');
    } finally {
        rmSync(fakeHome, { recursive: true, force: true });
    }
});

// ── SPI-014 (behavioral): doctor repair cleans backup traces for convergence ──

test('SPI-014: backup traces without active symlinks report resolved, not contaminated', async () => {
    const { detectSharedPathContamination } = await import('../../lib/mcp-sync.js');

    const fakeHome = mkdtempSync(join(tmpdir(), 'jaw-home-'));
    const jawHome = join(fakeHome, '.cli-jaw');

    // Create fake backup trace (simulating previously resolved contamination)
    const backupDir = join(jawHome, 'backups', 'skills-conflicts');
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, 'old-backup.tar'), 'trace');

    try {
        const report = detectSharedPathContamination({
            _homedir: fakeHome,
            _jawHome: jawHome,
        });
        assert.strictEqual(report.status, 'resolved',
            'backup traces without active symlinks must be "resolved", not "contaminated"');
        assert.ok(report.backupTraces.length > 0, 'backupTraces must be populated');
    } finally {
        rmSync(fakeHome, { recursive: true, force: true });
    }
});
