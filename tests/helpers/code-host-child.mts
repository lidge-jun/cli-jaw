/**
 * Child Code host for crash-recovery tests.
 *
 * hostPort is the createCodeHost `port` OPTION (src/code-mode/host.ts): it
 * only names `code-worker-<port>.sqlite`. The HTTP listener is a separate
 * listen(0) port. Do not install a SIGTERM handler that disposes the host —
 * the parent SIGKILLs this process mid-turn so the sqlite row stays
 * `streaming` and the next owner's recover() can convert it to an orphan.
 * A clean dispose() would settle the turn and the orphan would never happen
 * (src/code-mode/session.ts dispose, src/code-mode/store.ts recoverInterrupted).
 */
import express, { type RequestHandler } from 'express';
import { createCodeHost } from '../../src/code-mode/host.ts';
import { createWorkerApiJsonParser } from '../../src/routes/code-body-parser.ts';
import { registerNativeCodeRoutes } from '../../src/routes/code-native.ts';
import { createFakeCodeProviders } from './code-fake-providers.mts';

interface ChildConfig {
    home: string;
    hostPort: number;
}

function readConfig(): ChildConfig {
    const fromArgv = process.argv[2];
    const raw = fromArgv && fromArgv.startsWith('{')
        ? fromArgv
        : process.env['CODE_HOST_CHILD_CONFIG'];
    if (!raw) throw new Error('code-host-child requires JSON config via argv or CODE_HOST_CHILD_CONFIG');
    const parsed = JSON.parse(raw) as Partial<ChildConfig>;
    if (typeof parsed.home !== 'string' || !parsed.home) throw new Error('code-host-child home is required');
    if (!Number.isInteger(parsed.hostPort) || parsed.hostPort < 1 || parsed.hostPort > 65535) {
        throw new Error('code-host-child hostPort must be a TCP port integer');
    }
    return { home: parsed.home, hostPort: parsed.hostPort };
}

const config = readConfig();
const fake = createFakeCodeProviders();
const host = createCodeHost({
    home: config.home,
    role: 'worker',
    port: config.hostPort,
    providers: fake.providers,
    idleReapMs: 3_600_000,
});

const passThroughAuth: RequestHandler = (_req, _res, next) => next();
const app = express();
app.use(createWorkerApiJsonParser());
registerNativeCodeRoutes(app, passThroughAuth, () => host.get(), '/api/code');

/**
 * Die the way a crashed owner dies: no dispose, no close, no chance to settle
 * the live turn. The parent could send SIGKILL instead, but a signal has to
 * find the right process and the pipes have to reach EOF before the parent can
 * exit, and getting either wrong shows up as a stalled test file rather than as
 * a leaked child. Ending the process from inside is the same crash with none of
 * that ambiguity.
 */
app.post('/__crash', (_req, res) => {
    res.json({ ok: true });
    res.on('finish', () => setImmediate(() => process.exit(1)));
});

const server = app.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('code-host-child failed to bind HTTP');
    process.stdout.write(JSON.stringify({ httpPort: address.port }) + '\n');
});
