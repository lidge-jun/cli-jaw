/**
 * Pure-logic bootstrap orchestrator for virtual scroll.
 * Simplified: tanstack virtual-core measures heights automatically.
 */
import type { VirtualItem } from './virtual-scroll.js';

export interface VirtualHistoryBootstrapDeps {
    registerCallbacks: () => void;
    setItems: (items: VirtualItem[], options?: { autoActivate?: boolean; toBottom?: boolean }) => void;
    activateIfNeeded: (toBottom: boolean) => void;
    scrollToBottom: () => void;
}

/**
 * Orchestrates virtual scroll bootstrap:
 * 1. registerCallbacks (onLazyRender, onPostRender)
 * 2. setItems (with autoActivate=false to prevent premature activation)
 * 3. activateIfNeeded → tanstack measures on mount via ResizeObserver
 * 4. scrollToBottom
 */
export function bootstrapVirtualHistory(
    items: VirtualItem[],
    deps: VirtualHistoryBootstrapDeps,
): void {
    deps.registerCallbacks();
    deps.setItems(items, { autoActivate: false });
    deps.activateIfNeeded(true);
    deps.scrollToBottom();
}
