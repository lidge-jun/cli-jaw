import { useEffect } from 'react';
import { codeToastAutoDismisses, codeToastIsAssertive, type CodeToast } from './code-toasts';

function ToastCard({ toast, onDismiss }: { toast: CodeToast; onDismiss(id: string): void }) {
    useEffect(() => {
        if (!codeToastAutoDismisses(toast)) return;
        const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs);
        return () => clearTimeout(timer);
        // The revision restarts the timer when the same notice is pushed again.
    }, [toast.id, toast.revision, toast.durationMs, onDismiss]);
    return <div className={`code-toast code-toast-${toast.variant}`}>
        <span className="code-toast-message">{toast.message}</span>
        <button type="button" className="code-toast-dismiss" aria-label={`Dismiss: ${toast.message}`}
            onClick={() => onDismiss(toast.id)}>×</button>
    </div>;
}

/**
 * Notices float over the top of the transcript rather than pushing the composer
 * down, so reading one never moves the thing the reader is typing into.
 *
 * Two regions, not one: an assertive live region interrupts, and mixing an
 * alert into a polite region is unreliable because the container's politeness
 * is what applies to an insertion. Errors go in the assertive one.
 */
export function CodeToastHost({ toasts, onDismiss }: { toasts: readonly CodeToast[]; onDismiss(id: string): void }) {
    const polite = toasts.filter(toast => !codeToastIsAssertive(toast));
    const assertive = toasts.filter(codeToastIsAssertive);
    if (!toasts.length) return null;
    return <div className="code-toast-host">
        <div className="code-toast-region" role="status" aria-live="polite">
            {polite.map(toast => <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />)}
        </div>
        <div className="code-toast-region" role="alert" aria-live="assertive">
            {assertive.map(toast => <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />)}
        </div>
    </div>;
}

