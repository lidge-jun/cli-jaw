import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preprocessMermaid, sanitizeMermaidForRetry } from '../../public/js/render/mermaid-preprocess.js';

const projectRoot = join(import.meta.dirname, '..', '..');

test('mermaid preprocess normalizes line endings and trailing semicolons', () => {
    const code = 'flowchart TD\r\nA[Hello];\r\nB[World]\r';

    assert.equal(preprocessMermaid(code), 'flowchart TD\nA[Hello]\nB[World]\n');
});

test('mermaid preprocess sanitizes flowchart node ids before shape delimiters', () => {
    const code = [
        'flowchart TD',
        'src/index[File path]',
        'default[Default node]',
        'class[Class node]',
        'style[Style node]',
    ].join('\n');

    const result = preprocessMermaid(code);

    assert.ok(result.includes('src_index[File path]'));
    assert.ok(result.includes('node_default[Default node]'));
    assert.ok(result.includes('node_class[Class node]'));
    assert.ok(result.includes('node_style[Style node]'));
});

test('mermaid retry sanitizer quotes unsafe unquoted flowchart labels', () => {
    const code = [
        'flowchart TD',
        'A[설정(config) & 초기화]',
        'B[text with [[ stuff ]]]',
        'C[She said "hello"]',
        'D["already quoted"]',
    ].join('\n');

    const result = sanitizeMermaidForRetry(code);

    assert.ok(result);
    assert.ok(result.includes('A["설정(config) & 초기화"]'));
    assert.ok(result.includes('B["text with [[ stuff ]]"]'));
    assert.ok(result.includes('C["She said #quot;hello#quot;"]'));
    assert.ok(result.includes('D["already quoted"]'));
});

test('mermaid retry sanitizer stays scoped to flowchart and graph diagrams', () => {
    assert.equal(sanitizeMermaidForRetry('sequenceDiagram\nA->>B: hello'), null);
});

test('mermaid preprocess is wired into chat and notes renderers', () => {
    const chatRenderer = readFileSync(join(projectRoot, 'public/js/render/mermaid.ts'), 'utf8');
    const notesRenderer = readFileSync(join(projectRoot, 'public/manager/src/notes/rendering/MermaidBlock.tsx'), 'utf8');

    assert.ok(chatRenderer.includes("from './mermaid-preprocess.js'"));
    assert.ok(chatRenderer.includes('preprocessMermaid(rawCode)'));
    assert.ok(chatRenderer.includes('sanitizeMermaidForRetry(code)'));
    assert.ok(notesRenderer.includes("from '../../../../js/render/mermaid-preprocess'"));
    assert.ok(notesRenderer.includes('preprocessMermaid(props.code)'));
    assert.ok(notesRenderer.includes('sanitizeMermaidForRetry(code)'));
});
