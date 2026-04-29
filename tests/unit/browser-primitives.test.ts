import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ActionTranscript,
    BrowserCapabilityError,
    captureTextBaseline,
    findVisibleCandidate,
    waitForStableTextAfterBaseline,
} from '../../src/browser/primitives.js';

test('BPRIM-001: findVisibleCandidate prefers visible locator over first hidden match', async () => {
    const page = fakePage({
        '.candidate': [
            fakeLocator({ text: 'hidden', visible: false }),
            fakeLocator({ text: 'visible', visible: true }),
        ],
    });
    const result = await findVisibleCandidate(page, ['.candidate']);
    assert.equal(result?.index, 1);
    assert.equal(await result?.locator.innerText(), 'visible');
});

test('BPRIM-002: findVisibleCandidate can return first candidate only when explicitly allowed', async () => {
    const page = fakePage({ '.candidate': [fakeLocator({ text: 'hidden', visible: false })] });
    assert.equal(await findVisibleCandidate(page, ['.candidate']), null);
    const fallback = await findVisibleCandidate(page, ['.candidate'], { allowFirstCandidateFallback: true });
    assert.equal(fallback?.index, 0);
    assert.equal(fallback?.visible, false);
});

test('BPRIM-003: ActionTranscript records fallbacks and warnings without shared mutable output', () => {
    const transcript = new ActionTranscript();
    transcript.warn('late response');
    transcript.fallback('dom-evaluate');
    const first = transcript.toJSON();
    first.warnings.push('mutated');
    assert.deepEqual(transcript.toJSON(), {
        warnings: ['late response'],
        usedFallbacks: ['dom-evaluate'],
    });
});

test('BPRIM-004: BrowserCapabilityError carries capability and stage metadata', () => {
    const err = new BrowserCapabilityError('blocked', {
        capabilityId: 'chatgpt-web-search-toggle',
        stage: 'capability-preflight',
    });
    assert.equal(err.name, 'BrowserCapabilityError');
    assert.equal(err.capabilityId, 'chatgpt-web-search-toggle');
    assert.equal(err.stage, 'capability-preflight');
    assert.equal(err.mutationAllowed, false);
});

test('BPRIM-005: text baseline and stable polling detect new stable text', async () => {
    const locators = [fakeLocator({ text: 'old', visible: true })];
    const page = fakePage({ '.message': locators });
    const baseline = await captureTextBaseline(page, ['.message']);
    locators.push(fakeLocator({ text: 'new answer', visible: true }));
    const result = await waitForStableTextAfterBaseline(page, ['.message'], baseline, {
        timeoutMs: 200,
        stableWindowMs: 20,
        pollIntervalMs: 10,
    });
    assert.equal(result.ok, true);
    assert.equal(result.latestText, 'new answer');
});

function fakePage(map: Record<string, ReturnType<typeof fakeLocator>[]>): any {
    return {
        locator(selector: string) {
            const locators = map[selector] || [];
            return {
                count: async () => locators.length,
                nth: (index: number) => locators[index],
                first: () => locators[0],
                all: async () => locators,
            };
        },
        waitForTimeout: async () => undefined,
    };
}

function fakeLocator(input: { text: string; visible: boolean }): any {
    return {
        waitFor: async () => {
            if (!input.visible) throw new Error('hidden');
        },
        boundingBox: async () => input.visible ? { width: 10, height: 10 } : null,
        evaluate: async () => input.visible,
        innerText: async () => input.text,
    };
}
