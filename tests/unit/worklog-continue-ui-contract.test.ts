import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '../..');

function readProjectFile(path: string): string {
    return readFileSync(join(root, path), 'utf8');
}

test('chat frontend handles idle continue without duplicate no-pending system copy', () => {
    const src = readProjectFile('public/js/features/chat.ts');
    const branchStart = src.indexOf('data.noPendingContinue');
    assert.ok(branchStart > 0, 'chat.ts should handle noPendingContinue');
    const branchEnd = src.indexOf('} else if (data.continued)', branchStart);
    assert.ok(branchEnd > branchStart, 'noPendingContinue branch should precede continued branch');
    const branch = src.slice(branchStart, branchEnd);

    assert.ok(src.includes('noPendingContinue?: boolean'), 'MessageResult should include noPendingContinue');
    assert.ok(branch.includes("addMessage('user', text)"), 'idle continue should still render the user message');
    assert.ok(branch.includes('upsertMessage'), 'idle continue should keep local message cache aligned');
    assert.ok(!branch.includes('addSystemMsg('), 'no-pending system copy is emitted by orchestrate_done only');
    assert.ok(src.includes("addSystemMsg(t('chat.continue'))"), 'active continue copy remains available');
});

test('generic continue locale copy no longer says previous worklog', () => {
    const stale = [
        'Continuing from previous worklog.',
        '이전 worklog 기준으로 이어서 진행합니다.',
        '前回の worklog から続行しています。',
        '正在从上一个 worklog 继续。',
    ];

    for (const locale of ['en', 'ko', 'ja', 'zh']) {
        const src = readProjectFile(`public/locales/${locale}.json`);
        assert.ok(src.includes('"chat.continue"'), `${locale} should keep chat.continue`);
        assert.ok(src.includes('"chat.noPendingContinue"'), `${locale} should add chat.noPendingContinue`);
        for (const phrase of stale) {
            assert.ok(!src.includes(phrase), `${locale} should not contain stale worklog continue copy`);
        }
    }
});
