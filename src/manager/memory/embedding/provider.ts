export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize: number;
}

export interface EmbeddingConfig {
  enabled: boolean;
  provider: 'openai' | 'gemini' | 'voyage' | 'local';
  model: string;
  apiKey: string;
  dimensions: number;
  searchMode: 'fts5' | 'embedding' | 'hybrid';
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  provider: 'openai',
  model: 'text-embedding-3-small',
  apiKey: '',
  dimensions: 1536,
  searchMode: 'hybrid',
};

export async function createProvider(config: EmbeddingConfig): Promise<EmbeddingProvider> {
  const apiKey = config.apiKey.startsWith('$')
    ? process.env[config.apiKey.slice(1)] || ''
    : config.apiKey;
  if (!apiKey && config.provider !== 'local') {
    throw new Error(`Embedding API key required for provider: ${config.provider}`);
  }

  switch (config.provider) {
    case 'openai':
      return createOpenAIProvider(apiKey, config.model, config.dimensions);
    case 'gemini':
      return createGeminiProvider(apiKey, config.model, config.dimensions);
    case 'voyage':
      return createVoyageProvider(apiKey, config.model, config.dimensions);
    case 'local':
      return createLocalProvider(config.model, config.dimensions);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

function createOpenAIProvider(apiKey: string, model: string, dimensions: number): EmbeddingProvider {
  const baseUrl = 'https://api.openai.com/v1';
  return {
    name: 'openai',
    model,
    dimensions,
    maxBatchSize: 2048,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const resp = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: texts, model, dimensions }),
      });
      if (!resp.ok) throw new Error(`OpenAI embed failed: ${resp.status} ${await resp.text()}`);
      const data = await resp.json() as { data: Array<{ embedding: number[] }> };
      return data.data.map(d => new Float32Array(d.embedding));
    },
  };
}

function createGeminiProvider(apiKey: string, model: string, dimensions: number): EmbeddingProvider {
  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
  return {
    name: 'gemini',
    model: model || 'gemini-embedding-001',
    dimensions,
    maxBatchSize: 24,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const resp = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: texts, model: model || 'gemini-embedding-001', dimensions }),
      });
      if (!resp.ok) throw new Error(`Gemini embed failed: ${resp.status} ${await resp.text()}`);
      const data = await resp.json() as { data: Array<{ embedding: number[] }> };
      return data.data.map(d => new Float32Array(d.embedding));
    },
  };
}

function createVoyageProvider(apiKey: string, model: string, dimensions: number): EmbeddingProvider {
  return {
    name: 'voyage',
    model: model || 'voyage-3-lite',
    dimensions,
    maxBatchSize: 128,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const resp = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: texts, model: model || 'voyage-3-lite' }),
      });
      if (!resp.ok) throw new Error(`Voyage embed failed: ${resp.status} ${await resp.text()}`);
      const data = await resp.json() as { data: Array<{ embedding: number[] }> };
      return data.data.map(d => new Float32Array(d.embedding));
    },
  };
}

function createLocalProvider(_model: string, dimensions: number): EmbeddingProvider {
  return {
    name: 'local',
    model: 'stub',
    dimensions,
    maxBatchSize: 32,
    async embed(_texts: string[]): Promise<Float32Array[]> {
      throw new Error('Local embedding provider not yet implemented (Phase 3)');
    },
  };
}
