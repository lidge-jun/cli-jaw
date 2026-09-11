/**
 * One listen/close owner for the route tests.
 *
 * Sixteen unit files had hand-rolled `withServer`, and the copies disagreed
 * about the part that matters. Ten destroyed open connections before closing,
 * one closed first and destroyed after, and five never destroyed at all. Three
 * attached a listen `'error'` listener and none of the three removed it once
 * listening succeeded. The close order is not cosmetic: an aborted SSE socket
 * lingers server-side until the next heartbeat write fails, so `close()` on its
 * own can sit there holding a `listen(0)` port while the next file is trying to
 * get one.
 *
 * This module owns listen and close. It does not own the app: route
 * registrars, auth middleware and per-file request helpers stay in the test
 * that needs them, passed in through `setup`.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import express, { type Express } from 'express';

export type WithServerOptions = {
    /** Use this app instead of a fresh `express()`. */
    app?: Express;
    /** `express.json()`, optionally with options such as `{ limit: '64kb' }`. */
    json?: boolean | Parameters<typeof express.json>[0];
    /** `app.set('query parser', ...)`, which the trace routes need as 'extended'. */
    queryParser?: string;
    /** Register routes and middleware. Runs before the server is created. */
    setup?: (app: Express) => void | Promise<void>;
    /** Runs AFTER close, matching where the route tests already reset state. */
    after?: () => void | Promise<void>;
};

export type ServerContext = {
    app: Express;
    server: Server;
    baseUrl: string;
    port: number;
};

/**
 * Start an app on an ephemeral loopback port, run `fn`, then always destroy
 * open connections and close.
 *
 * `fn` receives the base URL first so the existing `async baseUrl => ...`
 * call sites read unchanged; the full context is available as a second
 * argument when a test needs the app or the server itself.
 */
export async function withServer<T>(
    fn: (baseUrl: string, context: ServerContext) => Promise<T>,
    options: WithServerOptions = {},
): Promise<T> {
    const app = options.app ?? express();
    if (options.json) app.use(express.json(options.json === true ? undefined : options.json));
    if (options.queryParser) app.set('query parser', options.queryParser);
    await options.setup?.(app);

    const server: Server = createServer(app);
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        server.once('error', onError);
        server.listen(0, '127.0.0.1', () => {
            // Removed on success so a later connection error cannot settle a
            // promise that is already resolved, which is what the three files
            // that attached this listener left open.
            server.off('error', onError);
            resolve();
        });
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server did not bind a port');
    const context: ServerContext = {
        app, server, port: address.port, baseUrl: `http://127.0.0.1:${address.port}`,
    };

    try {
        return await fn(context.baseUrl, context);
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await options.after?.();
    }
}

/**
 * Bind options once and return a `withServer` for a whole file.
 *
 * This is what replaces a file-local `async function withServer`: the app
 * description moves into one call and every existing call site keeps its
 * `async baseUrl => ...` shape.
 */
export function serverHarness(options: WithServerOptions = {}) {
    return <T>(fn: (baseUrl: string, context: ServerContext) => Promise<T>): Promise<T> =>
        withServer(fn, options);
}
