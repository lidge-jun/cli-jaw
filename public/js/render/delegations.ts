// ── One-time render event delegations ──
import { ensureCodeCopyDelegation } from './code-copy.js';
import { ensureDiagramActionDelegation } from './svg-actions.js';
import { ensureFilePathDelegation } from './file-links.js';

export function ensureRenderDelegations(): void {
    ensureCodeCopyDelegation();
    ensureDiagramActionDelegation();
    ensureFilePathDelegation();
}
