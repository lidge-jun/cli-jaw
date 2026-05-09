// ── KaTeX math shield/unshield ──
import katex from 'katex';
import { escapeHtml } from './html.js';

// ── KaTeX math shield/unshield ──
// Shield: marked 전에 수식을 플레이스홀더로 치환 (marked가 $를 파괴하는 것 방지)
// Unshield: marked 후에 플레이스홀더를 KaTeX 렌더링으로 복원

export interface MathBlock { tex: string; displayMode: boolean; }

export function shieldMath(text: string): { text: string; blocks: MathBlock[] } {
    const blocks: MathBlock[] = [];
    // 1. 코드 블록/인라인 코드 보존 (수식 추출 대상에서 제외)
    const preserved: string[] = [];
    let processed = text
        .replace(/```[\s\S]*?```/g, (m) => {
            preserved.push(m); return `\x00C${preserved.length - 1}\x00`;
        })
        .replace(/`[^`]+`/g, (m) => {
            preserved.push(m); return `\x00C${preserved.length - 1}\x00`;
        });

    // 2. Block math: $$...$$ (먼저 — greedy 방지)
    processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => {
        blocks.push({ tex: tex.trim(), displayMode: true });
        return `\x00MATH-${blocks.length - 1}\x00`;
    });

    // 3. GPT-style block math: \[...\]
    processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => {
        blocks.push({ tex: tex.trim(), displayMode: true });
        return `\x00MATH-${blocks.length - 1}\x00`;
    });

    // 4. Inline math: $...$ (통화 $10 제외)
    processed = processed.replace(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g, (_, tex: string) => {
        blocks.push({ tex: tex.trim(), displayMode: false });
        return `\x00MATH-${blocks.length - 1}\x00`;
    });

    // 5. GPT-style inline math: \(...\)
    processed = processed.replace(/\\\((.+?)\\\)/g, (_, tex: string) => {
        blocks.push({ tex: tex.trim(), displayMode: false });
        return `\x00MATH-${blocks.length - 1}\x00`;
    });

    // 4. 코드 블록 복원
    processed = processed.replace(/\x00C(\d+)\x00/g, (_, i) => preserved[Number(i)]);

    return { text: processed, blocks };
}

export function unshieldMath(html: string, blocks: MathBlock[], isStreaming = false): string {
    return html.replace(/\x00MATH-(\d+)\x00/g, (_, i) => {
        const block = blocks[Number(i)];
        if (!block) return `<code title="math placeholder error">[math error]</code>`;

        // During streaming: lightweight placeholder, defer KaTeX to finalize
        if (isStreaming) {
            return block.displayMode
                ? `<div class="math-placeholder">${escapeHtml(block.tex)}</div>`
                : `<code class="math-placeholder">${escapeHtml(block.tex)}</code>`;
        }

        try {
            return katex.renderToString(block.tex, {
                displayMode: block.displayMode,
                throwOnError: false,
            });
        } catch {
            return block.displayMode
                ? `<pre><code>${escapeHtml(block.tex)}</code></pre>`
                : `<code>${escapeHtml(block.tex)}</code>`;
        }
    });
}
