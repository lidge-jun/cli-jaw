import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSlackActivityDetail as project, normalizeSlackActivityDetail as normalize, formatSlackActivityDetail as format } from '../../src/slack/progress-detail.ts';
const shell = (command: string, description?: string) => project({ detail: command, ...(description ? { description } : {}) }, 'Bash', '/repo');
for (const [command, expected] of [
    ['cat src/a.ts src/b.ts src/c.ts', 'Read src/a.ts, src/b.ts'],
    ['head -n 20 src/a.ts', 'Read src/a.ts lines 20'],
    ['tail -10 logs/app.log', 'Read logs/app.log lines 10'],
    ["cd /repo && sed -n '1,80p' src/a.ts", 'Read src/a.ts lines 1–80'],
    ['cd src && cat a.ts', 'Read src/a.ts'],
    ['cd /outside && cat a.ts', 'Read a.ts'],
    ['cd "$UNKNOWN" && cat /repo/a.ts', 'Read a.ts'],
    ["rg -n 'progress' src/slack", 'Search progress src/slack'],
    ['rg --files src/slack', 'List src/slack'],
    ['grep -i -e progress src/a.ts', 'Search progress src/a.ts'],
    ['ls -la src/slack', 'List src/slack'],
    ['npm run typecheck', 'Run npm typecheck'],
    ['pnpm test --secret=DO_NOT_SHOW', 'Test pnpm test'],
    ['yarn build', 'Build yarn build'],
    ['bun run lint', 'Run bun lint'],
    ['node --test tests/foo.test.ts', 'Test node tests/foo.test.ts'],
    ['tsx tests/run.mts tests/foo.test.ts', 'Test tsx tests/run.mts'],
    ["python3 scripts/ask.py 'PRIVATE_QUERY'", 'Run python3 scripts/ask.py'],
    ['git diff -- src/a.ts', 'Git src/a.ts diff'],
    ['git status --short', 'Git status'],
    ['curl -sS -H "Authorization: Bearer PRIVATE_TOKEN" -d \'{"private":"body"}\' https://example.com/private?q=PRIVATE_QUERY', 'HTTP example.com POST'],
    ['curl -X GET -d body https://example.com/private', 'HTTP example.com GET'],
    ['FOO=PRIVATE_ENV npm run check', 'Run npm check'],
    ['cat src/a.ts | head -20', 'Read src/a.ts +1 operations'],
    ['cd /repo; cat src/a.ts\nls src', 'Read src/a.ts +1 operations'],
    ['custom-tool --password PRIVATE_ARG', 'Bash custom-tool'],
] as const) {
    test(`bounded shell form: ${command.split(' ')[0]} → ${expected}`, () => assert.equal(format(shell(command)), expected));
}

test('purpose is explicit metadata, first line, and never inferred from output', () => {
    assert.equal(format(shell('python3 scripts/ask.py private-query', 'Query wiki about products')), 'Query wiki about products\nRun python3 scripts/ask.py');
    assert.equal(project({ output: 'invented purpose', detail: 'cat src/a.ts' }, 'Bash', '/repo')?.purpose, undefined);
    const native = project({ description: 'FORBIDDEN_OUTER', input: JSON.stringify({ description: 'Read the configuration', command: 'cat /repo/config.json' }) }, 'Bash', '/repo', 'native');
    assert.equal(format(native), 'Read the configuration\nRead config.json');
    assert.equal(project({ description: 'FORBIDDEN_OUTER', detail: '/repo/config.json' }, 'Read', '/repo', 'native')?.purpose, undefined);
});

test('literal quoted and escaped spaces project paths, never shell arguments', () => {
    assert.equal(format(shell('cat "src/My File.ts"')), 'Read src/My File.ts');
    assert.equal(format(shell('cat src/My\\ File.ts')), 'Read src/My File.ts');
    assert.equal(format(project({ input: { command: 'cat "C:/Repo/src/My File.ts"' } }, 'Shell', 'C:/Repo', 'native')), 'Read src/My File.ts');
});

for (const command of [
    "python3 -c 'print(\"PRIVATE_BODY\"); $PRIVATE_SECRET'",
    'node --eval "PRIVATE_BODY ${PRIVATE_SECRET}"',
    'cd /repo && python3 -c "PRIVATE_BODY; $(cat private)"',
    "python3 <<'PY'\nPRIVATE_BODY\ncat PRIVATE_SECRET\nPY",
    "bash <<EOF\ncurl https://private.test/PRIVATE_BODY\nEOF",
]) {
    test('inline script is summarized without inspecting its body', () => {
        const out = format(shell(command, 'Check the generated output'));
        assert.match(out, /^Check the generated output\nRun (?:python3|node|bash) inline script$/);
        assert.doesNotMatch(out, /PRIVATE|curl|private\.test|print/);
    });
}

for (const command of [
    "cat 'unterminated PRIVATE_BODY", 'cat $(echo PRIVATE_BODY)', 'cat `echo PRIVATE_BODY`',
    'cat src/a.ts > PRIVATE_OUTPUT', 'cat src/a.ts &&& echo PRIVATE_BODY', 'cat src/a.ts || echo PRIVATE_BODY',
    'PRIVATE_ENV="$(cat PRIVATE_BODY)" cat src/a.ts', 'cat src/../PRIVATE_BODY',
    'curl --unknown https://PRIVATE_BODY.example/path',
]) {
    test('unsafe shell syntax degrades without raw text', () => {
        const result = shell(command, 'Inspect the inputs');
        assert.equal(result?.purpose, 'Inspect the inputs');
        assert.doesNotMatch(format(result), /PRIVATE|unterminated|echo|\$|`|>/);
    });
}

test('normalizer copies only finite fields and bounds targets and strings', () => {
    const input = { action: 'Search', tool: 'Bash', purpose: 'p'.repeat(200), targets: ['src/a.ts', 'src/b.ts', 'src/c.ts'], query: 'q'.repeat(100), qualifier: 'lines 1–80', raw: 'PRIVATE_BODY' };
    const result = normalize(input)!;
    input.targets[0] = 'MUTATED';
    assert.deepEqual(result.targets, ['src/a.ts', 'src/b.ts']);
    assert.equal(result.purpose?.length, 120); assert.equal(result.query?.length, 60);
    assert.equal(Object.hasOwn(result, 'raw'), false);
    assert.ok(format(result).length <= 200);
    assert.deepEqual(normalize({ tool: 'Read' }), { tool: 'Read' }, 'sparse completion must not invent an action');
    assert.equal(normalize(null), undefined); assert.equal(normalize([]), undefined);
});

for (const value of ['https://example.com/private?token=x', 'user@example.com', '/Users/private/file.txt', 'C:\\Users\\private\\file.txt',
    'Bearer abcdef', 'api_key=abcd', 'password: abcdef', 'xoxb-123456789-PRIVATE', '<@U123>', '*bold*', 'bad\nline', 'bad\u202Etext', 'bad\ud800text', 'Inspect (/Users/private/file)', 'ftp://private.test/file' ]) {
    test('privacy boundary rejects unsafe descriptor text', () => {
        const result = normalize({ purpose: value, query: value, runner: value, tool: value, qualifier: value, targets: [value] });
        assert.ok(!format(result).includes(value));
        assert.equal(result?.purpose, undefined); assert.equal(result?.query, undefined);
    });
}

test('command size, token and segment limits degrade safely', () => {
    for (const command of ['x'.repeat(8193), 'cat ' + 'a '.repeat(129), Array(9).fill('cat src/a.ts').join(';')]) {
        const out = format(shell(command, 'Inspect files')); assert.match(out, /^Inspect files/); assert.ok(out.length <= 200);
    }
    assert.equal(format({ purpose: '😀'.repeat(120), action: 'Run', targets: ['a'.repeat(100)] }).match(/[\uD800-\uDBFF]$/), null);
});

test('native generic detail and unrelated command fields cannot supply semantics', () => {
    const result = project({ detail: 'cat /repo/a.ts', output: 'private', command: 'cat /repo/b.ts' }, 'Bash', '/repo', 'native');
    assert.deepEqual(result, { tool: 'Bash' });
    assert.equal(project({ input: { query: 'progress', path: '/repo/src' } }, 'Search', '/repo', 'native')?.query, 'progress');
});

test('malformed quoted environment assignments never become executable or argument labels', () => {
    assert.equal(format(shell('API_VALUE="PRIVATE_ENV VALUE cat a.ts', 'Inspect inputs')), 'Inspect inputs\nBash');
    assert.equal(format(shell('TOKEN_VALUE=PRIVATE_ENV cat a.ts > output')), 'Read a.ts');
});

test('other inline evaluation flags and unknown interpreter options never display script or option values', () => {
    for (const command of ['node -p PRIVATE_BODY', 'bash -lc PRIVATE_BODY', 'node --require PRIVATE_BODY script.js']) {
        assert.doesNotMatch(format(shell(command)), /PRIVATE_BODY/);
    }
    assert.equal(format(shell('python3 -m pytest tests/test_main.py')), 'Test python3 tests/test_main.py');
});

test('unresolved cd degrades relative targets to basenames without attributing the captured root', () => {
    assert.equal(format(shell('cd "$UNKNOWN" && cat src/a.ts')), 'Read a.ts');
    assert.equal(format(shell('cd ../elsewhere && cat src/a.ts')), 'Read a.ts');
});

test('forged HTTP descriptors cannot bypass host-only and query-free formatting', () => {
    const result = normalize({ action: 'HTTP', targets: ['private/path', '127.0.0.1'], query: 'PRIVATE_QUERY', qualifier: 'POST' });
    assert.deepEqual(result, { action: 'HTTP', qualifier: 'POST' });
});

test('direct files share canonical guards for print details and conflicting native paths', () => {
    assert.equal(format(project({ detail: '/repo/src/a.ts' }, 'Read', '/repo')), 'Read src/a.ts');
    for (const source of ['print', 'native'] as const) {
        const result = project({ input: { file_path: '/repo/src/a.ts', path: '/repo/src/b.ts' }, detail: '/repo/WRONG.ts' }, 'Read', '/repo', source);
        assert.equal(result?.targets, undefined);
        assert.equal(result?.action, 'Read');
    }
    assert.equal(project({ input: '{bad json', detail: '/repo/WRONG.ts' }, 'Read', '/repo')?.targets, undefined);
    assert.equal(project({ detail: '/repo/WRONG.ts' }, 'Read', '/repo', 'native')?.targets, undefined);
    assert.equal(project({}, 42)?.tool, undefined);
});

test('literal cd dot preserves the captured root', () => {
    assert.equal(format(shell('cd . && cat src/a.ts')), 'Read src/a.ts');
});

for (const command of [
    "sed -n '1p' -e PRIVATE_BODY",
    'ls --ignore PRIVATE_PATTERN src',
    'rg --files -g PRIVATE_GLOB src',
    'python3 -m pytest -k PRIVATE_EXPR tests/test.py',
]) {
    test('option value is never projected as a file target', () => {
        assert.doesNotMatch(format(shell(command)), /PRIVATE_/);
    });
}

test('cat end-of-options preserves dash-prefixed file operands without numeric interpretation', () => {
    const result = shell('cat -- -n 20');
    assert.deepEqual(result?.targets, ['-n', '20']);
    assert.equal(result?.qualifier, undefined);
});

for (const [command, expected] of [
    ['cd /repo && python3 scripts/ask.py query 2>&1', 'Run python3 scripts/ask.py'],
    ['cat src/a.ts 2>/dev/null', 'Read src/a.ts'],
    ['cat src/a.ts>PRIVATE_DEST && PRIVATE_ENV=value echo PRIVATE_BODY', 'Read src/a.ts'],
    ['cat src/a.ts 2>"$(echo PRIVATE_DEST)"', 'Read src/a.ts'],
    ['python3 scripts/ask.py --query PRIVATE_QUERY --json', 'Run python3 scripts/ask.py'],
    ['python3 scripts/ask.py -c PRIVATE_BODY', 'Run python3 scripts/ask.py'],
    ['node scripts/main.js --test --require PRIVATE_ARG', 'Run node scripts/main.js'],
    ['cat 2 >PRIVATE_DEST', 'Read 2'],
    ['cat "2">PRIVATE_DEST', 'Read 2'],
] as const) {
    test('literal prefix survives redirection and opaque script arguments', () => assert.equal(format(shell(command)), expected));
}

test('redirection does not validate substitutions or ambiguous quoting in the operation prefix', () => {
    for (const command of ['cat $(echo PRIVATE_FILE) >dest', "cat 'PRIVATE_FILE >dest", 'node --require PRIVATE_MODULE script.js 2>dest']) {
        const result = shell(command);
        assert.equal(result?.targets, undefined);
        assert.doesNotMatch(format(result), /PRIVATE_|dest|script.js/);
    }
});

test('unquoted word-start comments are ignored through newline without exposing private words', () => {
    assert.equal(format(shell('ls # CONFIDENTIAL_COMMENT')), 'List');
    assert.equal(format(shell('ls # CONFIDENTIAL_COMMENT\ncat src/a.ts')), 'List +1 operations');
    assert.equal(format(shell('# CONFIDENTIAL_COMMENT\ncat src/a.ts')), 'Read src/a.ts');
    assert.equal(format(shell("rg '#literal' src/a.ts")), 'Search #literal src/a.ts');
    assert.equal(format(shell('rg mid#word src/a.ts')), 'Search mid#word src/a.ts');
});

test('curl json implies POST while an explicit method remains authoritative', () => {
    assert.equal(format(shell("curl --json '{\"private\":true}' https://example.com/path")), 'HTTP example.com POST');
    assert.equal(format(shell("curl -X GET --json '{\"private\":true}' https://example.com/path")), 'HTTP example.com GET');
});

 test('description-shaped arbitrary tool input never becomes a task purpose', () => {
    for (const name of ['Image', 'Write', 'Search', 'unknown_tool']) {
        const d = project({ description: 'PRIVATE_INPUT', input: { description: 'PRIVATE_INPUT', content: 'PRIVATE_INPUT' } }, name, '/repo', 'native');
        assert.equal(d?.purpose, undefined); assert.doesNotMatch(format(d), /PRIVATE_INPUT/);
    }
});

test('script identity survives quoted and commented heredoc-looking arguments', () => {
    for (const command of ['python3 scripts/ask.py "a<<b"', 'python3 scripts/ask.py # note <<EOF', 'python3 scripts/ask.py <<EOF\nPRIVATE_INPUT\nEOF']) {
        assert.equal(format(shell(command)), 'Run python3 scripts/ask.py');
    }
    assert.equal(format(shell("python3 <<'PY'\nPRIVATE_CODE\nPY")), 'Run python3 inline script');
    assert.equal(format(shell('cat src/__init__.py')), 'Read src/__init__.py');
});

test('purpose markup is excluded without rejecting legitimate underscore filenames', () => {
    assert.equal(normalize({ purpose: '_formatted purpose_' })?.purpose, undefined);
    assert.equal(format({ action: 'Read', targets: ['src/__init__.py'] }), 'Read src/__init__.py');
});

test('safe provider tool identifiers keep their namespace underscores', () => {
    assert.equal(format(project({}, 'mcp__repo__read_file', '/repo', 'native')), 'mcp__repo__read_file');
    assert.equal(project({}, 'xoxb-PRIVATE_TOKEN', '/repo', 'native'), undefined);
});
