import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWikiLinks } from '../../src/manager/notes/wiki-links.js';

test('notes wikilink extractor handles display, headings, escapes, and code exclusion', () => {
    const markdown = [
        '# Alpha',
        'See [[beta]] and `[[inline ignored]]`.',
        '',
        '```md',
        '[[fenced ignored]]',
        '```',
        '',
        'Next [[folder/gamma#Intro|Gamma Display]].',
        '\\[[escaped]]',
    ].join('\n');

    const links = extractWikiLinks('alpha.md', markdown);

    assert.equal(links.length, 2);
    assert.equal(links[0].raw, '[[beta]]');
    assert.equal(links[0].target, 'beta');
    assert.equal(links[0].line, 2);
    assert.equal(links[0].column, 5);
    assert.equal(links[0].startOffset, markdown.indexOf('[[beta]]'));
    assert.equal(links[0].endOffset, markdown.indexOf('[[beta]]') + '[[beta]]'.length);

    assert.equal(links[1].raw, '[[folder/gamma#Intro|Gamma Display]]');
    assert.equal(links[1].target, 'folder/gamma');
    assert.equal(links[1].heading, 'Intro');
    assert.equal(links[1].displayText, 'Gamma Display');
    assert.equal(links[1].status, 'missing');
    assert.equal(links[1].reason, 'not_found');
});
