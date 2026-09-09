import { existsSync, watch, type FSWatcher } from 'node:fs';
import { dashboardPath } from '../dashboard-home.js';

/**
 * Design store watcher (Notes pattern: fs.watch + debounced version bump).
 * The frontend polls the version and reloads; `rescan` stays the
 * authoritative recovery path when watching is unavailable.
 */

const DEBOUNCE_MS = 300;

let watcher: FSWatcher | null = null;
let version = 0;
let debounceTimer: NodeJS.Timeout | null = null;

export function designStoreVersion(): number {
    return version;
}

export function bumpDesignStoreVersion(): void {
    version += 1;
}

export function startDesignWatcher(): boolean {
    if (watcher) return true;
    const root = dashboardPath('design');
    if (!existsSync(root)) return false;
    try {
        // persistent:false, not unref(), is what actually releases the loop here.
        // Linux has no native recursive watch, so node builds one in JS
        // (lib/fs.js: `if (options.recursive && !isMacOS && !isWindows)`), and that
        // implementation's unref() only walks #files for StatWatcher entries — the
        // per-directory FSWatchers in #watchers are never unref'ed, and a new one is
        // added for every directory that appears after the start. A short-lived
        // process therefore never exited on Linux while a page directory was created
        // under the design root. persistent is forwarded to every inner watcher and
        // to the native macOS/Windows path, so it holds on all three.
        watcher = watch(root, { recursive: true, persistent: false }, () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => { version += 1; }, DEBOUNCE_MS);
            debounceTimer.unref?.();
        });
        watcher.on('error', () => stopDesignWatcher());
        watcher.unref?.();
        return true;
    } catch {
        watcher = null;
        return false;
    }
}

export function stopDesignWatcher(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    watcher?.close();
    watcher = null;
}
