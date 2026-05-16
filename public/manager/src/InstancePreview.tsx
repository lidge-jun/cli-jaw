import { useCallback, useEffect, useRef } from 'react';
import { buildPreviewState } from './preview';
import type { PreviewTheme } from './preview';
import type { DashboardInstance, DashboardScanResult } from './types';

type InstancePreviewProps = {
    instance: DashboardInstance | null;
    data: DashboardScanResult | null;
    enabled: boolean;
    active: boolean;
    refreshKey: number;
    theme: PreviewTheme;
};

function previewTargetOrigin(src: string, frame: HTMLIFrameElement | null): string | null {
    if (typeof window === 'undefined') return 'http://localhost';
    try {
        const actualOrigin = frame?.contentWindow?.location.origin;
        if (actualOrigin && actualOrigin !== 'null') return actualOrigin;
    } catch {
        // Cross-origin previews hide location; fall back to the expected source origin.
    }
    const expectedOrigin = new URL(src, window.location.href).origin;
    return expectedOrigin === 'null' ? null : expectedOrigin;
}

function postPreviewTheme(frame: HTMLIFrameElement | null, src: string, theme: PreviewTheme): void {
    const targetWindow = frame?.contentWindow;
    if (!targetWindow) return;
    const targetOrigin = previewTargetOrigin(src, frame);
    if (!targetOrigin || targetOrigin === 'null') return;
    try {
        targetWindow.postMessage(
            { type: 'jaw-preview-theme-sync', theme },
            targetOrigin,
        );
    } catch (error) {
        console.warn('[manager-preview] theme sync skipped', error);
    }
}

function postPreviewSttToggle(frame: HTMLIFrameElement | null, src: string): void {
    const targetWindow = frame?.contentWindow;
    if (!targetWindow) return;
    const targetOrigin = previewTargetOrigin(src, frame);
    if (!targetOrigin || targetOrigin === 'null') return;
    try {
        targetWindow.postMessage(
            { type: 'jaw-preview-stt-toggle' },
            targetOrigin,
        );
    } catch (error) {
        console.warn('[manager-preview] STT shortcut sync skipped', error);
    }
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return Boolean(target.closest('[contenteditable="true"], .cm-editor, .ProseMirror, [data-milkdown-root]'));
}

function isPreviewSttShortcut(event: KeyboardEvent): boolean {
    const primarySpace = (event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Space';
    const fallbackMic = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyM';
    return primarySpace || fallbackMic;
}

export function InstancePreview(props: InstancePreviewProps) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const loadedSrcRef = useRef<string | null>(null);
    const state = buildPreviewState(
        props.instance,
        props.data,
        // Keep the dedicated preview origin as the default. The legacy `/i`
        // path is only a fallback because root-relative `/api` and `/ws`
        // requests must keep targeting the managed instance.
        { theme: props.theme },
    );
    const disabledReason = props.instance?.ok
        ? 'Preview is off. Turn it on from the header to mount the iframe.'
        : state.reason;
    const syncTheme = useCallback((): void => {
        if (!props.enabled || !state.canPreview || !state.src) return;
        if (loadedSrcRef.current !== state.src) return;
        postPreviewTheme(iframeRef.current, state.src, props.theme);
    }, [props.enabled, props.theme, state.canPreview, state.src]);

    useEffect(() => {
        syncTheme();
    }, [syncTheme]);

    useEffect(() => {
        if (!props.active || !props.enabled || !state.canPreview || !state.src) return undefined;
        function onKeyDown(event: KeyboardEvent): void {
            if (event.defaultPrevented) return;
            if (isEditableShortcutTarget(event.target)) return;
            if (!isPreviewSttShortcut(event)) return;
            event.preventDefault();
            postPreviewSttToggle(iframeRef.current, state.src || '');
        }
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [props.active, props.enabled, state.canPreview, state.src]);

    const prevActiveRef = useRef(false);
    useEffect(() => {
        const wasActive = prevActiveRef.current;
        prevActiveRef.current = props.active;
        if (!wasActive && props.active && iframeRef.current?.contentWindow && state.src) {
            const origin = previewTargetOrigin(state.src, iframeRef.current);
            if (origin && origin !== 'null') {
                try {
                    iframeRef.current.contentWindow.postMessage(
                        { type: 'jaw-preview-visibility', visible: true },
                        origin,
                    );
                } catch { /* cross-origin guard */ }
            }
        }
    }, [props.active, state.src]);

    return (
        <aside className="preview-panel" aria-label="Instance preview">
            {(!props.enabled || !state.canPreview) && <div className="preview-empty">{disabledReason}</div>}

            {props.enabled && state.canPreview && state.src && (
                <iframe
                    key={`${props.instance?.port || 'none'}:${props.refreshKey}`}
                    title={`Jaw instance ${props.instance?.port} preview`}
                    ref={iframeRef}
                    className="preview-frame"
                    src={state.src}
                    sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads"
                    allow="clipboard-read; clipboard-write; microphone"
                    onLoad={() => {
                        loadedSrcRef.current = state.src;
                        syncTheme();
                    }}
                />
            )}

        </aside>
    );
}
