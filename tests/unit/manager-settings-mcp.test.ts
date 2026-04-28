// Phase 8 — MCP page pure helpers + dirty-store wiring.
//
// Focus on the lossy-edit risks the structured editor introduces:
//   • env round-trip: KEY=value lines, blank/comment skip, strict key shape
//   • args round-trip: newline + comma split, empty token drop
//   • normalizeMcpConfig: legacy `args` missing / extra fields preserved
//   • toPersistShape: drops empty optional fields, keeps unknown extras
//   • isValidServerName: rejects whitespace/slash/empty, accepts dot/dash
//   • findDuplicateNames: case-insensitive
//   • dirty store: save bundle carries the round-tripped persist shape

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDirtyStore } from '../../public/manager/src/settings/dirty-store';
import {
    findDuplicateNames,
    formatArgsText,
    formatEnvText,
    isValidServerName,
    makeEmptyServer,
    newServerName,
    normalizeMcpConfig,
    normalizeServer,
    parseArgsText,
    parseEnvText,
    toPersistShape,
    validateServer,
    type McpConfig,
} from '../../public/manager/src/settings/pages/mcp-helpers';

// ─── env parsing/round-trip ─────────────────────────────────────────

test('parseEnvText: KEY=value lines, blank + comment skipped', () => {
    const text = [
        'API_KEY=abc',
        '',
        '# comment',
        'PORT=8080',
        'BAD KEY=ignored',
        'NoEquals',
        '_X=under',
    ].join('\n');
    assert.deepEqual(parseEnvText(text), {
        API_KEY: 'abc',
        PORT: '8080',
        _X: 'under',
    });
});

test('parseEnvText: empty/null inputs', () => {
    assert.deepEqual(parseEnvText(''), {});
    assert.deepEqual(parseEnvText('   \n\n'), {});
});

test('parseEnvText: value can contain = signs', () => {
    assert.deepEqual(parseEnvText('TOKEN=a=b=c'), { TOKEN: 'a=b=c' });
});

test('formatEnvText: empty/undefined → empty string', () => {
    assert.equal(formatEnvText(undefined), '');
    assert.equal(formatEnvText({}), '');
});

test('formatEnvText round-trips through parseEnvText', () => {
    const env = { A: '1', B: 'two words' };
    assert.deepEqual(parseEnvText(formatEnvText(env)), env);
});

// ─── args parsing/round-trip ────────────────────────────────────────

test('parseArgsText: splits on newlines and commas, drops blanks', () => {
    assert.deepEqual(parseArgsText('-y\n@upstash/context7-mcp\n'), [
        '-y',
        '@upstash/context7-mcp',
    ]);
    assert.deepEqual(parseArgsText('-y, @upstash/context7-mcp'), [
        '-y',
        '@upstash/context7-mcp',
    ]);
    assert.deepEqual(parseArgsText(''), []);
});

test('formatArgsText: undefined/empty → empty', () => {
    assert.equal(formatArgsText(undefined), '');
    assert.equal(formatArgsText([]), '');
});

test('formatArgsText round-trips through parseArgsText', () => {
    const args = ['-y', '@upstash/context7-mcp', '--flag=value'];
    assert.deepEqual(parseArgsText(formatArgsText(args)), args);
});

// ─── normalizeMcpConfig / normalizeServer ───────────────────────────

test('normalizeMcpConfig: legacy + missing-args server', () => {
    const cfg = normalizeMcpConfig({
        servers: {
            ctx7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
            legacy: { command: 'foo' },
            ignoredArrayShape: { command: 'x', args: 'should-be-ignored' },
        },
        someExtra: 'preserved',
    });
    assert.equal(cfg.someExtra, 'preserved');
    assert.deepEqual(cfg.servers.ctx7?.args, ['-y', '@upstash/context7-mcp']);
    assert.equal(cfg.servers.legacy?.args, undefined);
    assert.equal(cfg.servers.ignoredArrayShape?.args, undefined);
});

test('normalizeMcpConfig: garbage payloads produce empty servers map', () => {
    assert.deepEqual(normalizeMcpConfig(null), { servers: {} });
    assert.deepEqual(normalizeMcpConfig({}), { servers: {} });
    assert.deepEqual(normalizeMcpConfig({ servers: 'no' }), { servers: {} });
});

test('normalizeServer: preserves unknown extras', () => {
    const srv = normalizeServer({
        command: 'x',
        autostart: true,
        unknownField: { nested: 1 },
    });
    assert.equal(srv.command, 'x');
    assert.equal(srv.autostart, true);
    assert.deepEqual(srv.unknownField, { nested: 1 });
});

test('normalizeServer: filters non-string env values + non-string args', () => {
    const srv = normalizeServer({
        command: 'x',
        args: ['ok', 123, null, 'two'],
        env: { OK: 'yes', BAD: 42, ALSO_OK: '0' },
    });
    assert.deepEqual(srv.args, ['ok', 'two']);
    assert.deepEqual(srv.env, { OK: 'yes', ALSO_OK: '0' });
});

// ─── toPersistShape ─────────────────────────────────────────────────

test('toPersistShape: strips empty optional fields, keeps autostart=false', () => {
    const cfg: McpConfig = {
        servers: {
            full: {
                command: 'npx',
                args: ['-y', 'pkg'],
                env: { TOKEN: 'abc' },
                autostart: true,
            },
            min: makeEmptyServer(),
            offSwitch: { command: 'x', autostart: false },
        },
    };
    const persisted = toPersistShape(cfg);
    assert.deepEqual(persisted.servers.full, {
        command: 'npx',
        args: ['-y', 'pkg'],
        env: { TOKEN: 'abc' },
        autostart: true,
    });
    assert.deepEqual(persisted.servers.min, { command: '' });
    assert.deepEqual(persisted.servers.offSwitch, { command: 'x', autostart: false });
});

test('toPersistShape: preserves top-level extras and unknown server fields', () => {
    const cfg: McpConfig = {
        servers: {
            x: { command: 'cmd', customField: 'keep' },
        },
        topExtra: { meta: true },
    };
    const persisted = toPersistShape(cfg);
    assert.equal(persisted.topExtra && (persisted.topExtra as { meta: boolean }).meta, true);
    assert.equal(persisted.servers.x?.customField, 'keep');
});

// ─── name validation + dupes ────────────────────────────────────────

test('isValidServerName: rejects whitespace/slash/empty', () => {
    assert.equal(isValidServerName('ok'), true);
    assert.equal(isValidServerName('ok.dotted'), true);
    assert.equal(isValidServerName('ok-dash_under'), true);
    assert.equal(isValidServerName(''), false);
    assert.equal(isValidServerName(' has space'), false);
    assert.equal(isValidServerName('has/slash'), false);
    assert.equal(isValidServerName('a'.repeat(65)), false);
});

test('validateServer: missing command → invalid', () => {
    assert.equal(validateServer('ok', { command: '' }).kind, 'invalid');
    assert.equal(validateServer('ok', { command: '   ' }).kind, 'invalid');
    assert.equal(validateServer('ok', { command: 'npx' }).kind, 'ok');
    assert.equal(validateServer('bad name', { command: 'npx' }).kind, 'invalid');
});

test('findDuplicateNames: case-insensitive, returns lowercased dupes only', () => {
    const dupes = findDuplicateNames(['Foo', 'foo', 'bar', 'BAR', 'unique']);
    assert.deepEqual(Array.from(dupes).sort(), ['bar', 'foo']);
});

test('newServerName: avoids existing names', () => {
    assert.equal(newServerName([]), 'server-1');
    assert.equal(newServerName(['server-1', 'server-2']), 'server-3');
});

// ─── dirty-store wiring ─────────────────────────────────────────────

test('mcp.config dirty entry carries persist shape + drops invalid', () => {
    const store = createDirtyStore();
    const original: McpConfig = { servers: {} };
    const valid: McpConfig = {
        servers: { x: { command: 'npx' } },
    };
    store.set('mcp.config', {
        value: toPersistShape(valid),
        original: toPersistShape(original),
        valid: true,
    });
    assert.equal(store.isDirty(), true);
    const bundle = store.saveBundle();
    assert.deepEqual(bundle, {
        'mcp.config': { servers: { x: { command: 'npx' } } },
    });

    store.set('mcp.config', {
        value: toPersistShape({ servers: { 'bad name': { command: '' } } }),
        original: toPersistShape(original),
        valid: false,
    });
    const bundle2 = store.saveBundle();
    assert.deepEqual(Object.keys(bundle2), []);
});

test('reverting mcp.config to original clears dirty', () => {
    const store = createDirtyStore();
    const o = toPersistShape({ servers: { x: { command: 'a' } } });
    store.set('mcp.config', { value: toPersistShape({ servers: { x: { command: 'b' } } }), original: o, valid: true });
    assert.equal(store.isDirty(), true);
    store.set('mcp.config', { value: o, original: o, valid: true });
    assert.equal(store.isDirty(), false);
});
