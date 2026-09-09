import test from 'node:test';

// A child whose buffered stdout reaches the parent after its own completion event. The
// driver must not re-arm a file that has already reported (#661 follow-up: the first CI
// run of the watchdog killed shard 1/4 because two finished files were re-armed by
// exactly this and then sat silent past the bound).
test('TAIL-A the only result this file reports', () => {});
process.on('exit', () => { console.log('TAIL-late stdout after the last result'); });
