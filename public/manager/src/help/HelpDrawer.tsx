import { useEffect, useRef } from 'react';
import { HELP_CONTENT, type HelpTopicId } from './helpContent';

type HelpDrawerProps = {
    open: boolean;
    topic: HelpTopicId;
    onClose: () => void;
};

export function HelpDrawer({ open, topic, onClose }: HelpDrawerProps) {
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
    const entry = HELP_CONTENT[topic];
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
                    <span>사이드바 도움말은 현재 모드를 따르고, ? 키는 단축키 도움말을 열어요.</span>
                </footer>
            </aside>
        </>
    );
}
