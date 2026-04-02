// ── Virtual Scroll ──
// Activates at THRESHOLD messages to prevent DOM bloat
// Below threshold: standard DOM append (zero overhead)

const THRESHOLD = 200;
const BUFFER = 5;
const EST_HEIGHT = 80;

export interface VirtualItem {
    id: string;
    html: string;
    height: number;
}

export class VirtualScroll {
    private items: VirtualItem[] = [];
    private container: HTMLElement;
    private spacerTop: HTMLDivElement;
    private spacerBottom: HTMLDivElement;
    private viewport: HTMLDivElement;
    private _active = false;
    private rafId: number | null = null;
    private firstVisible = 0;
    private lastVisible = 0;

    constructor(containerId: string) {
        this.container = document.getElementById(containerId)!;
        this.spacerTop = document.createElement('div');
        this.spacerTop.className = 'vs-spacer-top';
        this.spacerBottom = document.createElement('div');
        this.spacerBottom.className = 'vs-spacer-bottom';
        this.viewport = document.createElement('div');
        this.viewport.className = 'vs-viewport';
    }

    get active(): boolean { return this._active; }
    get count(): number { return this.items.length; }

    /** Flush all virtual items to real DOM and deactivate VS.
     *  Called before live message append to prevent spacer/DOM conflicts. */
    flushToDOM(): void {
        if (!this._active) return;
        this.container.removeEventListener('scroll', this.scrollHandler);
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
        // Render all items as real DOM nodes
        this.container.innerHTML = this.items.map(it => it.html).join('');
        this._active = false;
        this.firstVisible = 0;
        this.lastVisible = 0;
        // Release items to free memory (DOM now owns the content)
        this.items = [];
    }

    addItem(id: string, html: string): void {
        this.items.push({ id, html, height: EST_HEIGHT });
        if (!this._active && this.items.length >= THRESHOLD) {
            this.activate();
        }
        if (this._active) {
            this.scheduleRender();
        }
    }

    private scrollHandler = () => this.scheduleRender();

    private activate(): void {
        this._active = true;
        // Measure existing DOM nodes
        const existing = this.container.querySelectorAll('.msg');
        existing.forEach((el, i) => {
            if (this.items[i]) {
                this.items[i].height = el.getBoundingClientRect().height;
            }
        });
        // Replace DOM with virtual structure
        this.container.innerHTML = '';
        this.container.append(this.spacerTop, this.viewport, this.spacerBottom);
        this.container.addEventListener('scroll', this.scrollHandler, { passive: true });
        this.render();
    }

    private scheduleRender(): void {
        if (this.rafId) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.render();
        });
    }

    private render(): void {
        const scrollTop = this.container.scrollTop;
        const viewHeight = this.container.clientHeight;

        // Binary-ish search for start index
        let accum = 0;
        let startIdx = 0;
        for (let i = 0; i < this.items.length; i++) {
            if (accum + this.items[i].height > scrollTop) {
                startIdx = i;
                break;
            }
            accum += this.items[i].height;
        }

        const first = Math.max(0, startIdx - BUFFER);
        let endAccum = accum;
        let endIdx = startIdx;
        for (let i = startIdx; i < this.items.length; i++) {
            endAccum += this.items[i].height;
            endIdx = i;
            if (endAccum > scrollTop + viewHeight) break;
        }
        const last = Math.min(this.items.length - 1, endIdx + BUFFER);

        // Skip re-render if range unchanged
        if (first === this.firstVisible && last === this.lastVisible) return;
        this.firstVisible = first;
        this.lastVisible = last;

        // Compute spacer heights
        let topSpace = 0;
        for (let i = 0; i < first; i++) topSpace += this.items[i].height;
        let bottomSpace = 0;
        for (let i = last + 1; i < this.items.length; i++) bottomSpace += this.items[i].height;

        this.spacerTop.style.height = `${topSpace}px`;
        this.spacerBottom.style.height = `${bottomSpace}px`;

        // Render visible items
        const frag = document.createDocumentFragment();
        for (let i = first; i <= last; i++) {
            const item = this.items[i];
            const div = document.createElement('div');
            div.innerHTML = item.html;
            const el = div.firstElementChild as HTMLElement;
            if (el) {
                el.dataset.vsIdx = String(i);
                frag.appendChild(el);
            }
        }
        this.viewport.innerHTML = '';
        this.viewport.appendChild(frag);

        // Re-measure rendered heights
        this.viewport.querySelectorAll('[data-vs-idx]').forEach(el => {
            const idx = Number((el as HTMLElement).dataset.vsIdx);
            if (this.items[idx]) {
                this.items[idx].height = el.getBoundingClientRect().height;
            }
        });
    }

    scrollToBottom(): void {
        const total = this.items.reduce((sum, it) => sum + it.height, 0);
        this.container.scrollTop = total;
        this.scheduleRender();
    }

    clear(): void {
        this.items = [];
        if (this._active) {
            this.container.removeEventListener('scroll', this.scrollHandler);
            // Restore normal DOM structure
            this.viewport.innerHTML = '';
            this.spacerTop.style.height = '0';
            this.spacerBottom.style.height = '0';
            this.container.innerHTML = '';
        }
        this._active = false;
        this.firstVisible = 0;
        this.lastVisible = 0;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }
}

// Singleton instance
let instance: VirtualScroll | null = null;

export function getVirtualScroll(): VirtualScroll {
    if (!instance) {
        instance = new VirtualScroll('chatMessages');
    }
    return instance;
}

export { THRESHOLD as VS_THRESHOLD };
