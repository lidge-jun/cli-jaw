import { useEffect, useRef, useState } from 'react';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { NotesEmptyState } from './NotesEmptyState';
import { NotesFrontmatterStrip } from './NotesFrontmatterStrip';
import { NotesQuickSwitcher } from './NotesQuickSwitcher';
import { NotesToolbar } from './NotesToolbar';
import { renameNotePath } from './notes-api';
import { useNoteDocument } from './useNoteDocument';
import { publishInvalidation } from '../sync/invalidation-bus';
import type { NotesAuthoringMode, NotesNoteMetadata, NotesVaultIndexSnapshot, NotesViewMode } from './notes-types';

type NotesPrimaryMode = 'raw' | 'preview' | 'wysiwyg';

type NotesWorkspaceProps = {
    active: boolean;
    selectedPath: string | null;
    selectedNote: NotesNoteMetadata | null;
    vaultIndex: NotesVaultIndexSnapshot | null;
    viewMode: NotesViewMode;
    authoringMode: NotesAuthoringMode;
    wordWrap: boolean;
    treeWidth: number;
    tagFilter: string | null;
    onOpenSidebarSearch: () => void;
    onSelectedPathChange: (path: string | null) => void;
    onDirtyPathChange: (path: string | null) => void;
    onViewModeChange: (mode: NotesViewMode) => void;
    onAuthoringModeChange: (mode: NotesAuthoringMode) => void;
    onWordWrapChange: (value: boolean) => void;
    onTreeWidthChange: (value: number) => void;
    onTagSelect: (tag: string | null) => void;
    onWikiLinkNavigate: (path: string) => void;
};

const PRIMARY_MODE_CYCLE: NotesPrimaryMode[] = ['raw', 'preview', 'wysiwyg'];
const INVALID_TITLE_CHARS = /[/\\]/g;

function titleFromPath(path: string): string {
    const name = path.split('/').pop() ?? path;
    return name.endsWith('.md') ? name.slice(0, -3) : name;
}

function primaryModeFor(viewMode: NotesViewMode, authoringMode: NotesAuthoringMode): NotesPrimaryMode {
    if (viewMode === 'preview') return 'preview';
    if (authoringMode === 'wysiwyg') return 'wysiwyg';
    return 'raw';
}

export function NotesWorkspace(props: NotesWorkspaceProps) {
    const document = useNoteDocument();
    const renamingRef = useRef(false);
    const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);

    useEffect(() => {
        if (!props.selectedPath) return;
        void document.load(props.selectedPath);
    }, [props.selectedPath]);

    useEffect(() => {
        props.onDirtyPathChange(document.dirty ? props.selectedPath : null);
    }, [document.dirty, props.selectedPath]);

    useEffect(() => {
        if (!props.active) return;
        function handleSaveShortcut(event: KeyboardEvent): void {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
            event.preventDefault();
            void document.save();
        }

        window.addEventListener('keydown', handleSaveShortcut);
        return () => window.removeEventListener('keydown', handleSaveShortcut);
    }, [document.save, props.active]);

    useEffect(() => {
        if (!props.active) return;
        function handleModeShortcut(event: KeyboardEvent): void {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'e') return;
            event.preventDefault();
            const current = primaryModeFor(props.viewMode, props.authoringMode);
            const next = PRIMARY_MODE_CYCLE[(PRIMARY_MODE_CYCLE.indexOf(current) + 1) % PRIMARY_MODE_CYCLE.length];
            if (next === 'preview') {
                props.onViewModeChange('preview');
                return;
            }
            props.onViewModeChange('raw');
            props.onAuthoringModeChange(next === 'wysiwyg' ? 'wysiwyg' : 'plain');
        }

        window.addEventListener('keydown', handleModeShortcut);
        return () => window.removeEventListener('keydown', handleModeShortcut);
    }, [props.active, props.viewMode, props.authoringMode, props.onViewModeChange, props.onAuthoringModeChange]);

    useEffect(() => {
        if (!props.active) return;
        function handleSearchShortcut(event: KeyboardEvent): void {
            if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'f') return;
            event.preventDefault();
            props.onOpenSidebarSearch();
        }

        window.addEventListener('keydown', handleSearchShortcut);
        return () => window.removeEventListener('keydown', handleSearchShortcut);
    }, [props.active, props.onOpenSidebarSearch]);

    useEffect(() => {
        if (!props.active) return;
        function handleQuickSwitcherShortcut(event: KeyboardEvent): void {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'p') return;
            event.preventDefault();
            setQuickSwitcherOpen(open => !open);
        }

        window.addEventListener('keydown', handleQuickSwitcherShortcut);
        return () => window.removeEventListener('keydown', handleQuickSwitcherShortcut);
    }, [props.active]);

    async function handleTitleBlur(event: React.FocusEvent<HTMLInputElement>): Promise<void> {
        if (renamingRef.current || !props.selectedPath) return;
        const newTitle = event.currentTarget.value.trim().replace(INVALID_TITLE_CHARS, '');
        const currentTitle = titleFromPath(props.selectedPath);
        if (!newTitle || newTitle === currentTitle) {
            event.currentTarget.value = currentTitle;
            return;
        }
        const parts = props.selectedPath.split('/');
        parts[parts.length - 1] = newTitle.endsWith('.md') ? newTitle : `${newTitle}.md`;
        const newPath = parts.join('/');
        if (newPath === props.selectedPath) {
            event.currentTarget.value = currentTitle;
            return;
        }
        renamingRef.current = true;
        try {
            await renameNotePath(props.selectedPath, newPath);
            props.onSelectedPathChange(newPath);
            publishInvalidation({ topics: ['notes'], reason: 'note:title-renamed', source: 'ui' });
        } catch (error) {
            console.warn('[notes-rename]', error);
            event.currentTarget.value = currentTitle;
        } finally {
            renamingRef.current = false;
        }
    }

    const showEditor = props.viewMode === 'raw' || props.viewMode === 'split';
    const showPreview = props.viewMode === 'preview' || props.viewMode === 'split';
    const selectedOutgoingLinks = (props.selectedPath && props.vaultIndex?.outgoingLinks?.[props.selectedPath]) || [];
    const wysiwygOwnsFrontmatter = props.authoringMode === 'wysiwyg' && showEditor;

    return (
        <section className="notes-workspace" aria-label="Notes workspace">
            <main className={`notes-main notes-mode-${props.viewMode}`}>
                <NotesToolbar
                    selectedPath={props.selectedPath}
                    viewMode={props.viewMode}
                    authoringMode={props.authoringMode}
                    dirty={document.dirty}
                    saving={document.saving}
                    loading={document.loading}
                    conflict={Boolean(document.conflict)}
                    onViewModeChange={props.onViewModeChange}
                    onAuthoringModeChange={props.onAuthoringModeChange}
                    onSave={() => void document.save()}
                    onReload={() => void document.reloadFromDisk()}
                />
                <div className="notes-content">
                    {document.error && <section className="state error-state">{document.error}</section>}
                    {document.conflict && (
                        <section className="notes-conflict">
                            <span>{document.conflict.message}</span>
                            <button type="button" onClick={() => void document.reloadFromDisk()}>Reload</button>
                            <button type="button" onClick={() => void document.overwrite()}>Overwrite</button>
                            <button type="button" onClick={document.clearConflict}>Keep local</button>
                        </section>
                    )}
                    {props.viewMode === 'settings' && (
                        <section className="notes-settings">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={props.wordWrap}
                                    onChange={event => props.onWordWrapChange(event.currentTarget.checked)}
                                />
                                Word wrap
                            </label>
                            <label>
                                Tree width
                                <input
                                    type="range"
                                    min="220"
                                    max="420"
                                    value={props.treeWidth}
                                    onChange={event => props.onTreeWidthChange(Number(event.currentTarget.value))}
                                />
                            </label>
                        </section>
                    )}
                    {!props.selectedPath && props.viewMode !== 'settings' && <NotesEmptyState />}
                    {props.selectedPath && props.viewMode !== 'settings' && (
                        <div className="notes-document-grid">
                            <input
                                className="notes-inline-title"
                                key={props.selectedPath}
                                defaultValue={titleFromPath(props.selectedPath)}
                                onBlur={handleTitleBlur}
                                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                                spellCheck={false}
                                aria-label="Note title"
                            />
                            {!wysiwygOwnsFrontmatter && (
                                <NotesFrontmatterStrip
                                    note={props.selectedNote}
                                    activeTag={props.tagFilter}
                                    onTagClick={props.onTagSelect}
                                />
                            )}
                            {showEditor && <div className="notes-editor-pane">
                                <MarkdownEditor
                                    key={props.selectedPath}
                                    active={props.active && showEditor}
                                    authoringMode={props.authoringMode}
                                    content={document.content}
                                    notePath={props.selectedPath}
                                    outgoing={selectedOutgoingLinks}
                                    activeTag={props.tagFilter}
                                    wordWrap={props.wordWrap}
                                    onChange={document.setContent}
                                    onTagSelect={props.onTagSelect}
                                    onWikiLinkNavigate={props.onWikiLinkNavigate}
                                />
                            </div>}
                            {showPreview && (
                                <MarkdownPreview
                                    markdown={document.content}
                                    outgoing={selectedOutgoingLinks}
                                    onWikiLinkNavigate={props.onWikiLinkNavigate}
                                />
                            )}
                        </div>
                    )}
                </div>
            </main>
            <NotesQuickSwitcher
                open={quickSwitcherOpen}
                notes={props.vaultIndex?.notes || []}
                selectedPath={props.selectedPath}
                onClose={() => setQuickSwitcherOpen(false)}
                onSelect={(path) => {
                    props.onSelectedPathChange(path);
                    setQuickSwitcherOpen(false);
                }}
            />
        </section>
    );
}
