import { useEffect, useRef } from 'react';
import type { DashboardSidebarMode } from '../types';
import { HELP_CONTENT } from './helpContent';

type HelpDrawerProps = {
    open: boolean;
    mode: DashboardSidebarMode;
    onClose: () => void;
};

export function HelpDrawer({ open, mode, onClose }: HelpDrawerProps) {
    const closeRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!open) return undefined;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        closeRef.current?.focus();
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!open) return null;
    const entry = HELP_CONTENT[mode];
    return (
        <>
            <div className="help-drawer-overlay" onClick={onClose} aria-hidden="true" />
            <aside className="help-drawer" role="dialog" aria-modal="true" aria-label={`${entry.title} help`}>
                <header className="help-drawer-header">
                    <div className="help-drawer-title">
                        <span className="help-drawer-eyebrow">현재 모드</span>
                        <h3>{entry.title}</h3>
                        <span className="help-drawer-subtitle">{entry.subtitle}</span>
                    </div>
                    <button
                        ref={closeRef}
                        type="button"
                        className="help-drawer-close"
                        onClick={onClose}
                        aria-label="Close help"
                    >×</button>
                </header>
                <div className="help-drawer-body">{entry.body}</div>
                <footer className="help-drawer-footer">
                    <span>모드를 바꾸시면 도움말도 자동으로 따라가요 🦈</span>
                </footer>
            </aside>
        </>
    );
}
