import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── shieldMath / unshieldMath 로직 재현 (Node.js 테스트용) ──
// render.ts는 CDN 글로벌(katex, marked 등)에 의존하므로
// 순수 함수 로직만 복제하여 단위 테스트.

interface MathBlock { tex: string; displayMode: boolean; }

function shieldMath(text: string): { text: string; blocks: MathBlock[] } {
    const blocks: MathBlock[] = [];
    const preserved: string[] = [];
    let processed = text
        .replace(/```[\s\S]*?```/g, (m) => {
            preserved.push(m); return `\x00C${preserved.length - 1}\x00`;
        })
        .replace(/`[^`]+`/g, (m) => {
            preserved.push(m); return `\x00C${preserved.length - 1}\x00`;
        });

    // Block math: $$...$$
    processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
        blocks.push({ tex: tex.trim(), displayMode: true });
        return `\x00MATH-${blocks.length - 1}\x00`;
    });

    // GPT-style block math: \[...\]
    processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => {
        blocks.push({ tex: tex.trim(), displayMode: true });
        return `\x00MATH-${blocks.length - 1}\x00`;
    });

    // Inline math: $...$ (avoid $10 currency)
    processed = processed.replace(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g, (_, tex) => {
        blocks.push({ tex: tex.trim(), displayMode: false });
        return `\x00MATH-${blocks.length - 1}\x00`;
    });

    // GPT-style inline math: \(...\)
    processed = processed.replace(/\\\((.+?)\\\)/g, (_, tex) => {
        blocks.push({ tex: tex.trim(), displayMode: false });
        return `\x00MATH-${blocks.length - 1}\x00`;
    });

    // Restore code blocks
    processed = processed.replace(/\x00C(\d+)\x00/g, (_, i) => preserved[Number(i)]);
    return { text: processed, blocks };
}

function unshieldMath(html: string, blocks: MathBlock[]): string {
    return html.replace(/\x00MATH-(\d+)\x00/g, (_, i) => {
        const b = blocks[Number(i)];
        if (!b) return '<code title="math placeholder error">[math error]</code>';
        // No katex in Node.js — fallback path
        return b.displayMode
            ? `<pre><code>${b.tex}</code></pre>`
            : `<code>${b.tex}</code>`;
    });
}

// ── shieldMath tests ──

describe('shieldMath — inline math', () => {
    it('should shield $E=mc^2$', () => {
        const { text, blocks } = shieldMath('The formula $E=mc^2$ is famous.');
        assert.ok(!text.includes('$E=mc^2$'), 'inline math replaced');
        assert.ok(text.includes('\x00MATH-0\x00'), 'placeholder present');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].tex, 'E=mc^2');
        assert.equal(blocks[0].displayMode, false);
    });

    it('should shield multiple inline formulas', () => {
        const { blocks } = shieldMath('$\\alpha$ and $\\beta$ are Greek.');
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0].tex, '\\alpha');
        assert.equal(blocks[1].tex, '\\beta');
    });
});

describe('shieldMath — block math', () => {
    it('should shield $$...$$', () => {
        const { text, blocks } = shieldMath('Result:\n$$\\frac{a}{b}$$\nDone.');
        assert.ok(text.includes('\x00MATH-0\x00'));
        assert.equal(blocks[0].tex, '\\frac{a}{b}');
        assert.equal(blocks[0].displayMode, true);
    });

    it('should handle multiline block math', () => {
        const input = '$$\n\\int_0^1 x^2 dx\n= \\frac{1}{3}\n$$';
        const { blocks } = shieldMath(input);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].displayMode, true);
        assert.ok(blocks[0].tex.includes('\\int_0^1'));
    });
});

describe('shieldMath — code block exclusion', () => {
    it('should NOT shield $ inside inline code', () => {
        const { blocks } = shieldMath('Use `$HOME` variable.');
        assert.equal(blocks.length, 0, 'no math blocks from code span');
    });

    it('should NOT shield $ inside fenced code block', () => {
        const input = '```bash\necho $PATH\nprice=$10\n```';
        const { blocks } = shieldMath(input);
        assert.equal(blocks.length, 0, 'no math from fenced code');
    });

    it('should preserve code blocks verbatim', () => {
        const input = '```js\nconst cost = $total;\n```';
        const { text } = shieldMath(input);
        assert.ok(text.includes('```js\nconst cost = $total;\n```'), 'code block preserved');
    });
});

describe('shieldMath — currency exclusion', () => {
    it('should NOT shield currency $10', () => {
        const { blocks } = shieldMath('It costs $10 each.');
        assert.equal(blocks.length, 0, 'currency not matched');
    });

    it('should NOT shield $$ used as currency without closing', () => {
        const { blocks } = shieldMath('Pay $$$ for premium.');
        // three $ in a row — no valid math
        assert.equal(blocks.length, 0);
    });
});

describe('shieldMath — mixed content', () => {
    it('should handle code + math together', () => {
        const input = 'Code: `x = $y` and math $a+b$ end.';
        const { text, blocks } = shieldMath(input);
        assert.equal(blocks.length, 1, 'only real math shielded');
        assert.equal(blocks[0].tex, 'a+b');
        assert.ok(text.includes('`x = $y`'), 'code span preserved');
    });

    it('should handle block math + code block', () => {
        const input = '$$E=mc^2$$\n\n```py\nx = 1\n```\n\n$\\alpha$';
        const { blocks } = shieldMath(input);
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0].displayMode, true);
        assert.equal(blocks[1].displayMode, false);
    });
});

describe('shieldMath — GPT-style \\[...\\] block', () => {
    it('should shield \\[...\\] as block math', () => {
        const { text, blocks } = shieldMath('Result:\n\\[\\frac{a}{b}\\]\nDone.');
        assert.ok(text.includes('\x00MATH-0\x00'));
        assert.equal(blocks[0].tex, '\\frac{a}{b}');
        assert.equal(blocks[0].displayMode, true);
    });

    it('should handle multiline \\[...\\]', () => {
        const input = '\\[\n\\sum_{i=0}^n i^2\n\\]';
        const { blocks } = shieldMath(input);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].displayMode, true);
        assert.ok(blocks[0].tex.includes('\\sum'));
    });
});

describe('shieldMath — GPT-style \\(...\\) inline', () => {
    it('should shield \\(...\\) as inline math', () => {
        const { text, blocks } = shieldMath('The formula \\(E=mc^2\\) is famous.');
        assert.ok(text.includes('\x00MATH-0\x00'));
        assert.equal(blocks[0].tex, 'E=mc^2');
        assert.equal(blocks[0].displayMode, false);
    });

    it('should handle mixed $ and \\( delimiters', () => {
        const input = '$\\alpha$ and \\(\\beta\\) are Greek.';
        const { blocks } = shieldMath(input);
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0].tex, '\\alpha');
        assert.equal(blocks[1].tex, '\\beta');
    });
});

// ── unshieldMath tests ──

describe('unshieldMath — fallback (no KaTeX)', () => {
    it('should restore inline math as <code>', () => {
        const blocks: MathBlock[] = [{ tex: 'E=mc^2', displayMode: false }];
        const result = unshieldMath('The formula \x00MATH-0\x00 is famous.', blocks);
        assert.ok(result.includes('<code>E=mc^2</code>'));
        assert.ok(!result.includes('\x00MATH'));
    });

    it('should restore block math as <pre><code>', () => {
        const blocks: MathBlock[] = [{ tex: '\\frac{a}{b}', displayMode: true }];
        const result = unshieldMath('\x00MATH-0\x00', blocks);
        assert.ok(result.includes('<pre><code>\\frac{a}{b}</code></pre>'));
    });

    it('should handle multiple placeholders', () => {
        const blocks: MathBlock[] = [
            { tex: 'x', displayMode: false },
            { tex: 'y^2', displayMode: false },
        ];
        const result = unshieldMath('Values: \x00MATH-0\x00 and \x00MATH-1\x00.', blocks);
        assert.ok(result.includes('<code>x</code>'));
        assert.ok(result.includes('<code>y^2</code>'));
    });

    it('should handle missing block gracefully', () => {
        const result = unshieldMath('\x00MATH-99\x00', []);
        assert.ok(result.includes('[math error]'), 'missing block shows error marker');
    });
});
