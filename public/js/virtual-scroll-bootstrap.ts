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
    scrollToIndex?: (index: number) => void;
    shouldFollowBottom?: () => boolean;
    restoreIndex?: number | null;
    onBeforeVirtualHistoryBootstrap?: () => void;
    onAfterVirtualHistoryBottomed?: () => void;
}

/**
 * Orchestrates virtual scroll bootstrap:
 * 1. registerCallbacks (onLazyRender, onPostRender)
 * 2. setItems (with autoActivate=false to prevent premature activation)
 * 3. activateIfNeeded → tanstack measures on mount via ResizeObserver
 * 4. scrollToBottom OR scrollToIndex (restore previous position)
 */
export function bootstrapVirtualHistory(
    items: VirtualItem[],
    deps: VirtualHistoryBootstrapDeps,
): void {
    deps.onBeforeVirtualHistoryBootstrap?.();
    deps.registerCallbacks();
    deps.setItems(items, { autoActivate: false });
    const shouldFollowBottom = deps.shouldFollowBottom?.() ?? true;
    if (shouldFollowBottom) {
        deps.activateIfNeeded(true);
        deps.scrollToBottom();
        deps.onAfterVirtualHistoryBottomed?.();
        return;
    }
    const restoreIdx = deps.restoreIndex;
    if (restoreIdx != null && restoreIdx >= 0) {
        deps.activateIfNeeded(false);
        deps.scrollToIndex?.(restoreIdx);
    } else {
        deps.activateIfNeeded(true);
        deps.scrollToBottom();
        deps.onAfterVirtualHistoryBottomed?.();
    }
}
