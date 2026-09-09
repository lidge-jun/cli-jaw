/** Negotiated ACP select options only; no process, session or settings ownership. */
export interface AcpSelectOption {
    readonly value: string;
    readonly name: string;
}

export interface AcpSelectConfig {
    readonly id: string;
    readonly name: string;
    readonly category?: string;
    readonly currentValue: string;
    readonly options: ReadonlyArray<AcpSelectOption>;
}

export interface AcpConfigPort {
    getConfigOptions(): unknown;
    /** Must replace its snapshot with the successful response's full configOptions. */
    setConfigOption(id: string, value: string): Promise<void>;
}

const CONFIG_LIMIT = 64;
const CHOICE_LIMIT = 2048;
const GROUP_LIMIT = 64; // Aggregate per snapshot; groups contain only flat choices.
const ID_LIMIT = 1024;
const NAME_LIMIT = 1000;
const EFFORT_SELECTOR_NAMES = new Set([
    'effort', 'reasoning', 'reasoningeffort', 'reasoninglevel', 'thinkinglevel', 'thoughtlevel',
]);

function record(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function text(value: unknown, limit: number, code: string, allowEmpty = false): string {
    if (typeof value !== 'string' || value.length > limit || (!allowEmpty && !value.trim())) throw new Error(code);
    return value; // Validate without changing a provider's opaque ID/value.
}

function choices(raw: unknown, budget: { choices: number; groups: number }): AcpSelectOption[] {
    if (!Array.isArray(raw) || raw.length > CHOICE_LIMIT + GROUP_LIMIT) {
        throw new Error('acp_config_invalid_choices');
    }
    const result: AcpSelectOption[] = [];
    const values = new Set<string>(), groups = new Set<string>();
    const add = (entry: unknown): void => {
        if (++budget.choices > CHOICE_LIMIT) throw new Error('acp_config_choice_limit');
        if (!record(entry) || 'options' in entry || 'group' in entry) {
            throw new Error('acp_config_invalid_choice');
        }
        const value = text(entry['value'], ID_LIMIT, 'acp_config_invalid_value');
        const name = text(entry['name'], NAME_LIMIT, 'acp_config_invalid_name', true);
        if (values.has(value)) throw new Error('acp_config_duplicate_value');
        values.add(value);
        result.push({ value, name });
    };
    for (const entry of raw) {
        if (!record(entry)) throw new Error('acp_config_invalid_choice');
        if (!('options' in entry)) { add(entry); continue; }
        if (++budget.groups > GROUP_LIMIT) throw new Error('acp_config_group_limit');
        if ('value' in entry) throw new Error('acp_config_invalid_group');
        const group = text(entry['group'], ID_LIMIT, 'acp_config_invalid_group');
        text(entry['name'], NAME_LIMIT, 'acp_config_invalid_name', true);
        if (groups.has(group)) throw new Error('acp_config_duplicate_group');
        groups.add(group);
        const entries: unknown = entry['options'];
        if (!Array.isArray(entries) || entries.length > CHOICE_LIMIT - budget.choices) {
            throw new Error('acp_config_choice_limit');
        }
        for (const child of entries) add(child);
    }
    return result;
}

/** Parse an optional configOptions array into copied, bounded select configurations.
 * Unknown types are unavailable, not coerced. Extension metadata is not retained.
 */
export function parseAcpSelectConfigs(raw: unknown): AcpSelectConfig[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > CONFIG_LIMIT) throw new Error('acp_config_invalid_configs');
    const result: AcpSelectConfig[] = [], ids = new Set<string>();
    const budget = { choices: 0, groups: 0 };
    for (const entry of raw) {
        if (!record(entry)) throw new Error('acp_config_invalid_config');
        const id = text(entry['id'], ID_LIMIT, 'acp_config_invalid_id');
        const name = text(entry['name'], NAME_LIMIT, 'acp_config_invalid_name', true);
        const type = text(entry['type'], ID_LIMIT, 'acp_config_invalid_type');
        const category = entry['category'] === undefined || entry['category'] === null
            ? undefined : text(entry['category'], ID_LIMIT, 'acp_config_invalid_category');
        if (ids.has(id)) throw new Error('acp_config_duplicate_id');
        ids.add(id);
        if (type !== 'select') {
            if (type === 'boolean' && typeof entry['currentValue'] !== 'boolean') {
                throw new Error('acp_config_invalid_current');
            }
            continue;
        }
        const currentValue = text(entry['currentValue'], ID_LIMIT, 'acp_config_invalid_current');
        const options = choices(entry['options'], budget);
        if (!options.some(option => option.value === currentValue)) throw new Error('acp_config_invalid_current');
        result.push({ id, name, ...(category === undefined ? {} : { category }), currentValue, options });
    }
    return result;
}

type SelectionKind = 'model' | 'effort';

function token(value: string): string {
    return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function effortSelector(config: AcpSelectConfig): boolean {
    const category = token(config.category ?? '');
    if (category === 'model') return false;
    if (token(config.id) === 'effort' || category === 'thoughtlevel') return true;
    if (category !== 'modeloption' && category !== 'modelconfig') return false;
    return EFFORT_SELECTOR_NAMES.has(token(config.id)) || EFFORT_SELECTOR_NAMES.has(token(config.name));
}

/**
 * An exact effort id is a stronger signal than a shared category, so it wins outright.
 * Cursor advertises both `thinking` and `effort` under `thought_level`; treating
 * the category as equal evidence made every effort-configured session ambiguous
 * and killed it before its first turn (#656). Category matching still covers
 * providers that expose effort under a differently named id.
 */
function selector(configs: ReadonlyArray<AcpSelectConfig>, kind: SelectionKind): AcpSelectConfig {

    const matches = configs.filter(config => kind === 'model'
        ? token(config.category ?? '') === 'model' || config.id === 'model'
        : effortSelector(config));
    // Effort only: a model selector stays strictly unambiguous, because two
    // advertised model configs mean the session genuinely cannot choose.
    const exact = kind === 'effort' ? matches.filter(config => token(config.id) === 'effort') : [];
    const candidates = exact.length ? exact : matches;
    if (candidates.length > 1) throw new Error(`acp_config_ambiguous_${kind}`);
    const match = candidates[0];
    if (!match) throw new Error(`acp_config_unsupported_${kind}`);
    return match;
}

function effortValue(value: string): string {
    const normalized = token(value);
    if (normalized === 'extrahigh' || normalized === 'xhigh') return 'xhigh';
    if (['none', 'minimal', 'low', 'medium', 'high', 'max'].includes(normalized)) return normalized;
    return value; // Unknown future values match exactly, without invented aliases.
}

function requested(value: unknown, kind: SelectionKind): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'string' && value.length <= ID_LIMIT && !value.trim()) return undefined;
    const validated = text(value, ID_LIMIT, `acp_config_invalid_requested_${kind}`);
    return validated;
}

function effortChoice(config: AcpSelectConfig, effort: string): string {
    const normalized = effortValue(effort);
    const matches = config.options.filter(option => effortValue(option.value) === normalized
        || effortValue(option.name) === normalized);
    if (matches.length > 1) throw new Error('acp_config_ambiguous_effort_value');
    const match = matches[0];
    if (!match) throw new Error('acp_config_unsupported_effort');
    return match.value;
}

function assertApplied(configs: ReadonlyArray<AcpSelectConfig>, kind: SelectionKind, value: string): void {
    if (selector(configs, kind).currentValue !== value) throw new Error(`acp_config_${kind}_not_applied`);
}

/**
 * Print and ACP spell the same model differently — `cursor-agent models` shows
 * `claude-4.6-opus-high` where ACP advertises `claude-opus-4-6` — so switching
 * transport leaves a value nothing accepts and the session dies before its first
 * turn with no clue which setting is wrong (#657).
 *
 * Translating between the two automatically is not safe: an order-independent
 * segment match collapses `gpt-5.4-mini-high` and `gpt-5.4-mini-low` onto the
 * same bag, and `max` is a product name in `gpt-5.1-codex-max` rather than an
 * effort rung, so a unique survivor can be the wrong model. The error therefore
 * stays exact and code-only; what changes is that the advertised ids reach the
 * operator through this log instead of requiring a scratch script.
 *
 * Option values are provider-supplied, so only clean identifier-shaped ones are
 * printed and the list is capped. Anything carrying whitespace, quotes or a path
 * shape is counted, never echoed.
 */
const CLEAN_MODEL_ID = /^[A-Za-z0-9._:@-]{1,64}$/;
const ADVERTISED_LOG_CAP = 12;

function reportUnsupportedModel(config: AcpSelectConfig): void {
    try {
        const clean = config.options.map(option => option.value).filter(value => CLEAN_MODEL_ID.test(value));
        const shown = clean.slice(0, ADVERTISED_LOG_CAP).join(', ');
        const omitted = config.options.length - Math.min(clean.length, ADVERTISED_LOG_CAP);
        console.warn('[acp:config] configured model is not advertised; advertised ids:',
            shown || '(none printable)', omitted > 0 ? `(+${omitted} not shown)` : '');
    } catch { /* diagnostics never mask the configuration failure */ }
}
/** Serialized setup helper. Caller owns admission, deadlines, retirement and error reporting.
 * A later failure does not undo an already acknowledged model write.
 */
export async function configureAcpModel(port: AcpConfigPort, input: {
    readonly model?: string | null | undefined;
    readonly effort?: string | null | undefined;
}): Promise<void> {
    const model = requested(input.model, 'model'), effort = requested(input.effort, 'effort');
    let configs = parseAcpSelectConfigs(port.getConfigOptions());
    if (model !== undefined) {
        const config = selector(configs, 'model');
        if (!config.options.some(option => option.value === model)) {
            reportUnsupportedModel(config);
            throw new Error('acp_config_unsupported_model');
        }
        if (config.currentValue !== model) {
            await port.setConfigOption(config.id, model);
            configs = parseAcpSelectConfigs(port.getConfigOptions());
            assertApplied(configs, 'model', model);
        }
    }
    if (effort === undefined) return;
    const config = selector(configs, 'effort');
    const value = effortChoice(config, effort);
    if (config.currentValue === value) return;
    await port.setConfigOption(config.id, value);
    configs = parseAcpSelectConfigs(port.getConfigOptions());
    assertApplied(configs, 'effort', value);
    if (model !== undefined) assertApplied(configs, 'model', model);
}
