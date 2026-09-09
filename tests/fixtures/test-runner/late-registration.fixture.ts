import test from 'node:test';

// The exact shape of #661, made deterministic: awaiting the first test guarantees it has
// settled, so the child's root has drained everything it knows about before the module
// resumes and registers the other two. Under run({forceExit:true}) that is the moment the
// child calls process.exit(), and only LATE-A is ever reported.
await test('LATE-A registered before the await', () => {});
await new Promise(resolve => setImmediate(resolve));
test('LATE-B registered after the await', () => {});
test('LATE-C registered after the await', () => {});
