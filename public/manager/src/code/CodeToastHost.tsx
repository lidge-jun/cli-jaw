import { useEffect, useRef, useState } from 'react';
import { codeToastAutoDismisses, type CodeToast } from './code-toasts';

function ToastCard({ toast, onDismiss }: { toast: CodeToast; onDismiss(id: string): void }) {
    const [held, setHeld] = useState(false);
    const card = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // Held while the reader is pointing at it or has tabbed into it: a
        // notice that expires mid-read is worse than one that lingers, and
        // unmounting a card that owns focus drops the caret to the document
        // body and loses the reader's place in the composer.
        if (held || !codeToastAutoDismisses(toast)) return;
        const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs);
        return () => clearTimeout(timer);
        // The revision restarts the timer when the same notice is pushed again.
    }, [toast.id, toast.revision, toast.durationMs, onDismiss, held]);
    return <div ref={card} className={`code-toast code-toast-${toast.variant}`}
        onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}
        onFocusCapture={() => setHeld(true)}
        onBlurCapture={event => { if (!card.current?.contains(event.relatedTarget as Node | null)) setHeld(false); }}>
        <span className="code-toast-message">{toast.message}</span>
        {/* A short static name: the button sits inside the live region, so a
            label repeating the message would announce the whole notice twice. */}
        <button type="button" className="code-toast-dismiss" aria-label="Dismiss notice"
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
    // The region is always mounted, even empty. A live region that arrives in
    // the DOM together with its first content is not announced -- assistive tech
    // has to already be observing it when the insertion happens, which is also
    // why it is not hidden while empty. One region, because every notice this
    // surface raises is polite; anything that must interrupt stays inline where
    // it can also stay on screen.
    return <div className="code-toast-host">
        <div className="code-toast-region" role="status">
            {toasts.map(toast => <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />)}
        </div>
    </div>;
}
