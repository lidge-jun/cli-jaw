export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize: number;
}

export interface EmbeddingConfig {
  enabled: boolean;
  provider: 'openai' | 'gemini' | 'voyage' | 'vertex' | 'local';
  model: string;
  apiKey: string;
  baseUrl?: string;
  dimensions: number;
  searchMode: 'fts5' | 'embedding' | 'hybrid';
  vertexProject?: string;
  vertexRegion?: string;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  provider: 'openai',
  model: 'text-embedding-3-small',
  apiKey: '',
  dimensions: 1536,
  searchMode: 'hybrid',
};

export const PROVIDER_PRESETS: Record<string, { model: string; dimensions: number }> = {
  openai: { model: 'text-embedding-3-small', dimensions: 1536 },
  gemini: { model: 'gemini-embedding-001', dimensions: 768 },
  voyage: { model: 'voyage-3-lite', dimensions: 512 },
  vertex: { model: 'text-embedding-005', dimensions: 768 },
  local: { model: 'nomic-embed-text', dimensions: 768 },
};

export const VALID_PROVIDERS = ['openai', 'gemini', 'voyage', 'vertex', 'local'] as const;

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
    case 'vertex':
      return createVertexProvider(apiKey, config.model, config.dimensions, config.vertexProject, config.vertexRegion);
    case 'local':
      return createLocalProvider(config.model, config.dimensions, config.baseUrl);
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
    maxBatchSize: 20,
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
    maxBatchSize: 20,
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
    maxBatchSize: 20,
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

function createVertexProvider(
  serviceAccountKeyOrPath: string,
  model: string,
  dimensions: number,
  project?: string,
  region?: string,
): EmbeddingProvider {
  const effectiveModel = model || 'text-embedding-005';
  const effectiveRegion = region || 'us-central1';

  let cachedToken: { token: string; expiresAt: number } | null = null;

  async function getAccessToken(saInput: string): Promise<string> {
    const { readFileSync } = await import('fs');
    const { createSign } = await import('crypto');
    let saJson: string;
    if (saInput.startsWith('/') || saInput.startsWith('.') || saInput.startsWith('~')) {
      saJson = readFileSync(saInput.replace(/^~/, process.env['HOME'] || ''), 'utf-8');
    } else {
      saJson = saInput;
    }
    const sa = JSON.parse(saJson) as { client_email: string; private_key: string };
    const now = Math.floor(Date.now() / 1000);
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url');
    const sign = createSign('RSA-SHA256');
    sign.update(`${headerB64}.${payloadB64}`);
    const signature = sign.sign(sa.private_key, 'base64url');
    const jwt = `${headerB64}.${payloadB64}.${signature}`;
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    if (!resp.ok) throw new Error(`Vertex auth failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json() as { access_token: string };
    return data.access_token;
  }

  async function token(saInput: string): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
    const t = await getAccessToken(saInput);
    cachedToken = { token: t, expiresAt: Date.now() + 3500_000 };
    return t;
  }

  return {
    name: 'vertex',
    model: effectiveModel,
    dimensions,
    maxBatchSize: 20,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const projectId = project || process.env['VERTEX_PROJECT'] || '';
      if (!projectId) throw new Error('Vertex project ID required (vertexProject or $VERTEX_PROJECT)');
      const url = `https://${effectiveRegion}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${effectiveRegion}/publishers/google/models/${effectiveModel}:predict`;
      const accessToken = await token(serviceAccountKeyOrPath);
      const instances = texts.map(t => ({ content: t }));
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instances, parameters: { outputDimensionality: dimensions } }),
      });
      if (!resp.ok) throw new Error(`Vertex embed failed: ${resp.status} ${await resp.text()}`);
      const data = await resp.json() as { predictions: Array<{ embeddings: { values: number[] } }> };
      return data.predictions.map(p => new Float32Array(p.embeddings.values));
    },
  };
}

function createLocalProvider(model: string, dimensions: number, baseUrl?: string): EmbeddingProvider {
  const url = baseUrl || process.env['LOCAL_EMBEDDING_URL'] || 'http://localhost:11434/v1';
  return {
    name: 'local',
    model: model || 'nomic-embed-text',
    dimensions,
    maxBatchSize: 20,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const resp = await fetch(`${url}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: texts, model: model || 'nomic-embed-text', dimensions }),
      });
      if (!resp.ok) throw new Error(`Local embed failed: ${resp.status} ${await resp.text()}`);
      const data = await resp.json() as { data: Array<{ embedding: number[] }> };
      return data.data.map(d => new Float32Array(d.embedding));
    },
  };
}
