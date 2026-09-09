import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync, unlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const launcher = fileURLToPath(new URL('../../scripts/service-artifact.mjs', import.meta.url));
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
type Manifest = { schemaVersion: number; version: string; entrypoint: string; files: Record<string, string> };
function fixture(t: TestContext) {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'cli-jaw-artifact-')));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const root = join(temp, 'release');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'dist', 'slack'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'service-artifact.mjs'), readFileSync(launcher));
    writeFileSync(join(root, 'dist', 'slack', 'semantic.mjs'), 'export const semantic = "semantic-proof";\n');
    writeFileSync(join(root, 'dist', 'cli.mjs'), 'import {semantic} from "./slack/semantic.mjs"; console.log(JSON.stringify({started:true,semantic,pid:process.pid,argv:process.argv,bin:process.env.CLI_JAW_BIN}));\n');
    const spec: Manifest = { schemaVersion: 1, version: '2.17.42', entrypoint: 'dist/cli.mjs', files: {} };
    for (const file of ['scripts/service-artifact.mjs', 'dist/cli.mjs', 'dist/slack/semantic.mjs']) spec.files[file] = hash(readFileSync(join(root, file)));
    let digest = '';
    function seal() { const body = JSON.stringify(spec); writeFileSync(join(root, 'artifact-manifest.json'), body); digest = hash(body); }
    seal();
    const run = (args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath,
        [join(root, 'scripts', 'service-artifact.mjs'), '--root', root, '--manifest-sha256', digest, ...args],
        { encoding: 'utf8', timeout: 10000, env: { ...process.env, ...extraEnv } });
    return { temp, root, spec, seal, run };
}
function denied(result: ReturnType<typeof spawnSync>, code?: string) {
    assert.equal(result.status, 1, String(result.stderr));
    assert.doesNotMatch(String(result.stdout), /"started":true/);
    assert.equal(JSON.parse(String(result.stderr)).ok, false);
    if (code) assert.equal(JSON.parse(String(result.stderr)).error, code);
}

test('check proves inventory without starting CLI; normal launch preserves PID and exact argv', t => {
    const f = fixture(t);
    const check = f.run(['--check']);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).files, 3);
    assert.doesNotMatch(check.stdout, /started/);
    const run = f.run(['--', '--home', '/fixture home', 'serve', '--port', '3457']);
    assert.equal(run.status, 0, run.stderr);
    const actual = JSON.parse(run.stdout);
    assert.equal(actual.pid, run.pid);
    assert.equal(actual.semantic, 'semantic-proof');
    assert.deepEqual(actual.argv.slice(1), [join(f.root, 'dist/cli.mjs'), '--home', '/fixture home', 'serve', '--port', '3457']);
    assert.equal(actual.bin, join(f.root, 'dist/cli.mjs'));
});

test('manifest drift cannot replace the externally anchored digest', t => {
    const f = fixture(t);
    writeFileSync(join(f.root, 'artifact-manifest.json'), JSON.stringify({ ...f.spec, version: '9.9.9' }));
    denied(f.run(), 'manifest_digest_mismatch');
});

for (const mode of ['missing', 'corrupt'] as const) test(`${mode} semantic dependency prevents CLI startup`, t => {
    const f = fixture(t), file = join(f.root, 'dist/slack/semantic.mjs');
    if (mode === 'missing') unlinkSync(file); else writeFileSync(file, 'export const semantic = "wrong";');
    denied(f.run(), mode === 'missing' ? 'missing_file' : 'file_digest_mismatch');
});

for (const path of ['../outside.mjs', '/absolute.mjs', 'dist/../cli.mjs', 'dist\\cli.mjs', 'C:/cli.mjs', 'dist//cli.mjs']) {
    test(`manifest rejects escaping/noncanonical path ${JSON.stringify(path)}`, t => {
        const f = fixture(t); f.spec.files[path] = '0'.repeat(64); f.seal(); denied(f.run(), 'invalid_inventory');
    });
}

test('unlisted files are rejected, including injected module resolution metadata', t => {
    const f = fixture(t); writeFileSync(join(f.root, 'package.json'), '{}'); denied(f.run(), 'unlisted_file');
});

test('file, directory, root and manifest symlinks are rejected', t => {
    const f = fixture(t), dependency = join(f.root, 'dist/slack/semantic.mjs');
    const outside = join(f.temp, 'outside.mjs'); writeFileSync(outside, readFileSync(dependency));
    unlinkSync(dependency); symlinkSync(outside, dependency); denied(f.run(), 'symlink_not_allowed');
    unlinkSync(dependency); writeFileSync(dependency, readFileSync(outside));
    symlinkSync(join(f.root, 'dist'), join(f.root, 'alias')); denied(f.run(), 'symlink_not_allowed'); unlinkSync(join(f.root, 'alias'));
    const manifest = join(f.root, 'artifact-manifest.json'), saved = join(f.temp, 'manifest');
    writeFileSync(saved, readFileSync(manifest)); unlinkSync(manifest); symlinkSync(saved, manifest);
    denied(f.run(), 'non_regular_or_oversized_file');
    unlinkSync(manifest); writeFileSync(manifest, readFileSync(saved));
    const rootAlias = join(f.temp, 'root-alias'); symlinkSync(f.root, rootAlias);
    const run = spawnSync(process.execPath, [launcher, '--root', rootAlias, '--manifest-sha256', hash(readFileSync(manifest)), '--check'], { encoding: 'utf8' });
    denied(run, 'invalid_release_root');
});

test('global jaw symlink replacement cannot redirect the dedicated release', t => {
    const f = fixture(t), bin = join(f.temp, 'bin'); mkdirSync(bin);
    const replacement = join(f.temp, 'global.mjs'); writeFileSync(replacement, 'throw new Error("global must not run");');
    const jaw = join(bin, 'jaw'); symlinkSync(join(f.root, 'dist/cli.mjs'), jaw);
    unlinkSync(jaw); symlinkSync(replacement, jaw);
    const result = f.run([], { PATH: bin, CLI_JAW_BIN: jaw });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).bin, join(f.root, 'dist/cli.mjs'));
});

test('entrypoint must be in the verified inventory', t => {
    const f = fixture(t); delete f.spec.files[f.spec.entrypoint]; f.seal(); denied(f.run(), 'invalid_inventory');
});

test('child jaw and cli-jaw commands select hashed local aliases ahead of replaced global executables',
    { skip: process.platform === 'win32' && 'POSIX executable aliases used by launchd packaging' }, t => {
    const f = fixture(t), localBin = join(f.root, 'dist/bin'), globalBin = join(f.temp, 'global-bin');
    mkdirSync(localBin); mkdirSync(globalBin);
    const source = `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';
if (process.argv[2] === '--probe') console.log(JSON.stringify({owner:'verified-local',argv:process.argv.slice(2),path:process.env.PATH}));
else {
 const results = ['jaw','cli-jaw'].map(name => {
  const child = spawnSync(name, ['--probe','argument with spaces'], {encoding:'utf8'});
  if (child.status !== 0) throw new Error('child executable failed');
  return JSON.parse(child.stdout);
 });
 console.log(JSON.stringify(results));
}\n`;
    writeFileSync(join(f.root, 'package.json'), '{"type":"module"}');
    f.spec.files['package.json'] = hash(readFileSync(join(f.root, 'package.json')));
    for (const name of ['cli-jaw.js', 'jaw', 'cli-jaw']) {
        const file = join(localBin, name);
        writeFileSync(file, source); chmodSync(file, 0o755);
        f.spec.files[`dist/bin/${name}`] = hash(readFileSync(file));
    }
    f.spec.entrypoint = 'dist/bin/cli-jaw.js';
    f.seal();
    for (const name of ['jaw', 'cli-jaw']) {
        const file = join(globalBin, name);
        writeFileSync(file, source); chmodSync(file, 0o755);
        // Simulate an npm upgrade changing the global executable after sealing.
        writeFileSync(file, `#!${process.execPath}\nconsole.log(JSON.stringify({owner:'replaced-global'}));\n`);
    }
    const inheritedPath = globalBin + delimiter + (process.env.PATH ?? '');
    const result = f.run([], { PATH: inheritedPath });
    assert.equal(result.status, 0, result.stderr);
    const children = JSON.parse(result.stdout);
    assert.equal(children.length, 2);
    for (const child of children) {
        assert.equal(child.owner, 'verified-local');
        assert.deepEqual(child.argv, ['--probe', 'argument with spaces']);
        assert.equal(child.path, localBin + delimiter + inheritedPath, 'prepend without erasing inherited tool lookup');
    }
});

const zshFiles = ['.zshenv', '.zprofile', '.zshrc', '.zlogin', '.zlogout'];
function packageZsh(f: ReturnType<typeof fixture>) {
    for (const name of zshFiles) {
        const relative = `scripts/service-shell/zsh/${name}`;
        mkdirSync(dirname(join(f.root, relative)), { recursive: true });
        writeFileSync(join(f.root, relative), readFileSync(join(dirname(launcher), 'service-shell/zsh', name)));
        f.spec.files[relative] = hash(readFileSync(join(f.root, relative)));
    }
    for (const name of ['jaw', 'cli-jaw']) {
        writeFileSync(join(f.root, 'dist', name), '#!/bin/sh\necho verified-local\n');
        chmodSync(join(f.root, 'dist', name), 0o755);
        f.spec.files[`dist/${name}`] = hash(readFileSync(join(f.root, 'dist', name)));
    }
    const command = 'command -v jaw; command -v cli-jaw; jaw; cli-jaw; print -r -- "${PROFILE_SENTINEL-}|${RC_SENTINEL-}|${ENV_SENTINEL-}|${LOGIN_SENTINEL-}"; /bin/zsh -lc "command -v jaw"';
    const cli = `import {spawnSync} from 'node:child_process';
const r=spawnSync('/bin/zsh',[process.argv[2],${JSON.stringify(command)}],{encoding:'utf8'});
if(r.status!==0) throw new Error(r.stderr);
console.log(JSON.stringify({lines:r.stdout.trim().split('\\n')}));\n`;
    writeFileSync(join(f.root, f.spec.entrypoint), cli);
    f.spec.files[f.spec.entrypoint] = hash(cli);
    f.seal();
}

for (const mode of ['-lc', '-lic']) test(`real zsh ${mode} forwards custom dotdir and repins local CLI after user PATH overrides`,
    { skip: process.platform !== 'darwin' }, t => {
    const f = fixture(t); packageZsh(f);
    const dotdir = join(f.temp, 'user dotdir'), home = join(f.temp, 'user home'), badBin = join(f.temp, 'global bin');
    mkdirSync(dotdir); mkdirSync(home); mkdirSync(badBin);
    for (const name of ['jaw', 'cli-jaw']) {
        writeFileSync(join(badBin, name), '#!/bin/sh\necho WRONG-global\n'); chmodSync(join(badBin, name), 0o755);
    }
    writeFileSync(join(dotdir, '.zshenv'), 'export ENV_SENTINEL=original-env\n');
    writeFileSync(join(dotdir, '.zprofile'), `export PROFILE_SENTINEL=original-profile\nexport PATH=${JSON.stringify(badBin)}:$PATH\n`);
    writeFileSync(join(dotdir, '.zshrc'), `export RC_SENTINEL=original-rc\nexport PATH=${JSON.stringify(badBin)}:$PATH\n`);
    writeFileSync(join(dotdir, '.zlogin'), `export LOGIN_SENTINEL=original-login\nexport PATH=${JSON.stringify(badBin)}:$PATH\n`);
    const logoutProof = join(home, 'logout-proof');
    writeFileSync(join(dotdir, '.zlogout'), `print -r -- original-logout >> ${JSON.stringify(logoutProof)}\n`);
    // An ordinary user shell still selects the user's global executable.
    const env = { HOME: home, ZDOTDIR: dotdir, PATH: badBin + delimiter + '/usr/bin:/bin' };
    const ordinary = spawnSync('/bin/zsh', [mode, 'command -v jaw'], { encoding: 'utf8', env: { ...process.env, ...env } });
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.equal(ordinary.stdout.trim(), join(badBin, 'jaw'));
    const run = f.run(['--', mode], env);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).lines, [join(f.root, 'dist/jaw'), join(f.root, 'dist/cli-jaw'),
        'verified-local', 'verified-local', `original-profile|${mode === '-lic' ? 'original-rc' : ''}|original-env|original-login`,
        join(f.root, 'dist/jaw')]);
    // Noninteractive zsh does not run .zlogout; preserve that native behavior.
    if (mode === '-lic') assert.match(readFileSync(logoutProof, 'utf8'), /original-logout/);
    else assert.equal(existsSync(logoutProof), false);
    const reentry = f.run(['--', mode], { ...env,
        ZDOTDIR: join(f.root, 'scripts/service-shell/zsh'),
        CLI_JAW_ZSH_SHIMS: join(f.root, 'scripts/service-shell/zsh'),
        CLI_JAW_USER_ZDOTDIR_SET: '1', CLI_JAW_USER_ZDOTDIR: dotdir,
    });
    assert.equal(reentry.status, 0, reentry.stderr);
    assert.deepEqual(JSON.parse(reentry.stdout).lines, JSON.parse(run.stdout).lines,
        'launcher reentry forwards original user files, never its own shim recursively');
});

test('unset ZDOTDIR forwards HOME and honors original zshenv directory reassignment',
    { skip: process.platform !== 'darwin' }, t => {
    const f = fixture(t); packageZsh(f);
    const home = join(f.temp, 'home'), next = join(f.temp, 'next'); mkdirSync(home); mkdirSync(next);
    writeFileSync(join(home, '.zshenv'), `export ENV_SENTINEL=home-env\nexport ZDOTDIR=${JSON.stringify(next)}\n`);
    writeFileSync(join(next, '.zprofile'), 'export PROFILE_SENTINEL=moved-profile\nexport PATH=/usr/bin:/bin\n');
    const run = f.run(['--', '-lc'], { HOME: home, ZDOTDIR: undefined });
    assert.equal(run.status, 0, run.stderr);
    const lines = JSON.parse(run.stdout).lines;
    assert.equal(lines[0], join(f.root, 'dist/jaw'));
    assert.equal(lines[4], 'moved-profile||home-env|');
    assert.equal(lines[5], join(f.root, 'dist/jaw'));
});

test('partial packaged zsh shim set fails before CLI import', t => {
    const f = fixture(t); packageZsh(f);
    const file = 'scripts/service-shell/zsh/.zlogin';
    unlinkSync(join(f.root, file)); delete f.spec.files[file]; f.seal();
    denied(f.run(), 'incomplete_shell_shims');
});

for (const args of [['--check', '--check'], ['--unknown'], ['--root', '--check']]) {
    test(`invalid launcher arguments fail before import: ${args.join(' ')}`, t => {
        denied(fixture(t).run(args), 'invalid_arguments');
    });
}

test('unknown manifest fields are rejected even under an updated anchor', t => {
    const f = fixture(t);
    Object.assign(f.spec, { extra: true }); f.seal();
    denied(f.run(), 'invalid_manifest');
});

test('import errors do not disclose exception text or private paths', t => {
    const f = fixture(t);
    const source = 'throw new Error("private-secret-and-path");';
    writeFileSync(join(f.root, f.spec.entrypoint), source);
    f.spec.files[f.spec.entrypoint] = hash(source); f.seal();
    const result = f.run(); denied(result, 'artifact_launch_failed');
    assert.doesNotMatch(result.stderr, /private-secret-and-path/);
    assert.equal(result.stderr.includes(f.root), false);
});

test('npm package allowlist ships the launcher and every hidden zsh forwarding file', t => {
    const f = fixture(t), project = dirname(dirname(launcher));
    const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
    packageZsh(f);
    writeFileSync(join(f.root, 'package.json'), JSON.stringify({ name: 'artifact-package-fixture', version: '1.0.0', files: pkg.files }));
    writeFileSync(join(f.root, '.npmignore'), readFileSync(join(project, '.npmignore')));
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--json'], {
        cwd: f.root, encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32',
        env: { ...process.env, npm_config_cache: join(f.temp, 'npm-cache'), npm_config_update_notifier: 'false' },
    });
    assert.equal(result.status, 0, result.stderr);
    const files = JSON.parse(result.stdout)[0].files.map((file: { path: string }) => file.path);
    for (const file of ['scripts/service-artifact.mjs', ...zshFiles.map(name => `scripts/service-shell/zsh/${name}`)]) {
        assert.ok(files.includes(file), `missing package asset: ${file}`);
    }
});
