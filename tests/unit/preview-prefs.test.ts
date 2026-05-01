import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resetWebUiDom, setupWebUiDom } from './web-ui-test-dom.ts';
import { loadPreviewEnabled, savePreviewEnabled } from '../../public/manager/src/lib/preview-prefs.ts';

beforeEach(() => {
    setupWebUiDom();
});

afterEach(() => {
    resetWebUiDom();
});

describe('preview-prefs', () => {
    it('defaults to false when no value stored', () => {
        assert.equal(loadPreviewEnabled(), false);
    });

    it('loads stored true', () => {
        localStorage.setItem('jaw.previewEnabled', 'true');
        assert.equal(loadPreviewEnabled(), true);
    });

    it('persists via savePreviewEnabled', () => {
        savePreviewEnabled(true);
        assert.equal(localStorage.getItem('jaw.previewEnabled'), 'true');
        savePreviewEnabled(false);
        assert.equal(localStorage.getItem('jaw.previewEnabled'), 'false');
    });
});

