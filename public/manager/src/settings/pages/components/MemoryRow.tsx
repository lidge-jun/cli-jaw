// Phase 6 — single row in the Memory browse table.
//
// Pure presentational. Clicking the row opens a read-only modal with
// the full value. The modal is owned by the parent Memory page so
// only one is mounted at a time and Esc/backdrop dismissal lives in
// one place.

import type { MemoryEntry } from './memory-helpers';
import { previewValue } from './memory-helpers';

type Props = {
    row: MemoryEntry;
    onOpen: (row: MemoryEntry) => void;
};

export function MemoryRow({ row, onOpen }: Props) {
    return (
        <tr className="settings-memory-row">
            <td className="settings-memory-key">
                <button
                    type="button"
                    className="settings-memory-link"
                    onClick={() => onOpen(row)}
                    aria-label={`Open memory entry ${row.key}`}
                >
                    {row.key}
                </button>
            </td>
            <td className="settings-memory-source">{row.source}</td>
            <td className="settings-memory-length">{row.value.length}</td>
            <td className="settings-memory-preview" title={row.value}>
                {previewValue(row.value)}
            </td>
        </tr>
    );
}
