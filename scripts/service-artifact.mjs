#!/usr/bin/env node
// Local release launcher. No package imports: verification runs before the CLI.
// node scripts/service-artifact.mjs --root /absolute/release --manifest-sha256 HEX [--check] -- [CLI args]
// artifact-manifest.json: {schemaVersion:1,version:"2.17.42",entrypoint:"dist/bin/cli-jaw.js",files:{"relative/file":"sha256"}}
// The inventory covers every regular file, including this launcher, except the
// manifest itself. Package a runtime tree without symlinks (including .bin links).
// The digest is anchored outside the release, e.g. in launchd ProgramArguments.
// This detects drift, not a malicious owner changing both launcher and anchor.
// Keep releases immutable during verification/import; this is not a JS sandbox.
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MANIFEST = 'artifact-manifest.json';
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 100_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const ZSH_FILES = ['.zshenv', '.zprofile', '.zshrc', '.zlogin', '.zlogout'];
const ZSH_DIR = 'scripts/service-shell/zsh';
const fail = code => { throw new Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));

function relativePath(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 4096
        && !/[\\:\p{Cc}\p{Cf}]/u.test(value)
        && value.split('/').every(part => part && part !== '.' && part !== '..' && part === part.trim());
}

function argumentsOf(args) {
    const result = { check: false, cliArgs: [] };
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        if (flag === '--') { result.cliArgs = args.slice(i + 1); break; }
        if (!['--root', '--manifest-sha256', '--check'].includes(flag) || seen.has(flag)) fail('invalid_arguments');
        seen.add(flag);
        if (flag === '--check') result.check = true;
        else {
            const value = args[++i];
            if (!value || value.startsWith('--')) fail('invalid_arguments');
            result[flag === '--root' ? 'root' : 'digest'] = value;
        }
    }
    if (!result.root || !isAbsolute(result.root) || !SHA256.test(result.digest ?? '')) fail('invalid_arguments');
    return result;
}

async function readRegular(file, limit, collect = false) {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > limit) fail('non_regular_or_oversized_file');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) fail('file_changed');
        const hash = createHash('sha256'), chunks = [];
        const buffer = Buffer.alloc(64 * 1024);
        let bytes = 0;
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            bytes += bytesRead;
            if (bytes > limit) fail('oversized_file');
            hash.update(buffer.subarray(0, bytesRead));
            if (collect) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
        }
        const after = await handle.stat();
        if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
            || after.ctimeMs !== before.ctimeMs) fail('file_changed');
        return { digest: hash.digest('hex'), bytes, ...(collect ? { data: Buffer.concat(chunks) } : {}) };
    } finally { await handle.close(); }
}

async function verify(options) {
    const root = resolve(options.root);
    if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) fail('invalid_release_root');
    const manifest = await readRegular(join(root, MANIFEST), MAX_MANIFEST_BYTES, true);
    if (manifest.digest !== options.digest) fail('manifest_digest_mismatch');
    let spec;
    try { spec = JSON.parse(manifest.data.toString('utf8')); } catch { fail('invalid_manifest_json'); }
    if (!exactKeys(spec, ['schemaVersion', 'version', 'entrypoint', 'files']) || spec.schemaVersion !== 1
        || typeof spec.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$/.test(spec.version)
        || !relativePath(spec.entrypoint) || !/\.(?:mjs|js)$/.test(spec.entrypoint) || !record(spec.files)) fail('invalid_manifest');
    const entries = Object.entries(spec.files);
    if (!entries.length || entries.length > MAX_FILES || !Object.hasOwn(spec.files, spec.entrypoint)) fail('invalid_inventory');
    for (const [file, digest] of entries) {
        if (!relativePath(file) || file === MANIFEST || typeof digest !== 'string' || !SHA256.test(digest)) fail('invalid_inventory');
    }
    const seen = new Set();
    const dirs = [''];
    let directoryCount = 0, bytes = 0;
    while (dirs.length) {
        const relative = dirs.pop();
        if (++directoryCount > MAX_FILES) fail('inventory_limit');
        for (const name of await readdir(join(root, relative))) {
            const file = relative ? `${relative}/${name}` : name;
            if (!relativePath(file)) fail('unsafe_path');
            const full = join(root, file), stat = await lstat(full);
            if (stat.isSymbolicLink()) fail('symlink_not_allowed');
            if (stat.isDirectory()) { dirs.push(file); continue; }
            if (!stat.isFile()) fail('non_regular_file');
            if (file === MANIFEST) continue;
            if (!Object.hasOwn(spec.files, file)) fail('unlisted_file');
            const verified = await readRegular(full, MAX_FILE_BYTES);
            if (verified.digest !== spec.files[file]) fail('file_digest_mismatch');
            seen.add(file); bytes += verified.bytes;
        }
    }
    if (seen.size !== entries.length) fail('missing_file');
    const zshCount = ZSH_FILES.filter(name => seen.has(`${ZSH_DIR}/${name}`)).length;
    if (zshCount && zshCount !== ZSH_FILES.length) fail('incomplete_shell_shims');
    return { root, spec, receipt: { ok: true, schemaVersion: 1, version: spec.version,
        manifestSha256: manifest.digest, entrypoint: spec.entrypoint, files: seen.size, bytes } };
}

try {
    const options = argumentsOf(process.argv.slice(2));
    const { root, spec, receipt } = await verify(options);
    if (options.check) console.log(JSON.stringify(receipt));
    else {
        const entry = join(root, spec.entrypoint);
        process.argv = [process.execPath, entry, ...options.cliArgs];
        process.env.CLI_JAW_BIN = entry;
        // Packaging supplies hashed, regular-file jaw/cli-jaw aliases beside the
        // entrypoint. Child tools must resolve those before npm's mutable bin.
        const inheritedPath = process.env.PATH;
        process.env.PATH = dirname(entry) + (inheritedPath ? delimiter + inheritedPath : '');
        if (ZSH_FILES.every(name => Object.hasOwn(spec.files, `${ZSH_DIR}/${name}`))) {
            // Forward the caller's ZDOTDIR, including unset versus explicitly empty.
            // On launcher reentry retain the original user directory, not our shim.
            const reentry = process.env.CLI_JAW_ZSH_SHIMS
                && process.env.ZDOTDIR === process.env.CLI_JAW_ZSH_SHIMS
                && ['0', '1'].includes(process.env.CLI_JAW_USER_ZDOTDIR_SET ?? '');
            if (!reentry) {
                process.env.CLI_JAW_USER_ZDOTDIR_SET = Object.hasOwn(process.env, 'ZDOTDIR') ? '1' : '0';
                process.env.CLI_JAW_USER_ZDOTDIR = process.env.ZDOTDIR ?? '';
            }
            process.env.CLI_JAW_VERIFIED_BIN = dirname(entry);
            process.env.CLI_JAW_ZSH_SHIMS = join(root, ZSH_DIR);
            process.env.ZDOTDIR = process.env.CLI_JAW_ZSH_SHIMS;
        }
        await import(pathToFileURL(entry).href);
    }
} catch (error) {
    // Do not serialize paths, imported exception text or environment values.
    const known = new Set(['invalid_arguments', 'non_regular_or_oversized_file', 'file_changed', 'oversized_file',
        'invalid_release_root', 'manifest_digest_mismatch', 'invalid_manifest_json', 'invalid_manifest',
        'invalid_inventory', 'inventory_limit', 'unsafe_path', 'symlink_not_allowed', 'non_regular_file',
        'unlisted_file', 'file_digest_mismatch', 'missing_file', 'incomplete_shell_shims']);
    const code = known.has(error?.message) ? error.message : error?.code === 'ENOENT' ? 'missing_file' : 'artifact_launch_failed';
    console.error(JSON.stringify({ ok: false, error: code }));
    process.exitCode = 1;
}
