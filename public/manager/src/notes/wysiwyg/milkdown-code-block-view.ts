import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view';
import { $view } from '@milkdown/kit/utils';

function codeText(node: ProseMirrorNode): string {
    return node.textContent;
}

function codeLanguage(node: ProseMirrorNode): string {
    return String(node.attrs.language ?? '');
}

function fencedCodeSource(node: ProseMirrorNode): string {
    const language = codeLanguage(node);
    return `\`\`\`${language}\n${codeText(node)}\n\`\`\``;
}

function parseFencedCodeSource(source: string): { language: string; code: string } {
    const normalized = source.replace(/\r\n?/g, '\n');
    const match = normalized.match(/^```([^\n`]*)\n?([\s\S]*?)\n?```\s*$/);
    if (!match) return { language: '', code: normalized };
    return {
        language: match[1]?.trim().toLowerCase().replace(/[^a-z0-9_+-]/g, '') ?? '',
        code: match[2] ?? '',
    };
}

function isClosedFencedCodeSource(source: string): boolean {
    return /^```[^\n`]*\n?[\s\S]*?\n?```\s*$/.test(source.replace(/\r\n?/g, '\n'));
}

function isCaretAtEnd(input: HTMLTextAreaElement): boolean {
    return input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
}

function updateCodeBlockNode(view: EditorView, getPos: () => number | undefined, source: string): void {
    const pos = getPos();
    if (pos === undefined) return;
    const current = view.state.doc.nodeAt(pos);
    if (!current) return;
    const parsed = parseFencedCodeSource(source);
    const nextText = parsed.code ? view.state.schema.text(parsed.code) : [];
    const tr = view.state.tr
        .setNodeMarkup(pos, undefined, { ...current.attrs, language: parsed.language })
        .replaceWith(pos + 1, pos + current.nodeSize - 1, nextText)
        .scrollIntoView();
    view.dispatch(tr);
}

function moveAfterCodeBlock(view: EditorView, getPos: () => number | undefined): void {
    const pos = getPos();
    if (pos === undefined) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    const after = pos + node.nodeSize;
    const paragraph = view.state.schema.nodes.paragraph?.create();
    if (!paragraph) return;
    const tr = view.state.tr.insert(after, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    view.dispatch(tr.scrollIntoView());
}

function createCodeBlockView(): NodeViewConstructor {
    return (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView => {
        let currentNode = node;
        const dom = document.createElement('div');
        const rendered = document.createElement('div');
        const header = document.createElement('div');
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        const raw = document.createElement('textarea');

        dom.className = 'notes-code-source-node';
        rendered.className = 'notes-code-rendered';
        header.className = 'notes-code-source-header';
        raw.className = 'notes-code-raw';
        raw.setAttribute('aria-label', 'Edit fenced code source');
        dom.contentEditable = 'false';
        dom.tabIndex = 0;
        pre.append(code);
        rendered.append(header, pre);
        dom.append(rendered, raw);

        function sync(): void {
            const language = codeLanguage(currentNode);
            const source = codeText(currentNode);
            dom.dataset.language = language;
            pre.dataset.language = language;
            header.textContent = language || 'code';
            code.textContent = source;
            if (dom.dataset.editing !== 'true') raw.value = fencedCodeSource(currentNode);
        }

        function setEditing(editing: boolean): void {
            if (dom.dataset.editing === 'true' && editing) return;
            if (!editing && dom.dataset.editing === 'true') updateCodeBlockNode(view, getPos, raw.value);
            dom.dataset.editing = editing ? 'true' : 'false';
            if (editing) {
                raw.value = fencedCodeSource(currentNode);
                raw.focus();
                raw.select();
            }
        }

        function revealRawControl(targetDom: Element | null): void {
            if (!(targetDom instanceof HTMLElement)) return;
            const targetRaw = targetDom.querySelector('textarea.notes-code-raw');
            if (!(targetRaw instanceof HTMLTextAreaElement)) return;
            targetDom.dataset.editing = 'true';
            targetRaw.focus();
            targetRaw.select();
        }

        function openFromRenderedEvent(event: Event): void {
            if (raw.contains(event.target as Node)) return;
            if (dom.dataset.editing === 'true') return;
            event.preventDefault();
            event.stopPropagation();
            const pointer = event instanceof PointerEvent || event instanceof MouseEvent
                ? { x: event.clientX, y: event.clientY }
                : null;
            setTimeout(() => {
                if (dom.isConnected) {
                    setEditing(true);
                    return;
                }
                const targetDom = pointer
                    ? document.elementFromPoint(pointer.x, pointer.y)?.closest('.notes-code-source-node') ?? null
                    : null;
                revealRawControl(targetDom);
            }, 0);
        }

        dom.addEventListener('pointerdown', openFromRenderedEvent, { capture: true });
        dom.addEventListener('mousedown', openFromRenderedEvent, { capture: true });
        dom.addEventListener('click', openFromRenderedEvent);
        dom.addEventListener('keydown', event => {
            if (dom.dataset.editing === 'true') return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setEditing(true);
            }
        });
        raw.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setEditing(false);
                view.focus();
            }
            if (event.key === 'Enter' && isClosedFencedCodeSource(raw.value) && isCaretAtEnd(raw)) {
                event.preventDefault();
                setEditing(false);
                moveAfterCodeBlock(view, getPos);
                view.focus();
                return;
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                setEditing(false);
                view.focus();
            }
        });
        raw.addEventListener('input', () => {
            updateCodeBlockNode(view, getPos, raw.value);
            if (isClosedFencedCodeSource(raw.value) && isCaretAtEnd(raw)) {
                setTimeout(() => {
                    setEditing(false);
                    moveAfterCodeBlock(view, getPos);
                    view.focus();
                }, 0);
            }
        });
        raw.addEventListener('mousedown', event => event.stopPropagation());
        raw.addEventListener('click', event => event.stopPropagation());

        sync();

        return {
            dom,
            update: nextNode => {
                if (nextNode.type !== currentNode.type) return false;
                currentNode = nextNode;
                sync();
                return true;
            },
            selectNode: () => {
                dom.dataset.selected = 'true';
            },
            deselectNode: () => {
                dom.dataset.selected = 'false';
            },
            stopEvent: event =>
                event.target === raw
                || raw.contains(event.target as Node)
                || event.type === 'pointerdown'
                || event.type === 'mousedown'
                || event.type === 'click',
            ignoreMutation: mutation =>
                mutation.target === dom
                || mutation.target === raw
                || raw.contains(mutation.target as Node)
                || rendered.contains(mutation.target),
        };
    };
}

export const notesCodeBlockSourceView = $view(codeBlockSchema.node, () => createCodeBlockView());

export const notesMilkdownCodeBlockView: MilkdownPlugin[] = [
    notesCodeBlockSourceView,
].flat();
