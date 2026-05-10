import { getJawCeoTranscript, insertJawCeoTranscript, pruneJawCeoTranscript } from '../core/db.js';
import type { JawCeoTranscriptEntry, JawCeoTranscriptRole } from './types.js';

type TranscriptRow = {
    id: string;
    at: string;
    role: string;
    text: string;
    source: string | null;
};

const VALID_ROLES = new Set<JawCeoTranscriptRole>(['user', 'ceo', 'tool']);
const VALID_SOURCES = new Set<JawCeoTranscriptEntry['source']>(['text', 'voice', 'completion', 'system']);

export function loadJawCeoTranscript(limit = 500): JawCeoTranscriptEntry[] {
    const boundedLimit = Math.max(1, Math.min(2_000, limit));
    const rows = getJawCeoTranscript.all(boundedLimit) as TranscriptRow[];
    return rows
        .reverse()
        .filter(row => VALID_ROLES.has(row.role as JawCeoTranscriptRole))
        .map(row => {
            const source = VALID_SOURCES.has(row.source as JawCeoTranscriptEntry['source'])
                ? row.source as JawCeoTranscriptEntry['source']
                : 'system';
            return {
                id: row.id,
                at: row.at,
                role: row.role as JawCeoTranscriptRole,
                text: row.text,
                source,
            };
        });
}

export function persistJawCeoTranscript(entry: JawCeoTranscriptEntry, maxRows = 500): void {
    const boundedLimit = Math.max(1, Math.min(2_000, maxRows));
    insertJawCeoTranscript.run(entry.id, entry.at, entry.role, entry.text, entry.source ?? null);
    pruneJawCeoTranscript.run(boundedLimit);
}
