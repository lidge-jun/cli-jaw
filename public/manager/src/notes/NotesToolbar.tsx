import type { NotesAuthoringMode, NotesViewMode } from './notes-types';
import { canSaveNote, noteDisplayName } from './note-revisions';

type NotesPrimaryMode = 'raw' | 'split' | 'preview' | 'wysiwyg';

type NotesToolbarProps = {
    selectedPath: string | null;
    viewMode: NotesViewMode;
    authoringMode: NotesAuthoringMode;
    dirty: boolean;
    saving: boolean;
    loading: boolean;
    conflict: boolean;
    onViewModeChange: (mode: NotesViewMode) => void;
    onAuthoringModeChange: (mode: NotesAuthoringMode) => void;
    onSave: () => void;
    onReload: () => void;
};

const PRIMARY_MODES: NotesPrimaryMode[] = ['raw', 'split', 'preview', 'wysiwyg'];

function primaryModeLabel(mode: NotesPrimaryMode): string {
    if (mode === 'raw') return 'Raw';
    if (mode === 'split') return 'Split';
    if (mode === 'preview') return 'Preview';
    return 'WYSIWYG';
}

function activePrimaryMode(viewMode: NotesViewMode, authoringMode: NotesAuthoringMode): NotesPrimaryMode | null {
    if (viewMode === 'settings') return null;
    if (viewMode === 'split') return 'split';
    if (viewMode === 'preview') return 'preview';
    if (authoringMode === 'wysiwyg') return 'wysiwyg';
    return 'raw';
}

export function NotesToolbar(props: NotesToolbarProps) {
    function activatePrimaryMode(mode: NotesPrimaryMode): void {
        if (mode === 'split') {
            props.onViewModeChange('split');
            props.onAuthoringModeChange('plain');
            return;
        }
        if (mode === 'preview') {
            props.onViewModeChange('preview');
            return;
        }
        props.onViewModeChange('raw');
        props.onAuthoringModeChange(mode === 'wysiwyg' ? 'wysiwyg' : 'plain');
    }

    const activeMode = activePrimaryMode(props.viewMode, props.authoringMode);

    return (
        <div className="notes-toolbar">
            <div className="notes-toolbar-title">
                <strong>{noteDisplayName(props.selectedPath)}</strong>
                <span>{props.conflict ? 'Conflict' : props.dirty ? 'Unsaved' : 'Saved'}</span>
            </div>
            <div className="notes-toolbar-actions">
                <div className="notes-view-tabs" role="tablist" aria-label="Notes view">
                    {PRIMARY_MODES.map(mode => (
                        <button
                            key={mode}
                            type="button"
                            role="tab"
                            aria-selected={activeMode === mode}
                            className={activeMode === mode ? 'is-active' : ''}
                            disabled={!props.selectedPath}
                            onClick={() => activatePrimaryMode(mode)}
                        >
                            {primaryModeLabel(mode)}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    className={props.viewMode === 'settings' ? 'is-active' : ''}
                    onClick={() => props.onViewModeChange('settings')}
                >
                    Settings
                </button>
                <button type="button" onClick={props.onReload} disabled={!props.selectedPath || props.loading}>
                    Refresh
                </button>
                <button
                    type="button"
                    className="notes-save-button"
                    onClick={props.onSave}
                    disabled={!canSaveNote(props.selectedPath, props.dirty, props.saving)}
                >
                    {props.saving ? 'Saving' : 'Save'}
                </button>
            </div>
        </div>
    );
}
