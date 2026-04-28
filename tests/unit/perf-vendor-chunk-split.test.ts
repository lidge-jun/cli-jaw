import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const viteSrc = readFileSync(join(import.meta.dirname, '../../vite.config.ts'), 'utf8');

function chunkBranch(chunkName: string): string {
    const marker = `return '${chunkName}'`;
    const returnIdx = viteSrc.indexOf(marker);
    assert.ok(returnIdx >= 0, `${chunkName} chunk branch must exist`);
    const ifIdx = viteSrc.lastIndexOf('if (', returnIdx);
    assert.ok(ifIdx >= 0, `${chunkName} chunk branch must have an if statement`);
    return viteSrc.slice(ifIdx, returnIdx + marker.length);
}

test('manual chunking must not force a static vendor-mermaid entry dependency', () => {
    assert.ok(!viteSrc.includes("return 'vendor-mermaid'"),
        'Mermaid must stay behind the lazy mermaid-loader import; forcing a vendor-mermaid manual chunk hoists preload helpers into app');
    assert.ok(viteSrc.includes('mermaid-loader'),
        'comment or config should document that Mermaid is loaded through the lazy loader path');
});

test('vendor-utils chunk receives shared transitive utilities', () => {
    const block = chunkBranch('vendor-utils');

    assert.ok(block.includes("node_modules/lodash-es/"), 'lodash-es must move to vendor-utils');
    assert.ok(block.includes("node_modules/d3"), 'd3 shared utilities must move to vendor-utils');
    assert.ok(block.includes("node_modules/chevrotain/"), 'chevrotain must move to vendor-utils');
});
