import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupWebUiDom, resetWebUiDom } from './web-ui-test-dom.ts';

test.afterEach(() => {
    resetWebUiDom();
});

test('ProcessBlock keeps huge details out of collapsed state and hydrates lazily', async () => {
    setupWebUiDom();
    const {
        buildProcessBlockHtml,
        bindProcessBlockInteractions,
        getStoredProcessStepDetail,
        releaseProcessBlockDetails,
    } = await import('../../public/js/features/process-block.ts');

    const huge = 'DETAIL-'.repeat(20_000);
    const host = document.createElement('div');
    host.innerHTML = buildProcessBlockHtml([{
        id: 'step-huge',
        type: 'tool',
        icon: 'tool',
        label: 'Huge tool',
        detail: huge,
        traceRunId: 'tr_1234567890abcdef1234567890abcdef',
        traceSeq: 3,
        detailAvailable: true,
        detailBytes: huge.length,
        rawRetentionStatus: 'spilled',
        status: 'done',
        startTime: Date.now(),
    }], true);
    document.body.appendChild(host);
    const block = host.querySelector('.process-block') as HTMLElement;
    const pre = block.querySelector('.process-step-full') as HTMLElement;

    assert.ok(block.dataset.processStepIds?.includes('step-huge'));
    assert.equal(pre.textContent, '');
    assert.equal(pre.dataset.detailLazy, 'true');
    assert.equal(block.querySelector('.process-step-trace')?.textContent, 'Trace');
    assert.equal((block.querySelector('.process-step') as HTMLElement).dataset.traceSeq, '3');
    assert.ok(!block.outerHTML.includes(huge.slice(0, 2000)));
    assert.ok(getStoredProcessStepDetail('step-huge').length < huge.length);

    bindProcessBlockInteractions(block);
    (block.querySelector('.process-step-toggle') as HTMLButtonElement).click();
    assert.ok((block.querySelector('.process-step-full') as HTMLElement).textContent!.includes('DETAIL-'));

    (block.querySelector('.process-step-toggle') as HTMLButtonElement).click();
    assert.equal((block.querySelector('.process-step-full') as HTMLElement).textContent, '');

    releaseProcessBlockDetails(block);
    assert.equal(getStoredProcessStepDetail('step-huge'), '');
});

test('ProcessBlock trace control and chevron fit on one toggle row', () => {
    const css = readFileSync(new URL('../../public/css/tool-ui.css', import.meta.url), 'utf8');
    const toggleRule = css.match(/\.process-step-toggle\s*\{[\s\S]*?\}/)?.[0] ?? '';

    assert.ok(toggleRule.includes('grid-template-columns: auto 16px auto minmax(0, 1fr) auto auto;'));
});
