import { fetchKiroModelInventory } from '../agent/kiro-models.js';
import { CLI_REGISTRY } from './registry.js';
import { claudeCatalogToChoices, resolveClaudeBundleCatalog } from './claude-model-discovery.js';
import { resolveOpenCodexCodexModelsDetailed } from './opencodex-models.js';
import { diagnoseOpenCodexExecution, resolveOpenCodexRuntime } from './opencodex-runtime.js';
import { readCodexRootOpenAiBaseUrl } from '../core/codex-config.js';
import { detectCli } from '../core/cli-detection.js';

/** Union of every per-model effort set, first-seen order preserved. */
function unionEfforts(effortsByModel: Record<string, string[]>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const efforts of Object.values(effortsByModel)) {
        for (const effort of efforts) {
            if (seen.has(effort)) continue;
            seen.add(effort);
            out.push(effort);
        }
    }
    return out;
}

export async function buildLiveCliRegistry() {
    const registry = structuredClone(CLI_REGISTRY) as Record<string, Record<string, unknown>>;

    const [kiroInventory, openCodexRuntime, claudeCatalog] = await Promise.all([
        fetchKiroModelInventory(),
        resolveOpenCodexRuntime(),
        resolveClaudeCatalogForRegistry(),
    ]);
    const codexResult = await resolveOpenCodexCodexModelsDetailed(openCodexRuntime);

    const executionCoupling = diagnoseOpenCodexExecution(readCodexRootOpenAiBaseUrl(), openCodexRuntime);
    registry['codex'] = { ...registry['codex'], executionCoupling };
    registry['codex-app'] = { ...registry['codex-app'], executionCoupling };

    const codexModels = codexResult.models;
    if (codexModels.length > 0) {
        // Per-model effort metadata. opencodex advertises a DIFFERENT effort set
        // per model (gpt-5.6-sol reaches `ultra`, gpt-5.6-luna stops at `max`,
        // routed models like anthropic/* take none), and the chosen value is
        // forwarded to the wire, so consumers must narrow by model rather than
        // offer the union. `efforts` stays as the union for legacy consumers.
        const effortsByModel: Record<string, string[]> = {};
        const defaultEffortByModel: Record<string, string> = {};
        for (const entry of codexResult.entries) {
            effortsByModel[entry.id] = [...entry.efforts];
            if (entry.defaultEffort) defaultEffortByModel[entry.id] = entry.defaultEffort;
        }
        const merged = unionEfforts(effortsByModel);
        const codexPatch: Record<string, unknown> = {
            models: codexModels,
            modelSource: codexResult.source,
            effortsByModel,
            defaultEffortByModel,
            // Never widen to an empty list: an all-routed catalog would otherwise
            // strip the picker for every model at once.
            ...(merged.length > 0 ? { efforts: merged } : {}),
        };
        // `defaultModel`/`defaultEffort` stay static on purpose: buildDefaultPerCli()
        // seeds user settings from them, so live routing order must not silently
        // rewrite a user's default runtime.
        registry['codex'] = { ...registry['codex'], ...codexPatch };
        registry['codex-app'] = { ...registry['codex-app'], ...codexPatch };
        const aiE = registry['ai-e'];
        if (aiE) {
            const existingModelsByProvider = (aiE['modelsByProvider'] as Record<string, string[]> | undefined) || {};
            const modelsByProvider: Record<string, string[]> = {
                ...existingModelsByProvider,
                codex: codexModels,
            };
            const existingEffortsByProvider = (aiE['effortsByProvider'] as Record<string, string[]> | undefined) || {};
            const effortsByProvider: Record<string, string[]> = merged.length > 0
                ? { ...existingEffortsByProvider, codex: merged }
                : existingEffortsByProvider;
            const providers = Array.isArray(aiE['providers']) ? aiE['providers'] as string[] : Object.keys(modelsByProvider);
            // ai-e splits models by provider, so per-model efforts MUST be
            // provider-scoped. A flat map collides on shared ids: `gpt-5.6-sol`
            // exists under both codex and kiro, but Kiro only accepts
            // low/medium/high/xhigh (args.ts KIRO_EFFORTS) while ocx advertises
            // max/ultra for the codex route. A flat map offered `ultra` to Kiro.
            const existingEffortsByModelByProvider =
                (aiE['effortsByModelByProvider'] as Record<string, Record<string, string[]>> | undefined) || {};
            const existingDefaultEffortByModelByProvider =
                (aiE['defaultEffortByModelByProvider'] as Record<string, Record<string, string>> | undefined) || {};
            registry['ai-e'] = {
                ...aiE,
                modelsByProvider,
                effortsByProvider,
                effortsByModelByProvider: { ...existingEffortsByModelByProvider, codex: effortsByModel },
                defaultEffortByModelByProvider: { ...existingDefaultEffortByModelByProvider, codex: defaultEffortByModel },
                models: providers.flatMap(provider => modelsByProvider[provider] || []),
            };
        }
    }

    if (kiroInventory?.models.length) {
        registry['kiro-code'] = {
            ...registry['kiro-code'],
            models: kiroInventory.models,
            defaultModel: kiroInventory.defaultModel,
            modelSource: kiroInventory.source,
            modelDetails: kiroInventory.entries,
        };
    }

    if (claudeCatalog) {
        // `defaultModel` stays static for the same reason it does for Codex:
        // buildDefaultPerCli() seeds user settings from it, so a bundle update must
        // not silently repoint a user's default. The one exception is a default the
        // live catalog no longer offers, which would be unselectable.
        const claudePatch: Record<string, unknown> = {
            models: claudeCatalog.models,
            modelSource: 'claude-bundle',
            modelAliases: claudeCatalog.aliases,
        };
        for (const cli of ['claude', 'claude-e'] as const) {
            const entry = registry[cli];
            if (!entry) continue;
            const staticDefault = entry['defaultModel'];
            registry[cli] = {
                ...entry,
                ...claudePatch,
                ...(typeof staticDefault === 'string' && !claudeCatalog.models.includes(staticDefault)
                    ? { defaultModel: claudeCatalog.models[0] }
                    : {}),
            };
        }
        const aiE = registry['ai-e'];
        if (aiE) {
            const modelsByProvider: Record<string, string[]> = {
                ...((aiE['modelsByProvider'] as Record<string, string[]> | undefined) || {}),
                claude: claudeCatalog.models,
            };
            const providers = Array.isArray(aiE['providers'])
                ? aiE['providers'] as string[]
                : Object.keys(modelsByProvider);
            registry['ai-e'] = {
                ...aiE,
                modelsByProvider,
                models: providers.flatMap(provider => modelsByProvider[provider] || []),
            };
        }
    }

    return registry;
}

/**
 * Read the installed Claude Code bundle's catalog, if one is installed.
 *
 * A missing binary, an unreadable file or an unrecognized bundle shape all answer
 * null, which leaves the static seed in `claude-models.ts` in place. Discovery
 * never empties the picker.
 */
async function resolveClaudeCatalogForRegistry(): Promise<{ models: string[]; aliases: Record<string, string> } | null> {
    const detection = detectCli('claude');
    if (!detection.available || !detection.path) return null;
    const catalog = await resolveClaudeBundleCatalog(detection.path);
    if (!catalog) return null;
    const models = claudeCatalogToChoices(catalog);
    return models.length > 0 ? { models, aliases: catalog.aliases } : null;
}
