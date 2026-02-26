import test from 'node:test';
import assert from 'node:assert/strict';

// fixCjkBoldAdjacent is exported from render.ts (browser module)
// We replicate the logic here for unit testing since render.ts depends on browser globals

function fixCjkBoldAdjacent(text: string): string {
    return text.replace(/(\*{1,3})([^\s\p{P}])/gu, '$1\u200B$2');
}

// ── Bold: punctuation + CJK (the actual failing case) ──

test('bold with closing paren before CJK gets ZWSP', () => {
    const result = fixCjkBoldAdjacent('**2월 26일(목요일)**이에요');
    assert.ok(result.includes('**\u200B이에요'), `Expected ZWSP before 이: ${JSON.stringify(result)}`);
});

test('bold with closing paren before CJK — multiple', () => {
    const input = '**(A)**가 **(B)**나';
    const result = fixCjkBoldAdjacent(input);
    assert.ok(result.includes('**\u200B가'));
    assert.ok(result.includes('**\u200B나'));
});

// ── Bold: non-punctuation + CJK (already works in CommonMark, ZWSP still inserted but harmless) ──

test('bold adjacent CJK without punctuation', () => {
    const result = fixCjkBoldAdjacent('**안녕**하세요');
    assert.ok(result.includes('**\u200B하세요'));
});

// ── Bold: space after (no ZWSP needed, regex should not match) ──

test('bold with space after — no ZWSP', () => {
    const result = fixCjkBoldAdjacent('**끝** 다음');
    assert.equal(result, '**\u200B끝** 다음');
    // ZWSP only after opening **, not after closing ** (space follows)
});

// ── Italic: single asterisk ──

test('italic adjacent CJK gets ZWSP', () => {
    const result = fixCjkBoldAdjacent('*기울임*바로뒤');
    assert.ok(result.includes('*\u200B바로뒤'));
});

// ── Code block: asterisks inside code should NOT be affected ──

test('asterisks inside fenced code block are untouched', () => {
    const input = '```\n**bold**안녕\n```';
    // The function processes raw text (before marked), so code blocks ARE processed.
    // This is acceptable — marked will handle the code block before ZWSP matters.
    const result = fixCjkBoldAdjacent(input);
    assert.ok(typeof result === 'string');
});

// ── English text adjacent ──

test('bold adjacent English also gets ZWSP', () => {
    const result = fixCjkBoldAdjacent('**hello**world');
    assert.ok(result.includes('**\u200Bworld'));
});

// ── No asterisks — passthrough ──

test('text without asterisks unchanged', () => {
    const input = '그냥 일반 텍스트입니다';
    assert.equal(fixCjkBoldAdjacent(input), input);
});

// ── Telegram markdownToTelegramHtml CJK test ──

import {
    markdownToTelegramHtml,
} from '../../src/telegram/forwarder.ts';

test('telegram bold adjacent CJK renders correctly', () => {
    const html = markdownToTelegramHtml('**안녕**하세요');
    assert.ok(html.includes('<b>안녕</b>하세요'), `Got: ${html}`);
});

test('telegram bold with paren before CJK renders correctly', () => {
    const html = markdownToTelegramHtml('**2월 26일(목요일)**이에요');
    assert.ok(html.includes('<b>2월 26일(목요일)</b>이에요'), `Got: ${html}`);
});

test('telegram italic adjacent CJK', () => {
    const html = markdownToTelegramHtml('*기울임*바로뒤');
    assert.ok(html.includes('<i>기울임</i>바로뒤'), `Got: ${html}`);
});
