import test from 'node:test';

// Keeps a run alive well past a small JAW_TEST_FILE_STALL_MS while never going quiet
// itself, so a false stall elsewhere has time to fire.
for (let i = 1; i <= 10; i++) {
    test(`PACED-${i}`, async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
}
