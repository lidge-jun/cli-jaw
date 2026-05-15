// @ts-nocheck
// Mirrored from agbrowse adaptive-fetch v1; keep runtime behavior aligned while cli-jaw mirror remains experimental.

import { findBoundaryMarkers } from './validators.js';

/**
 * @param {{ url?: string, status?: number, text?: string, title?: string }} input
 */
export function detectChallengeMarkers(input = {}) {
    return findBoundaryMarkers(`${input.url || ''}\n${input.status || ''}\n${input.title || ''}\n${input.text || ''}`);
}

/**
 * @param {{ kind: string }[]} markers
 */
export function classifyAccessBoundary(markers = []) {
    if (markers.some(marker => marker.kind === 'auth')) return 'auth_required';
    if (markers.some(marker => marker.kind === 'paywall')) return 'paywall';
    if (markers.some(marker => marker.kind === 'challenge')) return 'challenge';
    return null;
}
