// ── Copy button event delegation ──
import { t } from '../features/i18n.js';

// ── Copy button event delegation (one-time setup) ──
let codeCopyDelegationReady = false;

export function ensureCodeCopyDelegation(): void {
    if (codeCopyDelegationReady) return;
    codeCopyDelegationReady = true;
    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // New structure: .code-copy-btn inside .code-block
        const copyBtn = target?.closest('.code-copy-btn') as HTMLElement | null;
        if (copyBtn) {
            const block = copyBtn.closest('.code-block');
            if (!block) return;
            const codeEl = block.querySelector('pre code');
            if (!codeEl) return;
            navigator.clipboard.writeText(codeEl.textContent || '').then(() => {
                const orig = copyBtn.textContent || '';
                copyBtn.textContent = t('code.copied');
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = orig;
                    copyBtn.classList.remove('copied');
                }, 1500);
            }).catch(() => { /* clipboard API fail silently */ });
            return;
        }
        // Legacy structure: .code-lang-label inside .code-block-wrapper
        const label = target?.closest('.code-lang-label') as HTMLElement | null;
        if (!label) return;
        const wrapper = label.closest('.code-block-wrapper');
        if (!wrapper) return;
        const codeEl = wrapper.querySelector('pre code');
        if (!codeEl) return;
        navigator.clipboard.writeText(codeEl.textContent || '').then(() => {
            const orig = label.textContent || '';
            label.textContent = t('code.copied');
            label.classList.add('copied');
            setTimeout(() => {
                label.textContent = orig;
                label.classList.remove('copied');
            }, 1500);
        }).catch(() => { /* clipboard API fail silently */ });
    });
}
