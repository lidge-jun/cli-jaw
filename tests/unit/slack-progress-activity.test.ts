import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { summarizeToolInput } from '../../src/agent/events/helpers.ts';
import { loadLocales } from '../../src/core/i18n.ts';
import { createSlackActivity, projectSlackPrintTool, projectSlackRuntimeTool,
    type SlackActivityTool, type SlackProgressOutcome } from '../../src/slack/progress-activity.ts';

loadLocales(fileURLToPath(new URL('../../public/locales/', import.meta.url)));
const tool = (key: string, status: SlackActivityTool['status'] = 'in_progress', category: SlackActivityTool['category'] = 'read'): SlackActivityTool => ({ key, status, category });
function fixture(locale = 'en', initial: 'queued' | 'running' = 'running') {
    let clock = 1000;
    return { model: createSlackActivity(() => clock, locale, initial), at: (value: number) => { clock = value; } };
}

test('projectors and every snapshot field exclude private label/detail/key canaries', () => {
    const canaries = ['xoxb-PRIVATE-CANARY', '/Users/private/secret.txt', '<@U_CANARY>', 'https://private.test?q=CANARY', 'curl PRIVATE_COMMAND'];
    for (const canary of canaries) {
        const { model } = fixture();
        const raw = { traceRunId: canary, stepRef: canary, agentId: canary, label: canary, detail: canary, status: 'running' };
        const print = projectSlackPrintTool(raw)!;
        const native = projectSlackRuntimeTool({ kind: 'tool', runId: canary, turnId: canary, itemId: canary, name: canary, input: canary, output: canary, detail: canary })!;
        assert.equal(print.category, 'tool');
        assert.equal(native.status, 'observed');
        model.tool(print); model.tool(native); model.tool(tool(canary));
        for (const value of [print, native, model.snapshot()]) assert.ok(!JSON.stringify(value).includes(canary));
        model.finish('complete');
        assert.ok(!JSON.stringify(model.snapshot()).includes(canary));
    }
});

// ─── Long-running requests (#673) ─────────────────────
// Elapsed seconds alone read the same at 30s and 500s, so an investigation that
// is running perfectly well looks indistinguishable from a hang.

test('SPA-673a: the card stays unchanged below the threshold', () => {
    const { model, at } = fixture('en');
    at(1000 + 299_000);
    const snapshot = model.snapshot();
    assert.ok(!snapshot.details.includes('still in progress'), snapshot.details);
    assert.ok(!snapshot.text.includes('still in progress'));
});

test('SPA-673b: past the threshold the card says so in words', () => {
    const { model, at } = fixture('en');
    at(1000 + 300_000);
    const snapshot = model.snapshot();
    assert.match(snapshot.details, /Running for 5 min — still in progress/);
});

test('SPA-673c: the long-running line is added, never swapped for the phase description', () => {
    // QUIET_MS flips running to waiting after 20s of tool silence. That is a
    // different axis from "this is taking a while", and both are true here.
    // Overwriting the description would hide the quiet notice exactly when it
    // matters most.
    const { model, at } = fixture('en');
    at(1000 + 400_000);
    const snapshot = model.snapshot();
    assert.ok(snapshot.details.startsWith('Waiting for the next update'), snapshot.details);
    assert.match(snapshot.details, /Running for 6 min/);
});

test('SPA-673d: a finished card does not claim to still be running', () => {
    const { model, at } = fixture('en');
    at(1000 + 400_000);
    model.finish('complete');
    at(1000 + 900_000);
    assert.ok(!model.snapshot().details.includes('still in progress'));
});

test('SPA-673e: every locale carries the long-running copy', () => {
    for (const locale of ['ko', 'en', 'ja', 'zh']) {
        const { model, at } = fixture(locale);
        at(1000 + 300_000);
        const snapshot = model.snapshot();
        assert.ok(!snapshot.details.includes('slack.progress.longRunning'), locale);
        assert.ok(snapshot.details.includes('5'), locale);
    }
});

test('exact known aliases classify while decorated names remain generic', () => {
    for (const [label, expected] of [['Read', 'read'], ['read_file', 'read'], ['Write', 'write'], ['Edit', 'write'], ['apply_patch', 'write'], ['Grep', 'search'], ['Glob', 'search'], ['List', 'search'], ['Search', 'search'], ['WebSearch', 'search'], ['WebFetch', 'web'], ['Bash', 'command'], ['shell', 'command'], ['exec_command', 'command'], ['external_tool', 'external'], ['Read /secret', 'tool'], ['mcp__secret__tool', 'tool'], ['constructor', 'tool'], ['__proto__', 'tool']]) {
        assert.equal(projectSlackPrintTool({ label })?.category, expected, label);
    }
});

test('thinking, narration, speech icons and non-tool runtime events are rejected', () => {
    for (const value of ['thinking', 'reasoning', 'narration', 'message', 'speech']) {
        assert.equal(projectSlackPrintTool({ toolType: value, label: 'Read' }), null);
        assert.equal(projectSlackRuntimeTool({ kind: value, name: 'Read' }), null);
    }
    for (const icon of ['💭', '💬', '🧠', '🗣️']) assert.equal(projectSlackPrintTool({ icon, label: 'Read' }), null);
});

test('status mapping never infers success from absent or malformed fields', () => {
    for (const [input, expected] of [['running', 'in_progress'], ['started', 'in_progress'], ['in_progress', 'in_progress'], ['done', 'complete'], ['completed', 'complete'], ['success', 'complete'], ['failed', 'error'], ['rejected', 'error'], ['stopped', 'stopped'], [undefined, 'observed'], [{}, 'observed'], ['not done', 'observed']]) {
        assert.equal(projectSlackPrintTool({ label: 'Read', status: input })?.status, expected);
    }
});

test('private identity separates runs, employees, turns and ref versus sequence', () => {
    const base = { traceRunId: 'run', stepRef: '1', label: 'Read' };
    const entries = [base, { ...base, traceRunId: 'other' }, { ...base, isEmployee: true, agentId: 'a' }, { ...base, isEmployee: true, agentId: 'b' }, { ...base, stepRef: undefined, traceSeq: 1 }].map(projectSlackPrintTool);
    assert.equal(new Set(entries.map(entry => entry!.key)).size, 5);
    assert.equal(projectSlackPrintTool(base)!.key, entries[0]!.key);
    const runtime = { kind: 'tool', runId: 'run', turnId: 'turn', itemId: 'item' };
    assert.notEqual(projectSlackRuntimeTool(runtime)!.key, projectSlackRuntimeTool({ ...runtime, turnId: 'other' })!.key);
});

test('malformed and oversized identity remains a bounded uncorrelated observation', () => {
    const huge = 'X'.repeat(100_000);
    for (const data of [{}, { traceRunId: huge, stepRef: 'x' }, { traceRunId: 'r', stepRef: huge }, { traceRunId: 'r', traceSeq: NaN }, { traceRunId: 'r', traceSeq: -1 }, { traceRunId: 'r', traceSeq: Infinity }, { traceRunId: 'r', stepRef: 'x', isEmployee: true }]) {
        assert.equal(projectSlackPrintTool({ ...data, label: huge, detail: huge })!.key, '');
    }
    assert.equal(projectSlackRuntimeTool({ kind: 'tool', runId: 'r', turnId: 't', itemId: huge })!.key, '');
    const { model } = fixture();
    assert.equal(model.tool(tool(huge)), true);
    assert.equal(model.tool(tool('')), false);
    assert.match(model.snapshot().details, /Tool activity: Observed/);
    assert.ok(model.snapshot().details.length <= 256);
});

test('duplicate events preserve ordering and last activity; terminal steps never reopen', () => {
    const { model, at } = fixture();
    model.tool(tool('a'));
    at(2000); model.tool(tool('b', 'in_progress', 'write'));
    at(6000);
    assert.equal(model.tool(tool('a')), false);
    assert.match(model.snapshot().text, /Last activity: 4s ago/);
    assert.ok(model.snapshot().details.indexOf('File editing') < model.snapshot().details.indexOf('File reading'));
    assert.equal(model.tool(tool('a', 'complete')), true);
    at(8000);
    assert.equal(model.tool(tool('a')), false);
    assert.equal(model.tool(tool('a', 'error')), false);
    assert.match(model.snapshot().details, /File reading: Done/);
    assert.match(model.snapshot().text, /Last activity: 2s ago/);
    for (const status of ['error', 'stopped'] as const) {
        model.tool(tool(status, status));
        assert.equal(model.tool(tool(status)), false);
    }
});

test('256 retained identities and six recent rows stay bounded without evicting terminal memory', () => {
    const { model, at } = fixture();
    for (let i = 0; i < 256; i++) model.tool(tool(String(i), 'complete'));
    at(2000);
    assert.equal(model.tool(tool('overflow', 'complete', 'write')), true);
    for (let i = 0; i < 3000; i++) assert.equal(model.tool(tool(`overflow-${i}`)), false);
    assert.equal(model.tool(tool('0')), false);
    const snapshot = model.snapshot();
    assert.ok(snapshot.details.split('\n').length <= 9);
    assert.ok(snapshot.details.length <= 256);
    assert.match(snapshot.details, /Tool activity: Observed/);
    assert.doesNotMatch(snapshot.text, /256|3000|overflow|task-/);
});

test('quiet time is honest waiting, queued remains queued, and a new event leaves waiting', () => {
    const { model, at } = fixture();
    at(20_999); assert.match(model.snapshot().details, /^Observing activity/);
    at(21_000); assert.match(model.snapshot().details, /^Waiting for the next update/);
    assert.match(model.snapshot().details, /Elapsed: 20s/);
    assert.match(model.snapshot().details, /Last activity: 20s ago/);
    model.tool(tool('a'));
    assert.match(model.snapshot().details, /^Observing activity/);
    const queued = fixture('en', 'queued');
    queued.at(90_000); assert.match(queued.model.snapshot().details, /^Queued/);
    assert.equal(queued.model.phase('running'), true);
    assert.match(queued.model.snapshot().details, /^Observing activity/);
    assert.match(queued.model.snapshot().details, /Last activity: 0s ago/);
});

test('delivery seals tools and phase changes; finish seals all inputs and freezes measured time', () => {
    const { model, at } = fixture();
    model.tool(tool('a'));
    assert.equal(model.phase('delivering'), true);
    assert.equal(model.tool(tool('b')), false);
    assert.equal(model.phase('running'), false);
    assert.equal(model.snapshot().delivery?.status, 'in_progress');
    at(5000); model.finish('complete', undefined, true);
    const final = model.snapshot();
    assert.match(final.details, /File reading: Unconfirmed/);
    assert.doesNotMatch(final.details, /File reading: Done/);
    assert.equal(final.workStatus, 'complete');
    assert.equal(final.delivery?.status, 'complete');
    at(99_000); model.finish('error'); model.phase('queued'); model.tool(tool('c'));
    assert.deepEqual(model.snapshot(), final);
});

test('all outcomes and merged/removed reasons use distinct fixed copy', () => {
    for (const [outcome, copy] of [['complete', 'Work observation ended'], ['error', 'Request failed'], ['cancelled', 'Request cancelled'], ['expired', 'Progress tracking ended. Execution may continue.']] as const) {
        const { model } = fixture(); model.finish(outcome);
        assert.match(model.snapshot().text, new RegExp(copy));
    }
    for (const reason of ['merged', 'removed'] as const) {
        const { model } = fixture(); model.finish('complete', reason);
        assert.doesNotMatch(model.snapshot().text, /Answer delivered/);
        assert.match(model.snapshot().text, reason === 'merged' ? /combined/ : /removed/);
    }
});

test('Korean, English, Japanese, Chinese and unknown-locale fallback load real dictionaries', () => {
    assert.equal(fixture('ko').model.snapshot().title, '요청 진행 상황 · 경과: 0초');
    assert.equal(fixture('en').model.snapshot().title, 'Request progress · Elapsed: 0s');
    assert.equal(fixture('en-US').model.snapshot().title, 'Request progress · Elapsed: 0s');
    assert.equal(fixture('ja').model.snapshot().title, 'リクエストの進捗 · 経過: 0秒');
    assert.equal(fixture('zh').model.snapshot().title, '请求进度 · 已用时：0秒');
    assert.deepEqual(fixture('unrecognized').model.snapshot(), fixture('ko').model.snapshot());
    for (const locale of ['ko', 'en', 'ja', 'zh']) {
        const { model } = fixture(locale);
        for (const category of ['read', 'write', 'search', 'web', 'command', 'external'] as const) model.tool(tool(category, 'observed', category));
        assert.ok(model.snapshot().details.length <= 256);
        assert.doesNotMatch(model.snapshot().text, /slack\.progress\./);
        model.finish('cancelled'); assert.doesNotMatch(model.snapshot().text, /slack\.progress\./);
    }
});

test('malformed enum inputs are ignored and clock reversal never fabricates negative ages', () => {
    const { model, at } = fixture();
    const before = model.snapshot();
    assert.equal(model.tool({ key: 'a', category: 'CANARY', status: 'CANARY' } as unknown as SlackActivityTool), false);
    model.finish('CANARY' as SlackProgressOutcome);
    assert.deepEqual(model.snapshot(), before);
    at(-100); assert.deepEqual(model.snapshot(), before);
    at(Infinity); assert.deepEqual(model.snapshot(), before);
});


test('queued is initial-only and cannot be restored by phase input', () => {
    for (const initial of ['running', 'queued'] as const) {
        const { model } = fixture('en', initial);
        if (initial === 'queued') assert.equal(model.phase('running'), true);
        const before = model.snapshot();
        assert.equal(model.phase('queued'), false);
        assert.deepEqual(model.snapshot(), before);
        model.phase('waiting');
        assert.equal(model.phase('queued'), false);
    }
});

test('print projection requires tool evidence and trims exclusion fields', () => {
    for (const data of [{}, { detail: 'private' }, { status: 'running' }, { label: '   ' }, { label: 42 }, { traceRunId: 'r', stepRef: 's' }]) {
        assert.equal(projectSlackPrintTool(data), null);
    }
    assert.equal(projectSlackPrintTool({ label: 'UnknownRealTool' })?.category, 'tool');
    assert.equal(projectSlackPrintTool({ toolType: 'tool' })?.status, 'observed');
    for (const key of ['kind', 'type', 'toolType']) {
        for (const value of [' thinking ', ' REASONING ', ' narration ']) {
            assert.equal(projectSlackPrintTool({ label: 'Read', [key]: value }), null);
        }
    }
    assert.equal(projectSlackPrintTool({ label: 'Read', icon: ' 💬 ' }), null);
});

test('terminal delivery requires attempted delivery or explicit receipt, independent of run outcome', () => {
    for (const locale of ['en', 'ko', 'ja', 'zh']) {
        for (const outcome of ['complete', 'error', 'cancelled', 'expired'] as const) {
            for (const reason of [undefined, 'merged', 'removed'] as const) {
                const { model } = fixture(locale, 'queued');
                model.finish(outcome, reason);
                assert.equal(model.snapshot().delivery, undefined);
            }
            for (const attempted of [false, true]) {
                for (const receipt of [undefined, false, true]) {
                    const { model } = fixture(locale);
                    if (attempted) model.phase('delivering');
                    model.finish(outcome, undefined, receipt);
                    const snapshot = model.snapshot();
                    if (!attempted && receipt === undefined) assert.equal(snapshot.delivery, undefined);
                    else assert.equal(snapshot.delivery?.status, receipt === true ? 'complete' : 'error');
                    assert.doesNotMatch(snapshot.text, /slack\.progress\./);
                    if (locale === 'en') {
                        if (receipt === true) assert.equal(snapshot.delivery?.title, 'Answer delivered');
                        else if (receipt === false) assert.equal(snapshot.delivery?.title, 'Answer delivery could not be confirmed');
                        else if (attempted) assert.equal(snapshot.delivery?.title, 'Answer delivery unconfirmed');
                        if (receipt !== true) assert.doesNotMatch(snapshot.text, /Answer delivered/);
                    }
                }
            }
        }
    }
});


test('later uncorrelated events refresh quiet activity without adding rows or claiming completion', () => {
    const { model, at } = fixture();
    assert.equal(model.tool(tool('')), true);
    assert.equal(model.tool(tool('')), false);
    at(21_000);
    assert.match(model.snapshot().details, /^Waiting for the next update/);
    assert.equal(model.tool(tool('', 'complete', 'write')), true);
    const snapshot = model.snapshot();
    assert.match(snapshot.details, /^Observing activity/);
    assert.match(snapshot.details, /Last activity: 0s ago/);
    assert.equal(snapshot.details.split('Tool activity: Observed').length - 1, 1);
    assert.doesNotMatch(snapshot.details, /Done|File editing/);
    assert.equal(model.tool(tool('')), false);
    at(22_000);
    assert.equal(model.tool(tool('')), true);
    assert.match(model.snapshot().details, /Last activity: 0s ago/);
    model.phase('delivering');
    at(23_000);
    assert.equal(model.tool(tool('')), false);
    assert.match(model.snapshot().details, /Last activity: 1s ago/);
});


test('native summary and activity cards are bounded, newest first, and contain no identities', () => {
    const { model, at } = fixture();
    for (let i = 0; i < 1000; i++) model.tool(tool(`PRIVATE-CANARY-${i}`, 'complete', 'read'));
    const snapshot = model.snapshot();
    assert.equal(snapshot.activities.length, 6);
    assert.equal(snapshot.activities[0]?.title, 'Tool activity: Observed');
    assert.ok(snapshot.summary.length <= 256);
    assert.match(snapshot.summary, /^Observing activity/);
    assert.match(snapshot.summary, /Elapsed: 0s/);
    assert.match(snapshot.summary, /Last activity: 0s ago/);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-CANARY|task-|recent-/);
    for (const card of snapshot.activities) {
        assert.deepEqual(Object.keys(card).sort(), ['status', 'title']);
        assert.ok(card.title.length <= 256);
    }
    at(21_000);
    assert.match(model.snapshot().summary, /^Waiting for the next update/);
});

test('native card status closes observation without inventing terminal tool success', () => {
    const { model } = fixture();
    model.tool(tool('running', 'in_progress', 'read'));
    model.tool(tool('observed', 'observed', 'write'));
    model.tool(tool('failed', 'error', 'search'));
    model.tool(tool('stopped', 'stopped', 'web'));
    model.tool(tool('done', 'complete', 'command'));
    assert.deepEqual(model.snapshot().activities, [
        { title: 'Command execution: Done', status: 'complete' },
        { title: 'Webpage reading: Stopped', status: 'complete' },
        { title: 'Search: Error', status: 'error' },
        { title: 'File editing: Observed', status: 'complete' },
        { title: 'File reading: Running', status: 'in_progress' },
    ]);
    model.finish('complete');
    assert.deepEqual(model.snapshot().activities, [
        { title: 'Command execution: Done', status: 'complete' },
        { title: 'Webpage reading: Stopped', status: 'complete' },
        { title: 'Search: Error', status: 'error' },
        { title: 'File editing: Unconfirmed', status: 'complete' },
        { title: 'File reading: Unconfirmed', status: 'complete' },
    ]);
    assert.match(model.snapshot().summary, /^Work observation ended/);
});

test('an observed queue start resets activity age but preserves time spent waiting', () => {
    const queued = fixture('en', 'queued');
    queued.at(61000);
    queued.model.phase('running');
    assert.match(queued.model.snapshot().summary, /Elapsed: 60s/);
    assert.match(queued.model.snapshot().summary, /Last activity: 0s ago/);
    assert.doesNotMatch(queued.model.snapshot().summary, /Waiting for the next update/);
});

for (const [detail, root, expected] of [
    ['/project/src/agent/spawn.ts', '/project', 'src/agent/spawn.ts'],
    ['./src/main.ts', '/project', 'src/main.ts'],
    ['/project/src/My File.ts', '/project', 'src/My File.ts'],
    ['/repo/My Project/src/My File.ts', '/repo/My Project', 'src/My File.ts'],
    [String.raw`C:\My Project\src\My File.ts`, String.raw`C:\My Project`, 'src/My File.ts'],
    ['README', '/project', 'README'],
    ['/project-other/private/file.ts', '/project', 'file.ts'],
    ['/private/file.ts', undefined, 'file.ts'],
    ['src/main.ts', undefined, 'main.ts'],
    [String.raw`C:\Project\src\main.ts`, String.raw`C:\Project`, 'src/main.ts'],
    [String.raw`D:\private\file.ts`, String.raw`C:\Project`, 'file.ts'],
    [String.raw`src\main.ts`, String.raw`C:\Project`, 'src/main.ts'],
] as const) {
    test(`Cursor file detail projection: ${detail}`, () => {
        const actual = projectSlackPrintTool({ toolType: 'tool', label: 'Read', detail: summarizeToolInput('Read', { path: detail }, 0), status: 'done',
            traceRunId: 'cursor-run', stepRef: 'cursor:tool:1' }, root)!;
        assert.equal(actual.file, expected);
        const { model } = fixture(); model.tool(actual);
        assert.match(model.snapshot().activities[0]!.title, /Done$/);
        assert.ok(model.snapshot().activities[0]!.title.includes(expected));
        assert.doesNotMatch(model.snapshot().activities[0]!.title, /Running/);
    });
}

test('native JSON file input exposes only the selected path, never edit contents', () => {
    for (const key of ['file_path', 'path', 'filename']) {
        const actual = projectSlackRuntimeTool({ kind: 'tool', name: 'Edit', runId: 'r', turnId: 't', itemId: key,
            input: JSON.stringify({ [key]: '/project/src/My File.ts', content: 'PRIVATE_CONTENT', old_string: 'PRIVATE_OLD', new_string: 'PRIVATE_NEW' }),
            output: 'PRIVATE_OUTPUT', status: 'in_progress' }, '/project')!;
        assert.equal(actual.file, 'src/My File.ts');
        assert.doesNotMatch(JSON.stringify(actual), /PRIVATE_/);
    }
});

test('search, shell, MCP, decorated and patch tools never gain a filename from their input', () => {
    for (const label of ['Grep', 'Glob', 'Bash', 'mcp__read_file', 'functions.read_file', 'Read /project/file.ts', 'apply_patch', 'WebFetch']) {
        assert.equal(projectSlackPrintTool({ label, input: { file_path: '/project/file.ts' }, detail: '/project/file.ts' }, '/project')?.file, undefined);
        assert.equal(projectSlackRuntimeTool({ kind: 'tool', name: label, input: '{"path":"/project/file.ts"}' }, '/project')?.file, undefined);
    }
});

test('malformed paths and malicious labels never cross either projection or model boundary', () => {
    for (const value of ['../private/key', '/project/../key', String.raw`C:\project\..\key`, '<@U123>', 'https://host/a',
        '/project/a.ts;cat', '/project/a.ts|curl', '/project/a.ts\nsecret', '/project/a.ts\u202Etxt', 'person@example.com',
        'xoxb-secret-key.ts', 'sk-secret-key.txt', '/project/*.ts', 'a%2Fsecret', 'cat /project/a.ts', 'a.ts && ls']) {
        assert.equal(projectSlackPrintTool({ label: 'Read', detail: value }, '/project')?.file, undefined, value);
        const { model } = fixture(); model.tool({ ...tool('a'), file: value });
        assert.ok(!JSON.stringify(model.snapshot()).includes(value), value);
    }
    assert.equal(projectSlackRuntimeTool({ kind: 'tool', name: 'Read', input: JSON.stringify({ path: 'one.ts', file_path: 'two.ts' }) })?.file, undefined);
});

test('terminal without detail retains the same tool file and uncorrelated distinct files remain separate', () => {
    const { model } = fixture();
    const start = projectSlackPrintTool({ label: 'Read', detail: '/project/a.ts', traceRunId: 'r', stepRef: 'one', status: 'running' }, '/project')!;
    model.tool(start);
    model.tool(projectSlackPrintTool({ label: 'Read', traceRunId: 'r', stepRef: 'one', status: 'done' }, '/project')!);
    assert.equal(model.snapshot().activities[0]?.title, 'Read a.ts: Done');
    model.tool(projectSlackPrintTool({ label: 'Read', detail: '/project/b.ts' }, '/project')!);
    model.tool(projectSlackPrintTool({ label: 'Read', detail: '/project/c.ts' }, '/project')!);
    const titles = model.snapshot().activities.map(row => row.title);
    assert.ok(titles.includes('Read b.ts: Observed'));
    assert.ok(titles.includes('Read c.ts: Observed'));
    assert.ok(titles.includes('Read a.ts: Done'));
});

test('file labels and plan titles stay bounded and elapsed title freezes at terminal', () => {
    const file = projectSlackPrintTool({ label: 'Read', detail: '/project/' + 'a'.repeat(150) + '.ts' }, '/project')!.file!;
    assert.equal([...file].length, 100);
    const { model, at } = fixture();
    at(4000); assert.equal(model.snapshot().title, 'Request progress · Elapsed: 3s');
    model.finish('complete'); at(9000); assert.equal(model.snapshot().title, 'Request progress · Elapsed: 3s');
});

test('malformed structured inputs and output text never become a file address', () => {
    for (const input of [JSON.stringify({ file_path: 42 }), JSON.stringify({ path: ['one.ts'] }), '{bad json',
        JSON.stringify({ command: 'cat /project/a.ts' }), 'x'.repeat(4097)]) {
        assert.equal(projectSlackRuntimeTool({ kind: 'tool', name: 'Read', input, output: '/project/a.ts' }, '/project')?.file, undefined);
    }
    const { model } = fixture();
    model.tool({ ...tool('shell', 'complete', 'command'), file: 'secret.ts' });
    assert.doesNotMatch(JSON.stringify(model.snapshot()), /secret.ts/);
});

test('native detail cannot stand in for missing or invalid structured file input', () => {
    for (const input of [undefined, '{broken', '{"content":"PRIVATE_CONTENT"}', '{"command":"PRIVATE_CONTENT"}', 'null', '[]']) {
        const result = projectSlackRuntimeTool({ kind: 'tool', name: 'Read', runId: 'r', turnId: 't', itemId: 'i',
            status: 'in_progress', input, detail: 'PRIVATE_CONTENT' }, '/project');
        assert.equal(result?.file, undefined);
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CONTENT/);
    }
    assert.equal(projectSlackPrintTool({ label: 'Read', detail: '/project/src/real.ts' }, '/project')?.file, 'src/real.ts');
    assert.equal(projectSlackPrintTool({ label: 'Read', input: '{broken', detail: 'PRIVATE_CONTENT' }, '/project')?.file, undefined);
});

test('five shell-heavy activities expose distinct actual purposes and operations rather than identical command labels', () => {
    const { model } = fixture();
    const rows = [
        ['Read the Slack event handler', "cd /project && sed -n '1,80p' src/slack/bot.ts", 'src/slack/bot.ts'],
        ['Find progress call sites', "rg -n 'progress' src/slack", 'src/slack'],
        ['Check TypeScript types', 'npm run typecheck', 'typecheck'],
        ['Query wiki about products', 'python3 scripts/ask.py private-question', 'scripts/ask.py'],
        ['Review the pending source diff', 'git diff -- src/slack/bot.ts', 'src/slack/bot.ts'],
    ];
    for (const [i, [description, detail]] of rows.entries()) {
        model.tool(projectSlackPrintTool({ label: 'Bash', description, detail, status: 'done', traceRunId: 'real-run', stepRef: `call-${i}` }, '/project')!);
    }
    const snapshot = model.snapshot();
    assert.equal(snapshot.activities.length, 5);
    assert.equal(new Set(snapshot.activities.map(row => row.title)).size, 5);
    for (const [description, , target] of rows) {
        const row = snapshot.activities.find(row => row.title.includes(description!));
        assert.ok(row, description); assert.ok(row.title.includes(target!), target);
        assert.match(row.title, /Done$/);
        assert.ok(snapshot.text.includes(description!), 'fallback also retains meaningful purpose');
    }
    assert.doesNotMatch(snapshot.text, /private-question/);
});

test('same-ID sparse terminal retains observed purpose and target without borrowing or reopening work', () => {
    const { model } = fixture();
    const identity = { traceRunId: 'r', stepRef: 'a', label: 'Bash' };
    model.tool(projectSlackPrintTool({ ...identity, description: 'Inspect the event handler', detail: 'cat src/events.ts', status: 'running' }, '/project')!);
    model.tool(projectSlackPrintTool({ ...identity, status: 'done' }, '/project')!);
    assert.equal(model.snapshot().activities[0]?.title, 'Inspect the event handler\nRead src/events.ts: Done');
    assert.equal(model.tool(projectSlackPrintTool({ ...identity, description: 'Unrelated late work', status: 'running' }, '/project')!), false);
    assert.doesNotMatch(model.snapshot().text, /Unrelated/);
    model.tool(projectSlackPrintTool({ ...identity, stepRef: 'b', description: 'Check source types', detail: 'npm run typecheck', status: 'running' }, '/project')!);
    assert.equal(model.snapshot().activities[0]?.title, 'Check source types\nRun npm typecheck: Running');
    assert.ok(model.snapshot().text.length < 2200);
});

test('activity metadata is rebuilt before storage and cannot leak raw fields or mutable caller arrays', () => {
    const { model } = fixture();
    const activity = { purpose: 'Inspect source', action: 'Read' as const, targets: ['src/a.ts'], raw: 'PRIVATE_BODY' };
    model.tool({ ...tool('a'), activity });
    activity.targets[0] = 'CHANGED_AFTER_ADMISSION';
    assert.match(model.snapshot().text, /Inspect source\nRead src\/a.ts/);
    assert.doesNotMatch(model.snapshot().text, /PRIVATE_BODY|CHANGED_AFTER/);
    model.tool({ ...tool('b'), activity: { purpose: 'Authorization: Bearer PRIVATE_VALUE', action: 'Read', targets: ['/Users/private/a'] } });
    assert.doesNotMatch(model.snapshot().text, /Authorization|PRIVATE_VALUE|\/Users/);
});
