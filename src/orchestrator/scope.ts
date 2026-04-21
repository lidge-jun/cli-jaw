import type { RemoteTarget } from '../messaging/types.js';

type OrcScopeInput = {
    origin?: string;
    target?: RemoteTarget;
    chatId?: string | number;
    workingDir?: string | null;
    persistedScopeId?: string | null;
};

export function resolveOrcScope(_input: OrcScopeInput = {}): string {
    return 'default';
}

export function findActiveScope(_origin: string, _chatId?: string | number, _meta?: { workingDir?: string }): string | null {
    return 'default';
}
