import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
    Virtualizer,
    elementScroll,
    measureElement,
    observeElementOffset,
    observeElementRect,
    type VirtualItem,
} from '@tanstack/virtual-core';

const ESTIMATED_TRANSCRIPT_ROW_HEIGHT = 92;
const OVERSCAN = 6;

type Snapshot = {
    virtualItems: VirtualItem[];
    totalSize: number;
};

export type CodeTranscriptVirtualRows = {
    measureElement: (element: HTMLDivElement | null) => void;
    virtualItems: VirtualItem[];
    totalSize: number;
    restoreAnchor: (index: number, offset: number) => void;
    /**
     * Discard one row's measured height. A collapsed tool row and the same row
     * expanded differ by hundreds of pixels, and `estimateSize` alone cannot
     * correct a size the virtualizer already measured: nothing about a toggle
     * changes `count` or item identity, so no option update fires. Without
     * this the stale height survives until the whole session is switched.
     */
    resizeItem: (index: number, size: number) => void;
};

export function useCodeTranscriptVirtualRows(args: {
    count: number;
    /**
     * Changing the endpoint/session identity discards measurements. Item keys
     * stay stable through streaming updates and older-history prepends.
     */
    resetKey?: string | null;
    scrollElementRef: RefObject<HTMLDivElement | null>;
    getItemKey: (index: number) => string | number;
    estimateSize?: (index: number) => number;
}): CodeTranscriptVirtualRows {
    const [{ virtualItems, totalSize }, setSnapshot] = useState<Snapshot>({ virtualItems: [], totalSize: 0 });
    const virtualizerRef = useRef<Virtualizer<HTMLElement, HTMLElement> | null>(null);

    if (!virtualizerRef.current) {
        virtualizerRef.current = new Virtualizer<HTMLElement, HTMLElement>({
            count: args.count,
            getScrollElement: () => args.scrollElementRef.current,
            estimateSize: args.estimateSize || (() => ESTIMATED_TRANSCRIPT_ROW_HEIGHT),
            overscan: OVERSCAN,
            getItemKey: args.getItemKey,
            indexAttribute: 'data-code-transcript-idx',
            useAnimationFrameWithResizeObserver: true,
            observeElementRect,
            observeElementOffset,
            scrollToFn: elementScroll,
            measureElement,
            onChange: instance => {
                setSnapshot({
                    virtualItems: instance.getVirtualItems(),
                    totalSize: instance.getTotalSize(),
                });
            },
        });
    }

    const virtualizer = virtualizerRef.current;

    useEffect(() => virtualizer._didMount(), [virtualizer]);

    // D2 (260803 unit, 050 phase): the instance lives in a ref that was never
    // cleared, so measured row sizes survived session switches.
    //
    // Use the public `measure()` rather than emptying `measurementsCache`.
    // The durable store is `itemSizeCache` (private, cleared only by
    // `measure()`); `measurementsCache` is reassigned to a fresh lazy view on
    // every recompute, so clearing it releases nothing.
    useEffect(() => {
        virtualizer.measure();
    }, [virtualizer, args.resetKey]);

    useEffect(() => () => { virtualizerRef.current = null; }, []);

    useLayoutEffect(() => {
        virtualizer.setOptions({
            ...virtualizer.options,
            count: args.count,
            getItemKey: args.getItemKey,
            estimateSize: args.estimateSize || (() => ESTIMATED_TRANSCRIPT_ROW_HEIGHT),
        });
        virtualizer._willUpdate();
        setSnapshot({
            virtualItems: virtualizer.getVirtualItems(),
            totalSize: virtualizer.getTotalSize(),
        });
    }, [args.count, args.estimateSize, args.getItemKey, virtualizer]);

    return {
        restoreAnchor: (index, offset) => {
            const position = virtualizer.getOffsetForIndex(index, 'start');
            if (position) virtualizer.scrollToOffset(position[0] + offset, { behavior: 'auto' });
        },
        // `resizeItem` also adjusts the scroll offset when the row sits above the
        // viewport, so expanding an off-screen row does not shift what the reader
        // is looking at.
        resizeItem: (index, size) => { virtualizer.resizeItem(index, size); },
        measureElement: element => {
            if (element) virtualizer.measureElement(element);
        },
        virtualItems,
        totalSize,
    };
}
