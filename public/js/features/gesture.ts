// ── Touch Gestures ──
// Swipe from screen edges to toggle sidebars on mobile

import { toggleLeft, toggleRight } from './sidebar.js';

const SWIPE_THRESHOLD = 50;
const EDGE_ZONE = 30;
const MAX_Y_DRIFT = 80;
const MAX_TIME = 500;

interface TouchState {
    startX: number;
    startY: number;
    startTime: number;
    isEdge: 'left' | 'right' | null;
}

let touch: TouchState | null = null;
let initialized = false;

export function initGestures(): void {
    if (initialized || !('ontouchstart' in window)) return;
    initialized = true;

    const chat = document.querySelector('.chat-area') as HTMLElement | null;
    if (!chat) return;

    chat.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
    chat.addEventListener('touchend', onTouchEnd as EventListener, { passive: true });
}

function onTouchStart(e: TouchEvent): void {
    const t = e.touches[0];
    const vw = window.innerWidth;

    let isEdge: 'left' | 'right' | null = null;
    if (t.clientX < EDGE_ZONE) isEdge = 'left';
    else if (t.clientX > vw - EDGE_ZONE) isEdge = 'right';

    touch = {
        startX: t.clientX,
        startY: t.clientY,
        startTime: Date.now(),
        isEdge,
    };
}

function onTouchEnd(e: TouchEvent): void {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.startX;
    const dy = Math.abs(t.clientY - touch.startY);
    const dt = Date.now() - touch.startTime;
    const prev = touch;
    touch = null;

    if (dy > MAX_Y_DRIFT || dt > MAX_TIME || Math.abs(dx) < SWIPE_THRESHOLD) return;

    if (dx > 0 && prev.isEdge === 'left') toggleLeft();
    if (dx < 0 && prev.isEdge === 'right') toggleRight();
}
