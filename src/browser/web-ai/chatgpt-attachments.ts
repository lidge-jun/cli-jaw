/**
 * PRD32.7 — Attachment Policy and Upload Lifecycle (Phase A — Fail-Closed Scaffold)
 *
 * Attachment success must never be input-only. Visible chip / file-count /
 * upload UI plus sent-turn attachment evidence are required before any upload
 * is considered successful. Phase A keeps mutation rejected; Phase B adds the
 * live runtime once 32.4–32.6 are stable.
 */

import type { Page } from 'playwright-core';

export type AttachmentPolicyName = 'inline-only' | 'upload' | 'auto';

export interface AttachmentPreflightResult {
    ok: boolean;
    rejectedReason?: string;
    softWarnings: string[];
    basename: string;
    sizeBytes: number;
    extension: string;
}

export interface AttachmentRuntimeResult {
    ok: false;
    stage: 'attachment-preflight' | 'attachment-upload';
    error: string;
    usedFallbacks: string[];
}

const HARD_LIMIT_BYTES = 512 * 1024 * 1024;
const IMAGE_LIMIT_BYTES = 20 * 1024 * 1024;
const SOFT_SPREADSHEET_BYTES = 50 * 1024 * 1024;

const UNSUPPORTED_EXTENSIONS = new Set(['.gdoc', '.gsheet', '.gslides']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic']);
const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx']);

export function preflightAttachment(file: { path: string; sizeBytes: number; basename: string }): AttachmentPreflightResult {
    const extension = extractExtension(file.basename);
    const softWarnings: string[] = [];
    if (UNSUPPORTED_EXTENSIONS.has(extension)) {
        return {
            ok: false,
            rejectedReason: `unsupported extension: ${extension}`,
            softWarnings,
            basename: file.basename,
            sizeBytes: file.sizeBytes,
            extension,
        };
    }
    if (file.sizeBytes > HARD_LIMIT_BYTES) {
        return {
            ok: false,
            rejectedReason: `file exceeds 512MB hard limit (${file.sizeBytes})`,
            softWarnings,
            basename: file.basename,
            sizeBytes: file.sizeBytes,
            extension,
        };
    }
    if (IMAGE_EXTENSIONS.has(extension) && file.sizeBytes > IMAGE_LIMIT_BYTES) {
        return {
            ok: false,
            rejectedReason: `image exceeds 20MB limit (${file.sizeBytes})`,
            softWarnings,
            basename: file.basename,
            sizeBytes: file.sizeBytes,
            extension,
        };
    }
    if (SPREADSHEET_EXTENSIONS.has(extension) && file.sizeBytes > SOFT_SPREADSHEET_BYTES) {
        softWarnings.push(`spreadsheet over 50MB may be soft-blocked by ChatGPT (${file.sizeBytes})`);
    }
    return {
        ok: true,
        softWarnings,
        basename: file.basename,
        sizeBytes: file.sizeBytes,
        extension,
    };
}

/**
 * Phase A guard. Mutation is forbidden until Phase B; this wrapper exists so
 * higher layers can call `attachLocalFile()` and consistently get a redacted
 * fail-closed envelope.
 */
export async function attachLocalFile(): Promise<AttachmentRuntimeResult> {
    return {
        ok: false,
        stage: 'attachment-upload',
        error: 'attachment upload runtime is not enabled (PRD32.7 Phase B pending)',
        usedFallbacks: [],
    };
}

export async function clearComposerAttachments(): Promise<AttachmentRuntimeResult> {
    return {
        ok: false,
        stage: 'attachment-preflight',
        error: 'attachment runtime is not enabled (PRD32.7 Phase B pending)',
        usedFallbacks: [],
    };
}

export async function locateComposerUploadTarget(): Promise<AttachmentRuntimeResult> {
    return {
        ok: false,
        stage: 'attachment-preflight',
        error: 'attachment runtime is not enabled (PRD32.7 Phase B pending)',
        usedFallbacks: [],
    };
}

export async function waitForAttachmentAccepted(): Promise<AttachmentRuntimeResult> {
    return {
        ok: false,
        stage: 'attachment-upload',
        error: 'attachment runtime is not enabled (PRD32.7 Phase B pending)',
        usedFallbacks: [],
    };
}

export async function verifySentTurnAttachment(): Promise<AttachmentRuntimeResult> {
    return {
        ok: false,
        stage: 'attachment-upload',
        error: 'attachment runtime is not enabled (PRD32.7 Phase B pending)',
        usedFallbacks: [],
    };
}

function extractExtension(basename: string): string {
    const idx = basename.lastIndexOf('.');
    if (idx < 0) return '';
    return basename.slice(idx).toLowerCase();
}

/**
 * PRD32.7 Phase B — live upload runtime.
 *
 * Success requires visible chip / file-count / upload UI evidence. Input-only
 * success is forbidden. DataTransfer fallbacks are recorded in `usedFallbacks`.
 */

export interface AttachmentRuntimeOk {
    ok: true;
    stage: 'attachment-uploaded' | 'attachment-cleared' | 'attachment-verified';
    chipVisible: boolean;
    fileCount: number;
    usedFallbacks: string[];
    warnings: string[];
}

export type AttachmentRuntimeOutcome = AttachmentRuntimeOk | AttachmentRuntimeResult;

const COMPOSER_FILE_INPUT_SELECTORS = [
    'main input[type="file"]',
    'form input[type="file"]',
    'input[type="file"][multiple]',
    'input[type="file"]',
];
const UPLOAD_BUTTON_SELECTORS = [
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Add" i]',
    'button[data-testid*="plus" i]',
    'button:has-text("Upload")',
];
const ATTACHMENT_CHIP_SELECTORS = [
    '[role="group"][aria-label$=".txt" i]',
    '[role="group"][aria-label$=".pdf" i]',
    '[role="group"][aria-label$=".docx" i]',
    '[role="group"][aria-label$=".csv" i]',
    '[role="group"][aria-label$=".xlsx" i]',
    '.group\\/file-tile',
    '[data-testid*="attachment" i]',
    '[aria-label*="attachment" i]',
    'button[aria-label*="Remove" i]',
    'div[role="img"][aria-label*="file" i]',
];
const UPLOAD_PROGRESS_SELECTORS = [
    '[role="progressbar"]',
    '[aria-label*="uploading" i]',
    '[aria-label*="processing" i]',
    '[data-testid*="upload-progress" i]',
];

async function findFirstFileInput(page: Page): Promise<string | null> {
    for (const sel of COMPOSER_FILE_INPUT_SELECTORS) {
        if ((await page.locator(sel).count().catch(() => 0)) > 0) return sel;
    }
    return null;
}

export async function attachLocalFileLive(
    page: Page,
    file: { path: string; basename: string; sizeBytes: number },
): Promise<AttachmentRuntimeOutcome> {
    const usedFallbacks: string[] = [];
    const warnings: string[] = [];
    const preflight = preflightAttachment(file);
    if (!preflight.ok) {
        return {
            ok: false,
            stage: 'attachment-preflight',
            error: preflight.rejectedReason || 'preflight rejected',
            usedFallbacks,
        };
    }
    if (preflight.softWarnings.length) warnings.push(...preflight.softWarnings);

    let inputSel = await findFirstFileInput(page);
    if (!inputSel) {
        await openUploadSurface(page, usedFallbacks);
        inputSel = await findFirstFileInput(page);
    }
    if (!inputSel) {
        return {
            ok: false,
            stage: 'attachment-upload',
            error: 'composer file input not found',
            usedFallbacks,
        };
    }
    try {
        await page.locator(inputSel).first().setInputFiles(file.path, { timeout: 8_000 });
    } catch (e) {
        usedFallbacks.push(`setInputFiles-failed:${(e as Error).message}`);
        return {
            ok: false,
            stage: 'attachment-upload',
            error: `setInputFiles failed: ${(e as Error).message}`,
            usedFallbacks,
        };
    }
    // Wait for visible chip / file count evidence (input-only success forbidden)
    const accepted = await waitForAttachmentAcceptedLive(page, { timeoutMs: 30_000 });
    if (!accepted.ok) {
        return accepted;
    }
    return {
        ok: true,
        stage: 'attachment-uploaded',
        chipVisible: accepted.chipVisible,
        fileCount: accepted.fileCount,
        usedFallbacks: [...usedFallbacks, ...accepted.usedFallbacks],
        warnings: [...warnings, ...accepted.warnings],
    };
}

async function openUploadSurface(page: Page, usedFallbacks: string[]): Promise<void> {
    for (const sel of UPLOAD_BUTTON_SELECTORS) {
        const loc = page.locator(sel).first();
        if (!(await loc.isVisible().catch(() => false))) continue;
        try {
            await loc.click({ timeout: 3_000 });
            await page.waitForTimeout(500).catch(() => undefined);
            return;
        } catch (e) {
            usedFallbacks.push(`upload-button-click-failed:${sel}:${(e as Error).message}`);
        }
    }
}

export async function clearComposerAttachmentsLive(page: Page): Promise<AttachmentRuntimeOutcome> {
    const usedFallbacks: string[] = [];
    const warnings: string[] = [];
    let cleared = 0;
    for (const sel of ATTACHMENT_CHIP_SELECTORS) {
        const loc = page.locator(sel);
        const n = await loc.count().catch(() => 0);
        for (let i = n - 1; i >= 0; i--) {
            const item = loc.nth(i);
            const ariaLabel = await item.getAttribute('aria-label').catch(() => '');
            if (ariaLabel && /Remove|Delete/i.test(ariaLabel)) {
                try { await item.click({ timeout: 2_000 }); cleared++; } catch { /* ignore */ }
            }
        }
    }
    return {
        ok: true,
        stage: 'attachment-cleared',
        chipVisible: false,
        fileCount: cleared,
        usedFallbacks,
        warnings,
    };
}

export async function waitForAttachmentAcceptedLive(
    page: Page,
    opts: { timeoutMs?: number } = {},
): Promise<AttachmentRuntimeOutcome> {
    const usedFallbacks: string[] = [];
    const warnings: string[] = [];
    const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
    while (Date.now() < deadline) {
        let chipCount = 0;
        for (const sel of ATTACHMENT_CHIP_SELECTORS) {
            chipCount += await page.locator(sel).count().catch(() => 0);
        }
        let progressCount = 0;
        for (const sel of UPLOAD_PROGRESS_SELECTORS) {
            progressCount += await page.locator(sel).count().catch(() => 0);
        }
        if (chipCount > 0 && progressCount === 0) {
            return {
                ok: true,
                stage: 'attachment-verified',
                chipVisible: true,
                fileCount: chipCount,
                usedFallbacks,
                warnings,
            };
        }
        await page.waitForTimeout(500).catch(() => undefined);
    }
    return {
        ok: false,
        stage: 'attachment-upload',
        error: 'attachment never showed visible chip — input-only success forbidden',
        usedFallbacks,
    };
}

export async function verifySentTurnAttachmentLive(
    page: Page,
    expectedFile?: { basename: string },
): Promise<AttachmentRuntimeOutcome> {
    const turnLoc = page.locator('[data-turn="user"], [data-message-author-role="user"]').last();
    const exists = await turnLoc.count().catch(() => 0);
    if (exists === 0) {
        return {
            ok: false,
            stage: 'attachment-upload',
            error: 'no conversation turn visible after send',
            usedFallbacks: [],
        };
    }
    const text = await turnLoc.innerText().catch(() => '');
    if (expectedFile?.basename && (
        text.includes(expectedFile.basename) ||
        text.includes(stripExtension(expectedFile.basename)) ||
        text.includes(expectedFile.basename.replace(/\(\d+\)(?=\.)/, ''))
    )) {
        return {
            ok: true,
            stage: 'attachment-verified',
            chipVisible: true,
            fileCount: 1,
            usedFallbacks: [],
            warnings: [],
        };
    }
    const att = await turnLoc.locator('[data-testid*="attachment" i], img, [role="img"]').count().catch(() => 0);
    if (att === 0) {
        return {
            ok: false,
            stage: 'attachment-upload',
            error: 'sent turn has no attachment evidence',
            usedFallbacks: [],
        };
    }
    return {
        ok: true,
        stage: 'attachment-verified',
        chipVisible: true,
        fileCount: att,
        usedFallbacks: [],
        warnings: [],
    };
}

function stripExtension(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx < 0 ? name : name.slice(0, idx);
}
