/**
 * Injectable Code providers for native HTTP/store tests.
 *
 * A FRESH factory instance must be used per host. Sharing a counts object
 * across hosts would carry the first process's open/send into the recovered
 * host and make the "native send is zero after recovery" assertion meaningless.
 */
import type {
    CodeOpenOptions,
    CodeProvider,
    CodeProviderSession,
    CodeProviders,
} from '../../src/code-mode/provider.ts';
import type { CodeProviderCatalog, CodeProviderId } from '../../src/code-mode/wire.ts';
import type { RuntimeTurnOutcome } from '../../src/shared/runtime-contract.ts';

const PROVIDER_IDS: readonly CodeProviderId[] = ['codex-app', 'claude', 'cursor', 'grok'];
const MODEL = 'default';

export interface FakeCodeProviderCounts {
    opens: number;
    sends: number;
}

export interface FakeCodeProviders {
    providers: CodeProviders;
    counts: FakeCodeProviderCounts;
    /** Completes every held send. Tests that cancel/kill do not need this. */
    release(): void;
}

function catalog(id: CodeProviderId): CodeProviderCatalog {
    return {
        id,
        label: id,
        available: true,
        reason: null,
        models: [MODEL],
        defaultModel: MODEL,
        defaultEffort: null,
        modelSource: 'registry',
        capabilities: {
            resume: true,
            interrupt: true,
            permissions: true,
            setModelMidSession: false,
            efforts: ['low', 'high'],
            permissionModes: ['ask', 'auto', 'read-only'],
        },
    };
}

type HoldResolver = (outcome: RuntimeTurnOutcome) => void;

class FakeHandle implements CodeProviderSession {
    readonly nativeSessionId: string;
    alive = true;
    closed = false;
    private settled = false;
    private hold: HoldResolver | null = null;
    constructor(
        private readonly options: CodeOpenOptions,
        private readonly counts: FakeCodeProviderCounts,
        private readonly holds: Set<FakeHandle>,
        nativeSessionId: string,
    ) {
        this.nativeSessionId = nativeSessionId;
    }

    private finish(outcome: RuntimeTurnOutcome): void {
        if (this.settled) return;
        this.settled = true;
        const resolve = this.hold;
        this.hold = null;
        this.holds.delete(this);
        resolve?.(outcome);
    }

    release(): void {
        this.finish({ status: 'done', finalText: 'held assistant text', partialText: 'held assistant text' });
    }

    async send(text: string): Promise<RuntimeTurnOutcome> {
        this.counts.sends += 1;
        const context = this.options.getTurnContext();
        const observer = this.options.transcript(context);
        if (text.includes('HOLD')) {
            // Emit before returning a pending promise so the 50ms coalesce window
            // can commit an assistant_message that sealAccepted can drain.
            observer.text('message', 'answer', 'held assistant text', 'replace', 'commentary');
            return await new Promise<RuntimeTurnOutcome>(resolve => {
                this.hold = resolve;
                this.holds.add(this);
            });
        }
        observer.text('message', 'answer', 'completed assistant text', 'replace', 'final');
        return { status: 'done', finalText: 'completed assistant text', partialText: '' };
    }

    cancel(): Promise<void> {
        // Must not await a caller-owned gate: that hangs past the 180s stall watchdog.
        this.finish({ status: 'stopped', finalText: null, partialText: 'held assistant text' });
        return Promise.resolve();
    }

    close(): Promise<void> {
        this.finish({ status: 'stopped', finalText: null, partialText: 'held assistant text' });
        this.alive = false;
        this.closed = true;
        return Promise.resolve();
    }
}

export function createFakeCodeProviders(): FakeCodeProviders {
    const counts: FakeCodeProviderCounts = { opens: 0, sends: 0 };
    const holds = new Set<FakeHandle>();
    let nextNative = 0;
    const providers = Object.fromEntries(PROVIDER_IDS.map(id => {
        const provider: CodeProvider = {
            id,
            describe: () => catalog(id),
            async open(options: CodeOpenOptions): Promise<CodeProviderSession> {
                counts.opens += 1;
                const handle = new FakeHandle(options, counts, holds, `fake-native-${id}-${++nextNative}`);
                options.onResource(handle);
                return handle;
            },
        };
        return [id, provider];
    })) as CodeProviders;
    return {
        providers,
        counts,
        release() {
            for (const handle of [...holds]) handle.release();
        },
    };
}

export const FAKE_CODE_MODEL = MODEL;
