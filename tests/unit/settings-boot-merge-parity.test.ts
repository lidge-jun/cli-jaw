// The boot merge and the API/watch merge are one implementation now (#696).
//
// They used to be two hand-maintained lists of nested keys that disagreed. A
// partial {heartbeat:{enabled:true}} document lost every sibling at boot but
// kept them over the API; a partial {avatar:{agent:...}} patch was the other way
// round. Which keys a partial write destroyed depended on which door it came
// through, and nothing tested the boot side at all.
//
// These tests go through the real loadSettings, because the defect only ever
// appeared there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A document this schema accepts, so the merge is what is under test rather
 *  than the shape assertions loadSettings runs before it. */
function v4Document(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        settingsSchemaVersion: 4,
        runtimeDefaultMigration: null,
        multiSessionDefaultMigration: null,
        cli: 'codex-app',
        multiSession: {
            enabled: true, maxConcurrent: 2, midRunPolicy: 'steer',
            channels: { telegram: false, discord: false, slack: true },
        },
        messaging: {
            enabledChannels: ['slack'],
            homeChannel: 'slack',
            latestSeen: { telegram: null, discord: null, slack: '111' },
            lastActive: { telegram: null, discord: null, slack: null },
        },
        ...extra,
    };
}

async function loadInHome(doc: unknown): Promise<Record<string, any>> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-jaw-boot-merge-'));
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(doc, null, 2));
    process.env['CLI_JAW_HOME'] = home;
    // Fresh module per home: config.ts resolves its paths at import time.
    const mod = await import('../../src/core/config.ts?home=' + encodeURIComponent(home));
    mod.loadSettings();
    return mod.settings;
}

test('BM-001: a partial network.remoteAccess document keeps its siblings at boot', async () => {
    // The completion condition of #696 stated directly.
    const settings = await loadInHome(v4Document({ network: { remoteAccess: { mode: 'lan' } } }));
    assert.equal(settings['network'].remoteAccess.mode, 'lan');
    assert.equal(settings['network'].remoteAccess.trustProxies, false);
    assert.equal(settings['network'].remoteAccess.trustForwardedFor, false);
    assert.equal(settings['network'].remoteAccess.publicOriginHint, '');
    // And the block the stored document never mentioned at all.
    assert.equal(settings['network'].bindHost, '127.0.0.1');
    assert.equal(settings['network'].lanBypass, false);
});

test('BM-002: boot agrees with the shared layer for the same document', async () => {
    // If boot ever grows a second merge implementation again, this diverges.
    const doc = v4Document({ network: { remoteAccess: { mode: 'lan' } } });
    const settings = await loadInHome(doc);
    const merge = await import('../../src/core/settings-merge.ts');
    const config = await import('../../src/core/config.ts?home=parity-probe');
    const layered = merge.mergeSettingsLayer(config.DEFAULT_SETTINGS, doc as Record<string, any>);
    assert.deepEqual(settings['network'], layered['network']);
});

test('BM-003: a partial heartbeat document keeps its siblings at boot', async () => {
    // This block was replaced wholesale at boot and merged over the API.
    const settings = await loadInHome(v4Document({ heartbeat: { enabled: true } }));
    assert.equal(settings['heartbeat'].enabled, true);
    assert.equal(settings['heartbeat'].every, '30m');
    assert.deepEqual(settings['heartbeat'].activeHours, { start: '08:00', end: '22:00' });
    assert.equal(settings['heartbeat'].target, 'all');
});

test('BM-004: normalization still runs after the layer', async () => {
    // search.engine is forced, not merged, and slack.ack.emoji is a third level
    // the merge spec deliberately does not reach. Folding either into the layer
    // would be a silent regression, so both are asserted here.
    const settings = await loadInHome(v4Document({
        search: { engine: 'not-a-real-engine' },
        slack: { enabled: true, botToken: 'xoxb-test', appToken: 'xapp-test', teamId: 'T1',
            ack: { enabled: true } },
    }));
    assert.equal(settings['search'].engine, 'like');
    assert.equal(settings['slack'].ack.enabled, true);
    assert.ok(settings['slack'].ack.emoji, 'ack.emoji must survive a partial ack block');
    assert.equal(settings['slack'].botToken, 'xoxb-test');
});

test('BM-005: a partial messaging document keeps the other channel cursors', async () => {
    const settings = await loadInHome(v4Document());
    assert.deepEqual(settings['messaging'].enabledChannels, ['slack']);
    assert.equal(settings['messaging'].homeChannel, 'slack');
    assert.equal(settings['messaging'].latestSeen.slack, '111');
    assert.equal(settings['messaging'].latestSeen.telegram, null);
});


test('BM-006: a stored block of null falls back to defaults instead of losing siblings', async () => {
    // The hand-rolled boot merge wrote ...(raw.telegram || {}), so a null block
    // meant "corrupt, use defaults". Carrying the null through the shared layer
    // would replace the block and let the ack normalizer rebuild only part of it,
    // leaving a telegram block with an ack and no token.
    const settings = await loadInHome(v4Document({ telegram: null, memory: null }));
    assert.ok(settings['telegram'], 'telegram must not stay null');
    assert.equal(settings['telegram'].enabled, false);
    assert.equal(settings['telegram'].token, '');
    assert.ok(settings['telegram'].ack, 'the ack normalizer still runs');
    assert.equal(typeof settings['memory'].flushEvery, 'number');
});

test('BM-007: one answer to what the default is', async () => {
    // The schema said multiSession.maxConcurrent was 2 while the lane allocator
    // used ?? 1. Reading the schema was not enough, because the literal at the
    // call site won. These resolvers are the single answer.
    const config = await import('../../src/core/config.ts?home=resolver-probe');
    assert.equal(config.resolveMaxConcurrent({}), config.DEFAULT_SETTINGS.multiSession.maxConcurrent);
    assert.equal(config.resolveFlushEvery({}), config.DEFAULT_SETTINGS.memory.flushEvery);
    assert.equal(config.resolveMemoryRetentionDays({}), config.DEFAULT_SETTINGS.memory.retentionDays);

    // An explicit valid value still wins.
    assert.equal(config.resolveMaxConcurrent({ multiSession: { maxConcurrent: 7 } }), 7);
    assert.equal(config.resolveFlushEvery({ memory: { flushEvery: 3 } }), 3);

    // A value that is not a positive integer is repaired to the default rather
    // than to a second opinion about what the default is.
    for (const bad of [0, -1, 1.5, Number.NaN, null, '3', undefined]) {
        assert.equal(
            config.resolveMaxConcurrent({ multiSession: { maxConcurrent: bad } }),
            config.DEFAULT_SETTINGS.multiSession.maxConcurrent,
            'invalid maxConcurrent ' + String(bad) + ' must resolve to the schema default',
        );
    }
});

