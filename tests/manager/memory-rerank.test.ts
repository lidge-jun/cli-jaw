import test from 'node:test';
import assert from 'node:assert/strict';
import { rerankAcrossInstances } from '../../src/manager/memory/result-rerank.ts';
import type { InstanceMemoryRef } from '../../src/manager/memory/types.ts';
import type { SearchHit } from '../../src/memory/shared.ts';

function makeRef(id: string, port: number): InstanceMemoryRef {
    return {
        instanceId: id,
        homePath: `/tmp/${id}`,
        homeSource: 'default-port',
        port,
        label: null,
        dbPath: `/tmp/${id}/index.sqlite`,
        hasDb: true,
    };
}

function makeHit(relpath: string, line: number): SearchHit {
    return {
        path: `/tmp/${relpath}`,
        relpath,
        kind: 'semantic',
        source_start_line: line,
        source_end_line: line + 1,
        snippet: 'snippet',
        score: 0,
    };
}

test('RRF: per-instance limit slices each list', () => {
    const ref = makeRef('3457', 3457);
    const hits = [makeHit('a.md', 1), makeHit('b.md', 2), makeHit('c.md', 3)];
    const result = rerankAcrossInstances([{ ref, hits }], { perInstanceLimit: 2, globalLimit: 10 });
    assert.equal(result.length, 2);
});

test('RRF: global limit caps total', () => {
    const refA = makeRef('3457', 3457);
    const refB = makeRef('3458', 3458);
    const hits = [makeHit('a.md', 1), makeHit('b.md', 2), makeHit('c.md', 3)];
    const result = rerankAcrossInstances([
        { ref: refA, hits },
        { ref: refB, hits },
    ], { perInstanceLimit: 10, globalLimit: 4 });
    assert.equal(result.length, 4);
});

test('RRF: deterministic tiebreak when all rank-0 (same rrfScore)', () => {
    const refA = makeRef('3458', 3458);
    const refB = makeRef('3457', 3457);
    const refC = makeRef('3459', 3459);
    const result = rerankAcrossInstances([
        { ref: refA, hits: [makeHit('z.md', 5)] },
        { ref: refB, hits: [makeHit('a.md', 1)] },
        { ref: refC, hits: [makeHit('m.md', 3)] },
    ], { perInstanceLimit: 10, globalLimit: 10 });
    assert.equal(result.length, 3);
    // instanceId ascending: 3457, 3458, 3459
    assert.equal(result[0]!.instanceId, '3457');
    assert.equal(result[1]!.instanceId, '3458');
    assert.equal(result[2]!.instanceId, '3459');
});

test('RRF: rank-0 beats rank-1 from different instance', () => {
    const refA = makeRef('3457', 3457);
    const refB = makeRef('3458', 3458);
    const result = rerankAcrossInstances([
        { ref: refA, hits: [makeHit('a.md', 1), makeHit('a.md', 2)] },
        { ref: refB, hits: [makeHit('b.md', 1)] },
    ], { perInstanceLimit: 10, globalLimit: 10 });
    // rank-0 from each: rrfScore = 1/60; rank-1: 1/61
    // First two should be both rank-0 (tied), instanceId ascending
    assert.equal(result[0]!.rrfScore, 1 / 60);
    assert.equal(result[1]!.rrfScore, 1 / 60);
    assert.equal(result[2]!.rrfScore, 1 / 61);
});

test('RRF: empty input returns empty output', () => {
    assert.deepEqual(rerankAcrossInstances([], { perInstanceLimit: 10, globalLimit: 10 }), []);
});

test('RRF: empty hits per instance produces no output', () => {
    const ref = makeRef('3457', 3457);
    const result = rerankAcrossInstances([{ ref, hits: [] }], { perInstanceLimit: 10, globalLimit: 10 });
    assert.equal(result.length, 0);
});
