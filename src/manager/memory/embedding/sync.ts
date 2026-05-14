import type { EmbeddingProvider } from './provider.js';
import { type VecStore } from './vec-store.js';
import Database from 'better-sqlite3';

export interface SyncResult {
  instanceId: string;
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

export interface SyncOptions {
  instances: Array<{ instanceId: string; dbPath: string; hasDb: boolean }>;
  vecStore: VecStore;
  provider: EmbeddingProvider;
  batchSize?: number;
  onProgress?: (instanceId: string, done: number, total: number) => void;
}

interface ChunkRow {
  id: number;
  relpath: string;
  kind: string;
  content_hash: string;
  content: string;
  source_start_line: number;
  source_end_line: number;
}

export async function syncAllInstances(opts: SyncOptions): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const inst of opts.instances) {
    if (!inst.hasDb) continue;
    try {
      const r = await syncInstance(inst.instanceId, inst.dbPath, opts);
      results.push(r);
    } catch (err) {
      results.push({
        instanceId: inst.instanceId,
        added: 0, updated: 0, deleted: 0, skipped: 0,
        errors: [String(err)],
      });
    }
  }
  return results;
}

async function syncInstance(
  instanceId: string,
  dbPath: string,
  opts: SyncOptions,
): Promise<SyncResult> {
  const srcDb = new Database(dbPath, { readonly: true });
  srcDb.pragma('busy_timeout = 3000');

  const result: SyncResult = { instanceId, added: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };
  const batchSize = opts.batchSize ?? opts.provider.maxBatchSize;

  try {
    const existingMap = opts.vecStore.getExistingHashes(instanceId);
    const srcChunks = srcDb.prepare(
      'SELECT id, relpath, kind, content_hash, content, source_start_line, source_end_line FROM chunks'
    ).all() as ChunkRow[];

    const srcIds = new Set<number>();
    const toEmbed: Array<{ chunk: ChunkRow; existingRowid: number | null }> = [];

    for (const chunk of srcChunks) {
      srcIds.add(chunk.id);
      const existing = existingMap.get(chunk.id);

      if (existing && existing.contentHash === chunk.content_hash) {
        result.skipped++;
        continue;
      }

      if (!chunk.content || chunk.content.trim().length < 10) {
        result.skipped++;
        continue;
      }

      toEmbed.push({
        chunk,
        existingRowid: existing ? existing.rowid : null,
      });
    }

    // Delete orphans (chunks removed from source)
    for (const [chunkId, meta] of existingMap) {
      if (!srcIds.has(chunkId)) {
        opts.vecStore.deleteByRowid(meta.rowid);
        result.deleted++;
      }
    }

    // Batch embed with retry + delay
    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const texts = batch.map(b => b.chunk.content);

      let embeddings: Float32Array[];
      try {
        embeddings = await opts.provider.embed(texts);
      } catch (err) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          embeddings = await opts.provider.embed(texts);
        } catch (retryErr) {
          result.errors.push(`Batch ${i}-${i + batch.length}: ${String(retryErr)}`);
          opts.onProgress?.(instanceId, Math.min(i + batchSize, toEmbed.length), toEmbed.length);
          continue;
        }
      }

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j]!;
        const embedding = embeddings[j]!;
        opts.vecStore.upsertVec(
          item.existingRowid,
          {
            chunkId: item.chunk.id,
            instanceId,
            relpath: item.chunk.relpath,
            kind: item.chunk.kind,
            contentHash: item.chunk.content_hash,
            snippet: item.chunk.content.slice(0, 700),
            sourceStartLine: item.chunk.source_start_line,
            sourceEndLine: item.chunk.source_end_line,
          },
          embedding,
          opts.provider.name,
          opts.provider.model,
        );
        if (item.existingRowid !== null) result.updated++;
        else result.added++;
      }

      opts.onProgress?.(instanceId, Math.min(i + batchSize, toEmbed.length), toEmbed.length);

      if (i + batchSize < toEmbed.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  } finally {
    srcDb.close();
  }

  return result;
}

export async function syncSingleFile(opts: {
  instanceId: string;
  dbPath: string;
  relpath: string;
  vecStore: VecStore;
  provider: EmbeddingProvider;
}): Promise<SyncResult> {
  const srcDb = new Database(opts.dbPath, { readonly: true });
  const result: SyncResult = {
    instanceId: opts.instanceId,
    added: 0, updated: 0, deleted: 0, skipped: 0, errors: [],
  };

  try {
    const srcChunks = srcDb.prepare(
      'SELECT id, relpath, kind, content_hash, content, source_start_line, source_end_line FROM chunks WHERE relpath = ?'
    ).all(opts.relpath) as ChunkRow[];

    const existingMap = opts.vecStore.getExistingHashesByRelpath(opts.instanceId, opts.relpath);
    const srcIds = new Set<number>();
    const toEmbed: Array<{ chunk: ChunkRow; existingRowid: number | null }> = [];

    for (const chunk of srcChunks) {
      srcIds.add(chunk.id);
      const existing = existingMap.get(chunk.id);
      if (existing && existing.contentHash === chunk.content_hash) {
        result.skipped++;
        continue;
      }
      if (!chunk.content || chunk.content.trim().length < 10) {
        result.skipped++;
        continue;
      }
      toEmbed.push({ chunk, existingRowid: existing?.rowid ?? null });
    }

    for (const [chunkId, meta] of existingMap) {
      if (!srcIds.has(chunkId)) {
        opts.vecStore.deleteByRowid(meta.rowid);
        result.deleted++;
      }
    }

    if (toEmbed.length > 0) {
      const texts = toEmbed.map(b => b.chunk.content);
      const embeddings = await opts.provider.embed(texts);
      for (let j = 0; j < toEmbed.length; j++) {
        const item = toEmbed[j]!;
        opts.vecStore.upsertVec(
          item.existingRowid,
          {
            chunkId: item.chunk.id,
            instanceId: opts.instanceId,
            relpath: item.chunk.relpath,
            kind: item.chunk.kind,
            contentHash: item.chunk.content_hash,
            snippet: item.chunk.content.slice(0, 700),
            sourceStartLine: item.chunk.source_start_line,
            sourceEndLine: item.chunk.source_end_line,
          },
          embeddings[j]!,
          opts.provider.name,
          opts.provider.model,
        );
        item.existingRowid !== null ? result.updated++ : result.added++;
      }
    }
  } finally {
    srcDb.close();
  }
  return result;
}
