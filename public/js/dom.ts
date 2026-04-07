// ── DOM Builder ──
// Type-safe element creation utility. Replaces innerHTML string concatenation.

type Attrs = Record<string, string | boolean | EventListener>;

export function el(
    tag: string,
    attrs?: Attrs,
    children?: (Node | string)[]
): HTMLElement {
    const element = document.createElement(tag);
    if (attrs) {
        for (const [key, val] of Object.entries(attrs)) {
            if (typeof val === 'function') {
                element.addEventListener(key.replace(/^on/, '').toLowerCase(), val as EventListener);
            } else if (typeof val === 'boolean') {
                if (val) element.setAttribute(key, '');
            } else {
                element.setAttribute(key, val);
            }
        }
    }
    if (children) {
        for (const child of children) {
            element.append(typeof child === 'string' ? document.createTextNode(child) : child);
        }
    }
    return element;
}
