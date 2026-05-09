import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '../..');
const cssSrc = readFileSync(join(projectRoot, 'public/css/diagram.css'), 'utf8');
const svgActionsSrc = readFileSync(join(projectRoot, 'public/js/render/svg-actions.ts'), 'utf8');

test('inline SVG primitives are styled in normal chat and SVG overlay contexts', () => {
    assert.ok(cssSrc.includes(':where(.diagram-svg, .diagram-svg-overlay) .node'),
        'node primitive style must apply to normal and overlay SVG diagrams');
    assert.ok(cssSrc.includes(':where(.diagram-svg, .diagram-svg-overlay) .label'),
        'centered label style must apply to normal and overlay SVG diagrams');
    assert.ok(cssSrc.includes(':where(.diagram-svg, .diagram-svg-overlay) .label-start'),
        'start-aligned label style must apply to normal and overlay SVG diagrams');
    assert.ok(cssSrc.includes(':where(.diagram-svg, .diagram-svg-overlay) .diagram-title'),
        'title style must apply to normal and overlay SVG diagrams');
});

test('connector line style is visible and scoped away from Mermaid overlays', () => {
    const connectorIdx = cssSrc.indexOf(':where(.diagram-svg, .diagram-svg-overlay) .connector');
    assert.ok(connectorIdx >= 0, 'connector primitive style must be scoped to inline SVG contexts');
    const connectorBlock = cssSrc.slice(connectorIdx, connectorIdx + 180);
    assert.ok(connectorBlock.includes('stroke: var(--text-dim)'),
        'connector should not rely on low-contrast border color in dark mode');
    assert.ok(connectorBlock.includes('stroke-width: 0.5'),
        'connector should keep the diagram design-system stroke width');
    assert.ok(cssSrc.includes('[data-theme="light"] :where(.diagram-svg, .diagram-svg-overlay) .connector'),
        'light mode connector override must include overlay context');
    assert.ok(!cssSrc.includes('.diagram-overlay-content .label'),
        'generic overlay content must not style Mermaid labels');
});

test('SVG overlay gets diagram-svg-overlay class while Mermaid overlay stays generic', () => {
    assert.ok(svgActionsSrc.includes("export type DiagramOverlayKind = 'inline-svg' | 'mermaid';"),
        'overlay helper must distinguish inline SVG and Mermaid callers');
    assert.ok(svgActionsSrc.includes("'diagram-overlay-content diagram-svg-overlay'"),
        'inline SVG overlay must receive diagram SVG primitive styles');
    assert.ok(svgActionsSrc.includes("openDiagramOverlay(clone.innerHTML, kind)"),
        'zoom binder must pass the computed overlay kind');
    assert.ok(svgActionsSrc.includes("btn.closest('.diagram-widget')"),
        'diagram-html widget overlay must stay on the iframe-specific path');
});

