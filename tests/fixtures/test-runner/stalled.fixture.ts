import test from 'node:test';

// Passes its only test and then holds a ref'ed handle forever. With nothing bounding it
// this file keeps its child alive and its shard silent until the CI step timeout.
test('STALL-A finishes while a handle stays open', () => {});
setInterval(() => {}, 1000);
