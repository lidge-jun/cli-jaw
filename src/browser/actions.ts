import { getActivePage, getCdpSession, getBrowserStateVersion, markBrowserStateChanged, getActiveTab } from './connection.js';
import { JAW_HOME } from '../core/config.js';
import { join } from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { imageSize } from './image-size.js';
import { hitTestInPage } from './occlusion.js';
import { clampClipToViewport } from './verify-candidate.js';
import type { ConsoleMessage, Locator, Page, Request } from 'playwright-core';

const SCREENSHOTS_DIR = join(JAW_HOME, 'screenshots');
const DEFAULT_DOM_MAX_CHARS = 20000;
const TOKEN_PATTERNS = [
    /authorization\s*[:=]\s*[^,\s]+/ig,
    /cookie\s*[:=]\s*[^,\s]+/ig,
    /access_token=[^&\s]+/ig,
    /token=[^&\s]+/ig,
];

type SnapshotNode = {
    ref: string;
    role: string;
    name: string;
    depth: number;
    value?: string;
    occurrence: number;
};

type SnapshotState = {
    snapshotId: string;
    /**
     * Bumped by navigation-ish actions, never by the page changing itself.
     *
     * Read by nothing since the ref cache was removed — its four conditions
     * could not see a DOM mutation, which is why that branch is gone. Kept
     * because the snapshotId round-trip will need to say which browser epoch a
     * caller's snapshot belongs to, and recomputing it later is not free.
     */
    stateVersion: number;
    targetId: string | null;
    url: string;
    nodes: SnapshotNode[];
    /**
     * A digest of the node list, so a shift can be detected at all.
     *
     * A ref is a position in a parse, not a handle on an element. Comparing
     * one node's role, name and occurrence therefore asks whether the LOCATOR
     * would be spelled the same, which is a different question from whether
     * the ELEMENT is the same: delete one row from ten identical ones and
     * every surviving index still carries a byte-identical tuple while naming
     * its neighbour. Only the whole list can say the positions moved.
     */
    digest: string;
};

type ClipRect = { x: number; y: number; width: number; height: number };
type BrowserActionOptions = Record<string, unknown>;
type MouseButton = 'left' | 'right' | 'middle';
type ScreenshotImageType = 'png' | 'jpeg';
type WaitForSelectorState = 'attached' | 'detached' | 'visible' | 'hidden';
type AriaRole = Parameters<Page['getByRole']>[0];
type JsonRecord = Record<string, unknown>;
type CdpAxValue = { value?: unknown };
type CdpAxNode = {
    nodeId?: unknown;
    parentId?: unknown;
    role?: CdpAxValue;
    name?: CdpAxValue;
    value?: CdpAxValue;
    ignored?: unknown;
};
let latestSnapshot: SnapshotState | null = null;
const consoleEntries: Array<{ type: string; text: string; ts: number }> = [];
const networkEntries: Array<{ method: string; url: string; type?: string; source: 'cdp'; ts: number }> = [];
let captureInstalled = false;

// ─── ref snapshot ────────────────────────────────

const INTERACTIVE_ROLES = ['button', 'link', 'textbox', 'checkbox',
    'radio', 'combobox', 'menuitem', 'tab', 'slider', 'searchbox',
    'option', 'switch', 'spinbutton'];

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionBoolean(opts: BrowserActionOptions, key: string): boolean {
    return opts[key] === true;
}

function optionNumber(opts: BrowserActionOptions, key: string, fallback: number): number {
    const value = opts[key];
    const parsed = typeof value === 'number' ? value : Number(value ?? fallback);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function optionMouseButton(opts: BrowserActionOptions): MouseButton {
    const value = opts["button"];
    return value === 'right' || value === 'middle' ? value : 'left';
}

function optionWaitState(opts: BrowserActionOptions): WaitForSelectorState {
    const value = opts["state"];
    if (value === 'attached' || value === 'detached' || value === 'hidden' || value === 'visible') return value;
    return 'visible';
}

function optionScreenshotType(opts: BrowserActionOptions): ScreenshotImageType {
    return opts["type"] === 'jpeg' ? 'jpeg' : 'png';
}

async function requireActivePage(port: number): Promise<Page> {
    const page = await getActivePage(port);
    if (!page) throw new Error('No active page');
    return page;
}

function extractCdpAxNodes(value: unknown): unknown[] {
    return isRecord(value) && Array.isArray(value["nodes"]) ? value["nodes"] : [];
}

function normalizeActiveTargetId(activeTab: Awaited<ReturnType<typeof getActiveTab>>): string | null {
    return activeTab.ok ? activeTab.tab?.targetId || null : null;
}

function asCdpAxNode(value: unknown): CdpAxNode | null {
    return isRecord(value) ? value : null;
}

function cdpValueText(value: unknown): string {
    return isRecord(value) && typeof value["value"] === 'string' ? value["value"] : '';
}

/**
 * Parse Playwright ariaSnapshot YAML into flat node list.
 * Format: "- role \"name\":" or "- role \"name\""
 */
function parseAriaYaml(yaml: string): SnapshotNode[] {
    const nodes: Omit<SnapshotNode, 'occurrence'>[] = [];
    let counter = 0;
    for (const line of yaml.split('\n')) {
        if (!line.trim() || !line.includes('-')) continue;
        const indent = line.search(/\S/);
        const depth = Math.floor(indent / 2);
        // Match: - role "name" or - role "name": or - text: content
        const m = line.match(/-\s+(\w+)(?:\s+"([^"]*)")?/);
        if (!m) continue;
        counter++;
        const role = m[1] || 'unknown';
        const name = m[2] || '';
        nodes.push({ ref: `e${counter}`, role, name, depth });
    }
    return annotateOccurrences(nodes);
}

/**
 * Parse CDP Accessibility.getFullAXTree response into flat node list.
 */
function parseCdpAxTree(axNodes: unknown[]): SnapshotNode[] {
    const nodes: Omit<SnapshotNode, 'occurrence'>[] = [];
    let counter = 0;
    // CDP returns flat list with parentId references; build depth map
    const depthMap: Record<string, number> = {};
    for (const value of axNodes) {
        const n = asCdpAxNode(value);
        if (!n) continue;
        const nodeId = typeof n.nodeId === 'string' ? n.nodeId : '';
        const parentId = typeof n.parentId === 'string' ? n.parentId : '';
        const parentDepth = parentId ? (depthMap[parentId] ?? 0) : -1;
        const depth = parentDepth + 1;
        if (nodeId) depthMap[nodeId] = depth;
        const role = cdpValueText(n.role) || 'unknown';
        const name = cdpValueText(n.name);
        const nodeValue = cdpValueText(n.value);
        if (n.ignored) continue;
        counter++;
        nodes.push({
            ref: `e${counter}`, role, name,
            ...(nodeValue ? { value: nodeValue } : {}),
            depth,
        });
    }
    return annotateOccurrences(nodes);
}

export async function snapshot(port: number, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);

    let nodes;

    // Strategy 1: locator.ariaSnapshot() — works on CDP connections (v1.49+)
    try {
        const yaml = await page.locator('body').ariaSnapshot({ timeout: 10000 });
        nodes = parseAriaYaml(yaml);
    } catch (e1) {
        // Strategy 2: direct CDP Accessibility.getFullAXTree
        try {
            const cdp = await getCdpSession(port);
            if (!cdp) throw new Error('No CDP session available for snapshot fallback');
            const axNodes = extractCdpAxNodes(await cdp.send('Accessibility.getFullAXTree'));
            nodes = parseCdpAxTree(axNodes);
            await cdp.detach().catch(() => { });
        } catch (e2) {
            throw new Error(
                `Snapshot failed.\n  ariaSnapshot: ${(e1 as Error).message}\n  CDP fallback: ${(e2 as Error).message}`
            );
        }
    }

    // The whole parse, held before any filtering. It is what the refs were
    // numbered against and the only view of the page that does not depend on
    // how this particular call was asked.
    const unfiltered = nodes;

    if (opts["interactive"]) {
        nodes = nodes.filter(n => INTERACTIVE_ROLES.includes(n.role));
    }

    const total = nodes.length;
    const maxNodes = optionNumber(opts, 'maxNodes', optionNumber(opts, 'max-nodes', 0));
    if (Number.isInteger(maxNodes) && maxNodes > 0) nodes = nodes.slice(0, maxNodes);
    const activeTab = await getActiveTab(port).catch(() => ({ ok: false as const }));
    latestSnapshot = {
        snapshotId: `snap_${Date.now()}`,
        stateVersion: getBrowserStateVersion(),
        targetId: normalizeActiveTargetId(activeTab),
        url: page.url(),
        nodes,
        // Digest the UNFILTERED parse, not the list being returned.
        //
        // `interactive` and `maxNodes` shape what a caller is shown; they say
        // nothing about the page. Fingerprinting the shown list would make the
        // digest depend on the request, so a later lookup that re-snapshots
        // with different options would compare 40 interactive nodes against
        // 400 unfiltered ones and conclude the page moved every single time —
        // on a page that had not changed by one byte.
        digest: snapshotDigest(unfiltered),
    };
    // `digest` is DIAGNOSTIC. A caller can hold it to see whether the page
    // changed between two snapshots it took itself, but it is not a token: ref
    // lookups compare against the most recent internal parse, which rotates
    // whenever anything re-snapshots, so a held digest does not mean "my refs
    // were validated against what I saw". Binding the check to the caller's
    // own observation needs the snapshotId round-trip, which is its own unit.
    if (opts["json"]) {
        return {
            nodes,
            meta: { total, shown: nodes.length, snapshotId: latestSnapshot.snapshotId, digest: latestSnapshot.digest, digestIsDiagnostic: true },
        };
    }
    return nodes;
}

function annotateOccurrences(nodes: Omit<SnapshotNode, 'occurrence'>[]): SnapshotNode[] {
    const counts = new Map<string, number>();
    return nodes.map((node) => {
        const key = `${node.role}\u0000${node.name}`;
        const occurrence = counts.get(key) || 0;
        counts.set(key, occurrence + 1);
        return { ...node, occurrence };
    });
}

/**
 * A fingerprint of the parse a set of refs came from.
 *
 * Includes `depth` because a node moving between parents changes what a ref
 * means without changing its role or name, and the node count because an
 * insertion and a deletion elsewhere can otherwise cancel out.
 *
 * This is deliberately coarse. It answers "is this the same list of nodes in
 * the same order", which is the only question positional refs can be honest
 * about — not "is this the same page", which is a claim the accessibility
 * tree cannot make.
 */
export function snapshotDigest(nodes: Array<Pick<SnapshotNode, 'role' | 'name' | 'depth'>>): string {
    const h = createHash('sha1');
    h.update(String(nodes.length));
    for (const n of nodes) {
        h.update('\u0000');
        h.update(n.role);
        h.update('\u0000');
        h.update(n.name);
        h.update('\u0000');
        h.update(String(n.depth));
    }
    return h.digest('hex').slice(0, 16);
}

/**
 * The locator for a snapshot node — one form, used everywhere.
 *
 * Two call sites used to build this independently and they diverged by exactly
 * one option. Measuring used `exact: true`; clicking did not, and Playwright
 * turns a missing `exact` into substring AND case-insensitive matching
 * (`nameOp` becomes `*=`, `caseSensitive` becomes false). Meanwhile
 * `annotateOccurrences` counts `occurrence` over the EXACT `role\0name` key,
 * so `.nth(occurrence)` is only meaningful against the exact match set. On the
 * substring path it indexed into a different, larger one.
 *
 * What that produced: a page with "Save all" before "Save" gives both nodes
 * occurrence 0 under different keys. The box recorded for the Save ref is
 * Save's. The click for the same ref resolves the substring set
 * ["Save all", "Save"] and `.nth(0)` is SAVE ALL. Reconciliation confirmed the
 * point was inside Save, the occlusion check cleared Save's box, and the click
 * landed on Save all — reported as `via: 'ref'`, which reads as more
 * trustworthy than a coordinate.
 *
 * An empty name is NOT the same as no name. Dropping the option matches every
 * element of the role while `occurrence` was counted only among the unnamed
 * ones — the same misalignment, one key over. `{ name: '', exact: true }`
 * matches exactly the elements whose normalized accessible name is empty.
 *
 * That is not quite the set the counting used, and the difference is worth
 * naming: `parseAriaYaml` assigns `name = m[2] || ''`, so a name its regex
 * failed to capture is folded into the same empty bucket as a genuinely
 * unnamed node. The DOM set can therefore be strictly smaller than the counted
 * one. This is still the right locator — it is the closest honest expression
 * of "the node had no name" — but the residual risk lives in the parser, not
 * here.
 *
 * A name the parser truncated (its regex loses everything after an embedded
 * quote) matches nothing under either form — the mangled string is not a
 * substring of the real accessible name either — so exact matching costs no
 * reach here. What it costs is time: a locator matching nothing waits out its
 * timeout, which is why the measurement loop below asks `count()` first.
 */
export function locatorForNode(page: Page, node: Pick<SnapshotNode, 'role' | 'name' | 'occurrence'>): Locator {
    return page
        // `name` is a non-optional string and both parsers emit '' for an
        // absent one, so the empty string is the normal input here, not a
        // defensive fallback.
        .getByRole(node.role as AriaRole, { name: node.name, exact: true })
        .nth(node.occurrence || 0);
}

// ─── ref → locator ─────────────────────────────

/**
 * Re-find a node the caller saw, after the list it came from moved.
 *
 * A shifted list makes the REF meaningless without making the INTENT
 * meaningless: if what the caller pointed at is still there and still
 * unambiguous, that is the element they meant.
 *
 * Uniqueness in the fresh list is not enough to say so, which is the trap this
 * function exists inside. Two rows each carrying `button "Delete"`, the caller
 * points at the first, the page removes that row — now exactly one Delete
 * remains, and resolving to it deletes the OTHER row. Removal is what
 * manufactured the uniqueness, so the rule is at its weakest precisely when
 * the caller's element is the thing that went away. That is the original
 * defect reproduced inside its own fix, on an operation nobody can undo.
 *
 * So uniqueness must hold on BOTH sides. A name that was unique before and is
 * unique now is the same element by any reading available here. A set that
 * shrank to one is ambiguous, not recovered.
 *
 * `depth` participates because the digest uses it: the key that decides which
 * element to click should not be weaker than the key that decides whether to
 * be suspicious. An empty name is not identifying at all — `parseAriaYaml`
 * folds a name its regex failed to capture into the same bucket as a genuinely
 * unnamed node, so recovering `button ""` to some other `button ""` would be a
 * wrong click justified by a parser artifact.
 */
export function recoverNode(
    previous: SnapshotNode,
    previousAll: SnapshotNode[],
    fresh: SnapshotNode[],
): SnapshotNode | 'ambiguous' | 'absent' | 'moved' {
    if (!previous.name) return 'ambiguous';
    const same = (n: SnapshotNode) =>
        n.role === previous.role && n.name === previous.name && n.depth === previous.depth;
    if (previousAll.filter(same).length !== 1) return 'ambiguous';
    const matches = fresh.filter(same);
    if (matches.length === 1) return matches[0] as SnapshotNode;
    if (matches.length > 1) return 'ambiguous';
    // Nothing at that role, name AND depth. The element may still be on the
    // page one level in or out — a modal wrapped it, a section above it
    // expanded — so "absent" would be a claim this cannot support. Only when
    // the role and name are gone entirely is it really gone.
    return fresh.some(n => n.role === previous.role && n.name === previous.name)
        ? 'moved'
        : 'absent';
}

async function refToLocator(page: Page, port: number, ref: string): Promise<Locator> {
    // Capture the basis BEFORE anything can replace it. `snapshot()` assigns
    // `latestSnapshot` before it returns, so reading the module state after
    // the call would compare the fresh parse against itself — a check that
    // passes unconditionally and looks like it is working.
    const previousState = latestSnapshot;
    // There is no cache branch any more, and its absence is the point.
    //
    // It used to resolve a ref straight out of the stored parse when the tab,
    // URL and state version all matched. None of those can see a DOM
    // mutation — `click` and `type` do not bump the state version — and
    // `occurrence` is not a handle: it becomes `.nth(occurrence)` against the
    // LIVE DOM at click time, so a feed prepending one same-named element
    // silently shifted every index. That was the one remaining route to a
    // locator with no freshness check at all.
    //
    // It also almost never ran. `resolveActiveTargetId` returns null unless
    // `verifiedActiveTargetId` was set, which only `switchTab` and one branch
    // of `createTab` do, so `previousState.targetId` was falsy and the guard
    // failed on every ordinary navigate-snapshot-click flow. Keeping it would
    // have preserved an unguarded path for the benefit of two callers, and a
    // cache that cannot be validated without re-snapshotting is not a cache.
    const fresh = await snapshot(port) as SnapshotNode[];
    const node = fresh.find(n => n.ref === ref);

    // No previous parse at all: there is no claim to contradict, so the lookup
    // proceeds. That is the fail-open posture `assertFreshObservationBundle`
    // takes for a MISSING value.
    if (!previousState) {
        if (!node) throw new Error(`ref ${ref} not found — re-run snapshot`);
        return locatorForNode(page, node);
    }

    // A basis taken of a DIFFERENT page is the opposite case, and folding the
    // two together was a mistake: an absent basis says nothing, while a basis
    // from another URL is affirmative evidence that every positional ref is
    // meaningless. The precedent says so too —
    // `assertFreshObservationBundle` throws on a known URL mismatch and fails
    // open only when a side is absent.
    if (previousState.url !== page.url()) {
        throw new Error(
            `ref ${ref} was taken on ${previousState.url} and the page is now ${page.url()} — re-run snapshot`,
        );
    }

    const moved = previousState.digest !== snapshotDigest(fresh);
    if (!moved) {
        if (!node) throw new Error(`ref ${ref} not found — re-run snapshot`);
        return locatorForNode(page, node);
    }

    // The list moved, so this ref is a position that no longer means what it
    // meant. Recover by intent rather than by index.
    const was = previousState.nodes.find(n => n.ref === ref);
    if (!was) throw new Error(`ref ${ref} not found — re-run snapshot`);

    const recovered = recoverNode(was, previousState.nodes, fresh);
    if (recovered === 'absent') {
        throw new Error(
            `ref ${ref} named ${was.role} "${was.name}", which is no longer on the page — re-run snapshot`,
        );
    }
    if (recovered === 'moved') {
        throw new Error(
            `ref ${ref} named ${was.role} "${was.name}", which is still on the page but somewhere else in the tree — re-run snapshot`,
        );
    }
    if (recovered === 'ambiguous') {
        throw new Error(
            `the page changed and ref ${ref} (${was.role} "${was.name}") is now one of several — re-run snapshot`,
        );
    }
    return locatorForNode(page, recovered);
}

/**
 * What would receive a click at a viewport point.
 *
 * Returns null when the check cannot run, which callers must treat as
 * "unknown" rather than "clear".
 */
export async function hitTestPoint(
    port: number,
    point: { x: number; y: number },
    targetPoint?: { x: number; y: number },
): Promise<import('./occlusion.js').HitResult | null> {
    try {
        const page = await requireActivePage(port);
        // A function, not a source string: Playwright only invokes the former.
        const result = await page.evaluate(hitTestInPage, { ...point, ...(targetPoint ? { targetPoint } : {}) });
        return (result ?? null) as import('./occlusion.js').HitResult | null;
    } catch {
        return null;
    }
}

// ─── screenshot ────────────────────────────────

/**
 * Element rectangles for the current snapshot's refs, in CSS pixels.
 *
 * This is the missing half of reconciliation: `candidate-reconcile.ts` has
 * been in the tree with no caller because nothing supplied boxes. Asking the
 * browser where an element is beats asking a model to estimate it, so the
 * structural answer comes first and vision fills the gaps.
 *
 * Boxes are resolved one ref at a time through the existing locator path, so
 * they inherit whatever staleness discipline `refToLocator` has. Refs whose
 * element is detached, hidden, or zero-area are omitted rather than reported
 * with a meaningless rectangle — an absent box is a truthful answer.
 */
/**
 * Which page is in front, and nothing else.
 *
 * Freshness is a safety question and it must not be answered as a side effect
 * of an expensive, failure-prone, opt-out-able geometry capture. `elementBoxes`
 * happens to return the same identity, but measuring two hundred elements to
 * learn a URL means a caller who declines reconciliation also declines the
 * navigation guard. This costs one CDP round-trip and cannot be turned off.
 *
 * Returns null when identity cannot be read. That is "unknown", not "changed":
 * a failed probe says nothing about the page, and refusing every click because
 * a diagnostic call failed would be a denial of service of our own making.
 */
export async function observePageIdentity(
    port: number,
): Promise<{ url: string; targetId: string | null } | null> {
    try {
        const page = await requireActivePage(port);
        const activeTab = await getActiveTab(port).catch(() => ({ ok: false as const }));
        return { url: page.url(), targetId: normalizeActiveTargetId(activeTab) };
    } catch {
        return null;
    }
}

export async function elementBoxes(
    port: number,
    opts: { interactive?: boolean; limit?: number; budgetMs?: number } = {},
): Promise<{ url: string; targetId: string | null; refs: Array<{ ref: string; role: string; name: string; box: { x: number; y: number; width: number; height: number } }>; truncated: boolean }> {
    const page = await requireActivePage(port);
    // Read the current snapshot WITHOUT replacing the module cache. Overwriting
    // it with an interactive-only subset would make a later click on a
    // non-interactive ref fail with "ref not found" even though nothing on the
    // page had changed — this function must not degrade the discipline that
    // other callers depend on.
    const preserved = latestSnapshot;
    let nodes: SnapshotNode[];
    try {
        nodes = await snapshot(port, { interactive: opts.interactive !== false }) as SnapshotNode[];
    } finally {
        latestSnapshot = preserved;
    }

    // The cap is not what keeps this fast — the deadline is. A cap of 200 made
    // `truncated` true on most real pages (Hacker News has ~227 interactive
    // nodes, a Wikipedia article ~497), which turns a rare signal into a
    // constant one and would make any refusal keyed on it fire everywhere.
    const limit = Math.max(1, Math.min(opts.limit ?? 500, 1000));
    // A serial loop of per-element measurements can otherwise run for minutes
    // on a heavy page. Reconciliation is worth a moment, not a minute.
    //
    // Sized against the cap rather than guessed. Real elements have real
    // layout: measured p50 is ~11ms on a Wikipedia article, not the ~2ms a
    // page of trivial buttons suggests, so a full 500-node capture costs a
    // little over five seconds. A 5s budget left the cap it was paired with
    // unreachable — the capture would truncate by deadline on exactly the
    // pages the larger cap was meant to cover, which is the same signal
    // constantly true, arriving one step later.
    const budgetMs = Math.max(500, Math.min(opts.budgetMs ?? 8000, 30000));
    const deadline = Date.now() + budgetMs;
    const refs: Array<{ ref: string; role: string; name: string; box: { x: number; y: number; width: number; height: number } }> = [];
    // The node cap drops elements just as silently as the deadline does. Only
    // the deadline used to set this, so a page with 500 interactive nodes
    // reported `truncated: false` while 300 were never looked at — and the
    // cap drops LATE nodes, which is where modals and cookie banners live.
    let truncated = nodes.length > limit;

    for (const node of nodes.slice(0, limit)) {
        if (Date.now() >= deadline) { truncated = true; break; }
        try {
            // Same construction as the click path, because a box that
            // describes a different element than the one that will be clicked
            // is worse than no box at all.
            const locator = locatorForNode(page, node);
            // Ask whether the element is there before spending a wait on it.
            //
            // A locator that matches nothing burns its entire timeout, and
            // exact matching makes that more likely than substring did — a
            // name the parser mangled now matches nothing rather than matching
            // something wrong. Measured, a miss costs 8ms here against the
            // 250ms it used to, and an occurrence index past the end of the
            // match set is caught just as cheaply.
            //
            // This is a speed guarantee, not a correctness one. `count()`
            // answers about the DOM as it is right now, so an element that the
            // snapshot saw but that is absent at measurement time — lazy
            // hydration mid-capture, a React remount — is skipped here where
            // `boundingBox` alone would have auto-waited and found it. That
            // trade is deliberate: the snapshot is the observation, and a node
            // that is not in the document when we look for it has no box to
            // report. Shortening the timeout instead would have dropped the
            // same elements AND the slow-but-present ones.
            if (await locator.count() === 0) continue;
            const box = await locator.boundingBox({ timeout: 250 });
            // A zero-area box cannot contain a point, so it would only add noise.
            if (!box || box.width <= 0 || box.height <= 0) continue;
            refs.push({ ref: node.ref, role: node.role, name: node.name, box });
        } catch {
            // Detached, hidden, ambiguous, or timed out: no box, and an absent
            // box is a truthful answer.
        }
    }

    const activeTab = await getActiveTab(port).catch(() => ({ ok: false as const }));
    return { url: page.url(), targetId: normalizeActiveTargetId(activeTab), refs, truncated };
}

export async function screenshot(port: number, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    const type = optionScreenshotType(opts);
    const filename = `screenshot_${Date.now()}.${type}`;
    const filepath = join(SCREENSHOTS_DIR, filename);

    const clip = normalizeClip(opts["clip"]);
    if (opts["ref"] && clip) throw new Error('screenshot cannot combine ref and clip');
    // The rectangle actually captured, which is what a caller must offset
    // against. Returning the REQUESTED clip after Playwright trimmed it is how
    // a coordinate ends up describing a region that was never in the image.
    let clipUsed = clip;
    if (opts["ref"]) {
        const locator = await refToLocator(page, port, String(opts["ref"]));
        await locator.screenshot({ path: filepath, type });
    } else {
        // A clip past the viewport edge is trimmed by Playwright before
        // capture, and one entirely outside fails with an opaque assertion.
        // Clamp here so the caller gets the rectangle that was actually used
        // and a named error when there is no usable area at all.
        const measured = clip
            ? await page.evaluate('({ width: window.innerWidth, height: window.innerHeight })') as { width: number; height: number }
            : null;
        const fitted = clip && measured ? clampClipToViewport(clip, measured) : null;
        if (fitted) clipUsed = fitted.clip;
        await page.screenshot({
            path: filepath,
            fullPage: optionBoolean(opts, 'fullPage'),
            type,
            ...(fitted ? { clip: fitted.clip } : {}),
        });
    }
    const dpr = await page.evaluate('window.devicePixelRatio');
    // `viewportSize()` is null under connectOverCDP, which Playwright attaches
    // with noDefaultViewport. Fall back to the page's own measurement so
    // callers that need a frame get one.
    const viewport = page.viewportSize()
        ?? await page.evaluate('({ width: window.innerWidth, height: window.innerHeight })') as { width: number; height: number };
    // The size of the file that was actually written, which is what a model
    // sees. A clip is trimmed to the viewport before capture, so the requested
    // rectangle is not a reliable stand-in.
    const image = imageSize(filepath);
    // url and targetId let a caller tell whether the page it is reasoning
    // about is still the page in front of it. A vision round-trip takes
    // seconds, and a point derived from this capture is meaningless if the
    // tab navigated in the meantime.
    const shotTab = await getActiveTab(port).catch(() => ({ ok: false as const }));
    return {
        path: filepath,
        dpr,
        viewport,
        url: page.url(),
        targetId: normalizeActiveTargetId(shotTab),
        ...(image ? { image } : {}),
        // The clip that was captured, not the one requested.
        ...(clipUsed ? { clip: clipUsed } : {}),
    };
}


function normalizeClip(value: unknown): ClipRect | undefined {
    if (!value) return undefined;
    const clip = Array.isArray(value)
        ? { x: Number(value[0]), y: Number(value[1]), width: Number(value[2]), height: Number(value[3]) }
        : isRecord(value)
            ? { x: Number(value["x"]), y: Number(value["y"]), width: Number(value["width"]), height: Number(value["height"]) }
            : { x: Number.NaN, y: Number.NaN, width: Number.NaN, height: Number.NaN };
    if (![clip.x, clip.y, clip.width, clip.height].every(Number.isFinite)) throw new Error('invalid clip');
    if (clip.x < 0 || clip.y < 0 || clip.width <= 0 || clip.height <= 0) throw new Error('invalid clip');
    return clip;
}

// ─── actions ───────────────────────────────────

export async function click(port: number, ref: string, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    const locator = await refToLocator(page, port, ref);
    if (optionBoolean(opts, 'doubleClick')) await locator.dblclick();
    else await locator.click({ button: optionMouseButton(opts) });
    return { ok: true, url: page.url() };
}

export async function type(port: number, ref: string, text: string, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    const locator = await refToLocator(page, port, ref);
    await locator.fill(text);
    if (optionBoolean(opts, 'submit')) await page.keyboard.press('Enter');
    return { ok: true };
}

export async function press(port: number, key: string) {
    const page = await requireActivePage(port);
    await page.keyboard.press(key);
    return { ok: true };
}

export async function hover(port: number, ref: string) {
    const page = await requireActivePage(port);
    const locator = await refToLocator(page, port, ref);
    await locator.hover();
    return { ok: true };
}

export interface NavigateOptions {
    waitUntil?: 'commit' | 'load' | 'domcontentloaded' | 'networkidle';
    timeout?: number;
}

export async function navigate(port: number, url: string, opts: NavigateOptions = {}) {
    const page = await requireActivePage(port);
    const waitUntil = opts.waitUntil ?? 'domcontentloaded';
    const timeout = Number.isFinite(opts.timeout) ? opts.timeout! : 30000;
    let degraded: string | null = null;
    const isCoopBlock = (e: unknown) =>
        /ERR_BLOCKED_BY_RESPONSE|Cross-Origin-Opener-Policy/i.test(((e as { message?: string })?.message) || String(e));
    const isTimeout = (e: unknown) =>
        /Timeout|timeout/.test(((e as { message?: string })?.message) || String(e));
    const checkHealthy = async () => {
        try {
            const dims = await page.evaluate(() => {
                const w = (globalThis as unknown as { innerWidth?: number }).innerWidth || 0;
                const h = (globalThis as unknown as { innerHeight?: number }).innerHeight || 0;
                return { w, h };
            });
            return dims && dims.w > 0 && dims.h > 0;
        } catch { return false; }
    };
    try {
        await page.goto(url, { waitUntil, timeout });
    } catch (err) {
        if (isCoopBlock(err)) {
            try {
                await page.goto('about:blank', { waitUntil: 'commit', timeout: 5000 });
                await page.goto(url, { waitUntil, timeout });
                degraded = 'fallback:about:blank (COOP block on direct navigate)';
            } catch (err2) {
                if (isTimeout(err2)) {
                    await page.goto(url, { waitUntil: 'commit', timeout });
                    degraded = 'fallback:about:blank+commit (COOP + timeout)';
                } else {
                    throw err2;
                }
            }
        } else if (isTimeout(err) && waitUntil !== 'commit') {
            await page.goto(url, { waitUntil: 'commit', timeout });
            degraded = `fallback:commit (initial waitUntil=${waitUntil} timed out)`;
        } else {
            throw err;
        }
    }
    if (!(await checkHealthy())) {
        try {
            await page.goto('about:blank', { waitUntil: 'commit', timeout: 5000 });
            await page.goto(url, { waitUntil, timeout });
            degraded = `${degraded ? degraded + '; ' : ''}fallback:about:blank (post-nav 0-width recovery)`;
        } catch { /* keep landed state */ }
    }
    markBrowserStateChanged();
    return { ok: true, url: page.url(), degraded };
}

export async function evaluate(port: number, expression: string) {
    const page = await requireActivePage(port);
    const result = await page.evaluate(expression);
    return { ok: true, result };
}

export async function getPageText(port: number, format = 'text') {
    const page = await requireActivePage(port);
    if (format === 'html') return { text: await page.content() };
    return { text: await page.innerText('body') };
}

export async function getDom(port: number, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    const selector = String(opts["selector"] || 'body');
    if (!selector.trim() || selector.includes('\0')) throw new Error('invalid selector');
    const maxChars = Math.max(1, optionNumber(opts, 'maxChars', optionNumber(opts, 'max-chars', DEFAULT_DOM_MAX_CHARS)));
    const locator = page.locator(selector).first();
    const html = selector === 'body' ? await page.content() : await locator.evaluate((el: { outerHTML: string }) => el.outerHTML);
    const truncated = html.length > maxChars;
    return { html: truncated ? html.slice(0, maxChars) : html, selector, truncated, chars: Math.min(html.length, maxChars), totalChars: html.length };
}

export async function waitForSelector(port: number, selector: string, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    await page.waitForSelector(selector, {
        timeout: optionNumber(opts, 'timeout', 30000),
        state: optionWaitState(opts),
    });
    return { ok: true };
}

export async function waitForText(port: number, text: string, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    await page.getByText(text).first().waitFor({ timeout: optionNumber(opts, 'timeout', 30000), state: 'visible' });
    return { ok: true };
}

export async function reload(port: number) {
    const page = await requireActivePage(port);
    await page.reload({ waitUntil: 'domcontentloaded' });
    markBrowserStateChanged();
    return { ok: true, url: page.url() };
}

export async function resize(port: number, width: number, height: number) {
    const page = await requireActivePage(port);
    await page.setViewportSize({ width, height });
    markBrowserStateChanged();
    return { ok: true, viewport: page.viewportSize() };
}

export async function scroll(port: number, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    const x = optionNumber(opts, 'x', 0);
    const y = optionNumber(opts, 'y', 0);
    if (opts["ref"]) {
        const locator = await refToLocator(page, port, String(opts["ref"]));
        await locator.evaluate((el: { scrollBy(x: number, y: number): void }, delta: { x: number; y: number }) => el.scrollBy(delta.x, delta.y), { x, y });
    } else {
        await page.mouse.wheel(x, y);
    }
    return { ok: true };
}

export async function select(port: number, ref: string, values: string[]) {
    const page = await requireActivePage(port);
    const locator = await refToLocator(page, port, ref);
    const selected = await locator.selectOption(values);
    return { ok: true, selected };
}

export async function drag(port: number, fromRef: string, toRef: string) {
    const page = await requireActivePage(port);
    const from = await refToLocator(page, port, fromRef);
    const to = await refToLocator(page, port, toRef);
    await from.dragTo(to);
    return { ok: true };
}

export async function mouseMove(port: number, x: number, y: number) {
    const page = await requireActivePage(port);
    await page.mouse.move(x, y);
    return { ok: true };
}

export async function mouseDown(port: number, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    await page.mouse.down({ button: optionMouseButton(opts) });
    return { ok: true };
}

export async function mouseUp(port: number, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    await page.mouse.up({ button: optionMouseButton(opts) });
    return { ok: true };
}

function redactText(input: string, maxTextLength = 2000) {
    let text = input.slice(0, maxTextLength);
    for (const pattern of TOKEN_PATTERNS) text = text.replace(pattern, '[redacted]');
    return text;
}

async function ensureCaptureInstalled(port: number) {
    if (captureInstalled) return;
    const page = await requireActivePage(port);
    page.on('console', (msg: ConsoleMessage) => {
        consoleEntries.push({ type: msg.type(), text: redactText(msg.text()), ts: Date.now() });
        if (consoleEntries.length > 500) consoleEntries.shift();
    });
    page.on('request', (req: Request) => {
        const parsed = new URL(req.url());
        networkEntries.push({
            method: req.method(),
            url: `${parsed.origin}${parsed.pathname}`,
            type: req.resourceType?.(),
            source: 'cdp',
            ts: Date.now(),
        });
        if (networkEntries.length > 500) networkEntries.shift();
    });
    captureInstalled = true;
}

export async function getConsole(port: number, opts: BrowserActionOptions = {}) {
    await ensureCaptureInstalled(port);
    if (opts["clear"]) consoleEntries.length = 0;
    const limit = Math.max(1, optionNumber(opts, 'limit', 50));
    const maxTextLength = Math.max(1, optionNumber(opts, 'maxTextLength', 2000));
    return { entries: consoleEntries.slice(-limit).map(e => ({ ...e, text: redactText(e.text, maxTextLength) })) };
}

export async function getNetwork(port: number, opts: BrowserActionOptions = {}) {
    await ensureCaptureInstalled(port);
    const limit = Math.max(1, optionNumber(opts, 'limit', 50));
    const filter = opts["filter"] ? String(opts["filter"]) : '';
    const entries = networkEntries
        .filter(e => !filter || e.url.includes(filter))
        .slice(-limit)
        .map(e => {
            const parsed = new URL(e.url);
            return { method: e.method, origin: parsed.origin, path: parsed.pathname, type: e.type, source: e.source, redacted: true };
        });
    return { entries };
}

/** Click at pixel coordinates (vision-click support) */
export async function mouseClick(port: number, x: number, y: number, opts: BrowserActionOptions = {}) {
    const page = await requireActivePage(port);
    if (optionBoolean(opts, 'doubleClick')) await page.mouse.dblclick(x, y);
    else await page.mouse.click(x, y, { button: optionMouseButton(opts) });
    return { success: true, clicked: { x, y } };
}
