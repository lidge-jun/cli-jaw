import type { EmbeddingConfig } from './provider.js';
import type { VecStore } from './vec-store.js';

export type EmbeddingState =
  | 'OFF'
  | 'CONFIGURED_NOT_TESTED'
  | 'TEST_FAILED'
  | 'INDEXING'
  | 'PARTIALLY_INDEXED'
  | 'ACTIVE_HYBRID'
  | 'DEGRADED_FALLBACK_FTS5'
  | 'NEEDS_REINDEX';

export interface EmbeddingStatus {
  state: EmbeddingState;
  enabled: boolean;
  active: boolean;
  mode: string;
  provider: string;
  model: string;
  indexedChunks: number;
  totalChunks: number;
  fallback: 'fts5' | null;
  reason: string;
  lastSyncAt: string | null;
  dbSizeBytes: number;
}

const DEFAULTS: EmbeddingStatus = {
  state: 'OFF',
  enabled: false,
  active: false,
  mode: 'fts5',
  provider: '',
  model: '',
  indexedChunks: 0,
  totalChunks: 0,
  fallback: null,
  reason: '',
  lastSyncAt: null,
  dbSizeBytes: 0,
};

export function getEmbeddingState(opts: {
  settings: EmbeddingConfig | null;
  vecStore: VecStore | null;
  dashboardRunning: boolean;
  totalSourceChunks: number;
  lastTestResult?: 'ok' | 'fail' | null;
  isIndexing?: boolean;
}): EmbeddingStatus {
  const base = {
    ...DEFAULTS,
    provider: opts.settings?.provider || '',
    model: opts.settings?.model || '',
    mode: opts.settings?.searchMode || 'fts5',
    totalChunks: opts.totalSourceChunks,
  };

  if (!opts.settings || !opts.settings.enabled) {
    return { ...base, state: 'OFF', reason: 'disabled' };
  }
  base.enabled = true;

  if (opts.lastTestResult === 'fail') {
    return { ...base, state: 'TEST_FAILED', reason: 'api_test_failed', fallback: 'fts5' };
  }

  if (opts.lastTestResult == null && !opts.vecStore) {
    return { ...base, state: 'CONFIGURED_NOT_TESTED', reason: 'never_tested' };
  }

  if (!opts.dashboardRunning) {
    return { ...base, state: 'DEGRADED_FALLBACK_FTS5', fallback: 'fts5', reason: 'dashboard_not_running' };
  }

  if (!opts.vecStore) {
    return { ...base, state: 'DEGRADED_FALLBACK_FTS5', fallback: 'fts5', reason: 'vecstore_unavailable' };
  }

  if (opts.isIndexing) {
    const stats = opts.vecStore.getStats();
    return { ...base, state: 'INDEXING', indexedChunks: stats.totalChunks, dbSizeBytes: stats.dbSizeBytes };
  }

  const stats = opts.vecStore.getStats();
  base.indexedChunks = stats.totalChunks;
  base.dbSizeBytes = stats.dbSizeBytes;

  const storedProvider = opts.vecStore.getConfig('provider');
  if (storedProvider && storedProvider !== opts.settings.provider) {
    return { ...base, state: 'NEEDS_REINDEX', reason: 'provider_changed' };
  }

  const storedModel = opts.vecStore.getConfig('model');
  if (storedModel && storedModel !== opts.settings.model) {
    return { ...base, state: 'NEEDS_REINDEX', reason: 'model_changed' };
  }

  if (opts.totalSourceChunks > 0 && stats.totalChunks === 0) {
    return { ...base, state: 'CONFIGURED_NOT_TESTED', reason: 'never_indexed' };
  }

  if (stats.totalChunks < opts.totalSourceChunks && opts.totalSourceChunks > 0) {
    return { ...base, state: 'PARTIALLY_INDEXED', reason: 'incomplete' };
  }

  const lastSync = opts.vecStore.getConfig('lastSyncAt');
  return {
    ...base,
    state: 'ACTIVE_HYBRID',
    active: true,
    lastSyncAt: lastSync || null,
  };
}
