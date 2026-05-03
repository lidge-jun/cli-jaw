import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { firstClipboardImage, firstRemoteClipboardImageUrl } from '../../public/manager/src/notes/image-assets/clipboard-images';
import { notesImageSrc } from '../../public/manager/src/notes/rendering/markdown-render-security';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

function file(name: string, type: string): File {
    return new File(['x'], name, { type });
}

test('clipboard image helper prefers items, falls back to files, and rejects SVG', () => {
    const png = file('', 'image/png');
    const svg = file('bad.svg', 'image/svg+xml');
    const fallbackGif = file('fallback.gif', 'image/gif');
    const data = {
        items: [
            { kind: 'file', type: 'image/svg+xml', getAsFile: () => svg },
            { kind: 'file', type: 'image/png', getAsFile: () => png },
        ],
        files: [fallbackGif],
    } as unknown as DataTransfer;

    const picked = firstClipboardImage(data);
    assert.equal(picked?.type, 'image/png');
    assert.equal(picked?.name, 'pasted-image.png');

    const fallback = firstClipboardImage({ items: [], files: [fallbackGif] } as unknown as DataTransfer);
    assert.equal(fallback?.name, 'fallback.gif');

    const rejected = firstClipboardImage({ items: [], files: [svg] } as unknown as DataTransfer);
    assert.equal(rejected, null);
});

test('clipboard image helper accepts HTML data image fallback from macOS/browser copy', () => {
    const pngBase64 = 'iVBORw0KGgo=';
    const data = {
        items: [],
        files: [],
        getData: (type: string) => type === 'text/html'
            ? `<img src="data:image/png;base64,${pngBase64}" alt="copied">`
            : '',
    } as unknown as DataTransfer;

    const picked = firstClipboardImage(data);
    assert.equal(picked?.type, 'image/png');
    assert.equal(picked?.name, 'pasted-image.png');
});

test('clipboard image helper extracts remote Chrome image copy URLs without accepting unsafe schemes', () => {
    const data = {
        items: [],
        files: [],
        getData: (type: string) => {
            if (type === 'text/html') return '<img src="https://example.com/copied.png" alt="copied">';
            if (type === 'text/plain') return 'https://example.com/fallback.png';
            return '';
        },
    } as unknown as DataTransfer;

    assert.equal(firstRemoteClipboardImageUrl(data), 'https://example.com/copied.png');
    assert.equal(firstRemoteClipboardImageUrl({
        items: [],
        files: [],
        getData: (type: string) => type === 'text/html' ? '<img src="javascript:alert(1)">' : '',
    } as unknown as DataTransfer), null);
});

test('remote clipboard image URL detection accepts image extensions and rejects non-image URLs', () => {
    function remoteUrlData(plain: string, html = ''): DataTransfer {
        return {
            items: [],
            files: [],
            getData: (type: string) => {
                if (type === 'text/html') return html;
                if (type === 'text/plain') return plain;
                return '';
            },
        } as unknown as DataTransfer;
    }

    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('https://cdn.example.com/photo.png')));
    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('https://cdn.example.com/photo.jpg')));
    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('https://cdn.example.com/photo.jpeg')));
    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('https://cdn.example.com/photo.webp')));
    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('https://cdn.example.com/photo.gif')));
    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('https://cdn.example.com/photo.JPG')));
    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('https://cdn.example.com/photo.PNG')));

    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('https://cdn.example.com/photo.png?w=100')));
    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('https://cdn.example.com/photo.webp#frag')));

    assert.equal(firstRemoteClipboardImageUrl(remoteUrlData('https://example.com/doc.pdf')), null);
    assert.equal(firstRemoteClipboardImageUrl(remoteUrlData('https://example.com/image.svg')), null);
    assert.equal(firstRemoteClipboardImageUrl(remoteUrlData('https://example.com/image.avif')), null);
    assert.equal(firstRemoteClipboardImageUrl(remoteUrlData('https://example.com/image.bmp')), null);
    assert.equal(firstRemoteClipboardImageUrl(remoteUrlData('https://example.com/image.ico')), null);

    assert.equal(firstRemoteClipboardImageUrl(remoteUrlData('https://example.com/photo')), null);
    assert.equal(firstRemoteClipboardImageUrl(remoteUrlData('https://example.com/')), null);
    assert.equal(firstRemoteClipboardImageUrl(remoteUrlData('just some text')), null);
    assert.equal(firstRemoteClipboardImageUrl(remoteUrlData('')), null);

    assert.ok(firstRemoteClipboardImageUrl(remoteUrlData('', '<img src="https://cdn.example.com/dynamic-image">')));
});

test('notes image URL resolver maps only safe asset paths and blocks dangerous URLs', () => {
    assert.equal(
        notesImageSrc('./.assets/project__meeting/file.png'),
        '/api/dashboard/notes/asset?path=.assets%2Fproject__meeting%2Ffile.png',
    );
    assert.equal(notesImageSrc('.assets/project__meeting/file.png').startsWith('/api/dashboard/notes/asset?path='), true);
    assert.equal(notesImageSrc('javascript:alert(1)'), '');
    assert.equal(notesImageSrc('data:image/png;base64,abc'), '');
    assert.equal(notesImageSrc('file:///Users/jun/image.png'), '');
    assert.equal(notesImageSrc('/Users/jun/image.png'), '');
});

test('notes image paste is wired through JSON upload and all authoring surfaces', () => {
    const api = read('public/manager/src/api.ts');
    const editor = read('public/manager/src/notes/MarkdownEditor.tsx');
    const richPaste = read('public/manager/src/notes/rich-markdown/paste-policy.ts');
    const wysiwyg = read('public/manager/src/notes/wysiwyg/MilkdownWysiwygEditor.tsx');
    const workspace = read('public/manager/src/notes/NotesWorkspace.tsx');
    const renderer = read('public/manager/src/notes/rendering/MarkdownRenderer.tsx');

    assert.ok(api.includes('export async function uploadNoteAsset'), 'API client must expose note asset upload');
    assert.ok(api.includes('export async function uploadRemoteNoteAsset'), 'API client must expose remote note asset upload');
    assert.ok(api.includes("fetch('/api/dashboard/notes/asset'"), 'upload must POST to the notes asset route');
    assert.ok(api.includes("fetch('/api/dashboard/notes/asset/remote'"), 'remote upload must POST to the remote asset route');
    assert.ok(api.includes('JSON.stringify({'), 'upload must send JSON');
    assert.equal(api.includes('FormData'), false, 'upload must not use multipart FormData in v1');
    assert.ok(editor.includes('notePath: string'), 'MarkdownEditor must receive the selected note path');
    assert.ok(workspace.includes('notePath={props.selectedPath}'), 'NotesWorkspace must pass selectedPath to the editor');
    assert.ok(richPaste.includes('handleClipboardImagePaste(event, view, options)'), 'CodeMirror paste policy must handle image blobs before HTML');
    assert.ok(richPaste.includes('drop(event, view)'), 'CodeMirror policy must handle dropped images');
    assert.ok(wysiwyg.includes('hasImportableClipboardImage('), 'WYSIWYG paste must inspect local and remote clipboard images');
    assert.ok(wysiwyg.includes("addEventListener('drop'") || wysiwyg.includes('onDropCapture={handleDropCapture}'), 'WYSIWYG must accept dropped images');
    assert.ok(wysiwyg.includes('uploadClipboardImageMarkdown(notePathRef.current') || wysiwyg.includes('uploadClipboardImageMarkdown(props.notePath'), 'WYSIWYG paste must upload against the current note path');
    assert.ok(wysiwyg.includes('notesImageSrc(originalSrc)'), 'WYSIWYG must route local asset image nodes through the notes asset endpoint');
    assert.ok(wysiwyg.includes('new MutationObserver'), 'WYSIWYG must refresh image src after Milkdown renders image nodes');
    assert.ok(wysiwyg.includes('setUploadStatus'), 'WYSIWYG must show upload progress feedback');

    const insertImage = read('public/manager/src/notes/image-assets/insert-image-markdown.ts');
    assert.ok(insertImage.includes('NOTE_IMAGE_MAX_BYTES'), 'upload must precheck file size before sending');
    assert.ok(renderer.includes('img: ({ src, alt'), 'MarkdownRenderer must own image rendering');
    assert.ok(renderer.includes('notesImageSrc(src)'), 'MarkdownRenderer must route image src through the Notes asset resolver');
});

test('notes asset backend route is parser-isolated from the generic notes JSON limit', () => {
    const server = read('src/manager/server.ts');
    const routes = read('src/manager/notes/routes.ts');
    const routeTest = read('tests/unit/manager-notes-routes.test.ts');

    assert.equal(server.includes("express.json({ limit: '1100kb' })"), false,
        'server must not mount the generic notes parser before the asset route');
    assert.ok(routes.includes("router.post('/asset', express.json({ limit: NOTE_ASSET_JSON_LIMIT })"),
        'asset route must use the route-specific asset JSON limit');
    assert.ok(routes.indexOf("router.post('/asset'") < routes.indexOf("router.use(express.json({ limit: '1100kb' })"),
        'asset parser must run before the generic notes parser');
    assert.equal(routeTest.includes("express.json({ limit: '1100kb' })"), false,
        'route tests must exercise production parser ordering');
});
