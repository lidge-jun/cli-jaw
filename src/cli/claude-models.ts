// ─── Claude Model Normalization (single source of truth) ──────────

export const CLAUDE_CANONICAL_MODELS = [
  'opus',
  'sonnet',
  'sonnet[1m]',
  'haiku',
] as const;

export type ClaudeCanonicalModel = (typeof CLAUDE_CANONICAL_MODELS)[number];

export const CLAUDE_LEGACY_VALUE_MAP: Record<string, ClaudeCanonicalModel> = {
  // Reversal: full IDs → short aliases (Claude Code resolves aliases internally)
  'claude-opus-4-6[1m]': 'opus',
  'claude-opus-4-6': 'opus',
  'claude-opus-4-7[1m]': 'opus',
  'claude-opus-4-7': 'opus',
  'claude-sonnet-4-6[1m]': 'sonnet[1m]',
  'claude-sonnet-4-6': 'sonnet',
  'claude-sonnet-4-5': 'sonnet',
  'claude-haiku-4-5': 'haiku',
  'claude-haiku-4-5-20251001': 'haiku',
  'opus[1m]': 'opus',
};

export function isClaudeCli(cli: string): boolean {
  return cli === 'claude';
}

export function isClaudeCanonicalModel(model: string): model is ClaudeCanonicalModel {
  return (CLAUDE_CANONICAL_MODELS as readonly string[]).includes(model);
}

export function isKnownClaudeLegacyValue(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLAUDE_LEGACY_VALUE_MAP, model);
}

export function migrateLegacyClaudeValue(model: string): string {
  const value = (model || '').trim();
  if (!value) return value;
  return CLAUDE_LEGACY_VALUE_MAP[value] || value;
}

export function getDefaultClaudeModel(): ClaudeCanonicalModel {
  return 'sonnet';
}

export function getDefaultClaudeChoices(): string[] {
  return [...CLAUDE_CANONICAL_MODELS];
}

export function getClaudeModelKind(model: string): 'canonical' | 'legacy' | 'explicit' {
  const value = (model || '').trim();
  if (!value) return 'explicit';
  if (isClaudeCanonicalModel(value)) return 'canonical';
  if (isKnownClaudeLegacyValue(value)) return 'legacy';
  return 'explicit';
}
