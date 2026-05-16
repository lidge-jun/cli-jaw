// @ts-nocheck
// Mirrored from agbrowse adaptive-fetch v2; keep runtime behavior aligned while cli-jaw mirror remains experimental.

export const DEFAULT_OUTPUT_CONTENT_BYTES = 64 * 1024;

/**
 * @param {Record<string, any>} result
 * @param {{ contentLimitBytes?: number }} [options]
 */
export function compactAdaptiveFetchResult(result, options = {}) {
    const limit = positiveInteger(options.contentLimitBytes, DEFAULT_OUTPUT_CONTENT_BYTES);
    const compacted = truncateTextToUtf8Bytes(result.content || '', limit);
    return {
        ...result,
        content: compacted.text,
        contentBytes: compacted.bytes,
        contentLimitBytes: compacted.limit,
        contentTruncated: compacted.truncated,
    };
}

/**
 * @param {string} text
 * @param {number} limit
 */
export function truncateTextToUtf8Bytes(text, limit) {
    const value = String(text || '');
    const safeLimit = positiveInteger(limit, DEFAULT_OUTPUT_CONTENT_BYTES);
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes <= safeLimit) {
        return { text: value, bytes, limit: safeLimit, truncated: false };
    }
    let truncated = value.slice(0, safeLimit);
    while (truncated.length > 0 && Buffer.byteLength(truncated, 'utf8') > safeLimit) {
        truncated = truncated.slice(0, -1);
    }
    return { text: truncated, bytes, limit: safeLimit, truncated: true };
}

/**
 * @param {string} text
 * @param {{ write: Function }} [stdout]
 */
export function writeStdoutLine(text, stdout = process.stdout) {
    const chunk = text.endsWith('\n') ? text : `${text}\n`;
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve(undefined);
        };
        try {
            const accepted = stdout.write(chunk, done);
            if (accepted && stdout !== process.stdout) done();
        } catch (error) {
            done(error);
        }
    });
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function positiveInteger(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
