import {
    loadUnifiedMcp, syncToAll,
    ensureWorkingDirSkillsLinks, initMcpConfig,
} from '../../lib/mcp-sync.js';
import { syncCodexContextWindow } from './codex-config.js';
import { settings, replaceSettings, saveSettings } from './config.js';
import { syncMainSessionToSettings } from './main-session.js';
import { mergeSettingsPatch } from './settings-merge.js';
import { regenerateB } from '../prompt/builder.js';
import { restartMessagingRuntime } from '../messaging/runtime.js';

type ApplyRuntimeSettingsOptions = {
    resetFallbackState?: () => void;
};

export async function applyRuntimeSettingsPatch(
    rawPatch: Record<string, any> = {},
    opts: ApplyRuntimeSettingsOptions = {},
): Promise<Record<string, any>> {
    const prevCli = settings.cli;
    const prevWorkingDir = settings.workingDir;
    const prevSnapshot = { ...settings };

    const merged = mergeSettingsPatch(settings, rawPatch);
    replaceSettings(merged);
    saveSettings(settings);

    if (rawPatch.perCli?.codex && 'contextWindow' in rawPatch.perCli.codex) {
        const codexCfg = settings.perCli?.codex || {};
        syncCodexContextWindow({
            enabled: !!codexCfg.contextWindow,
            contextWindow: codexCfg.contextWindowSize || 1000000,
            compactLimit: codexCfg.contextCompactLimit || 900000,
        });
    }

    opts.resetFallbackState?.();
    syncMainSessionToSettings(prevCli);

    if (settings.workingDir !== prevWorkingDir) {
        try {
            initMcpConfig(settings.workingDir);
            ensureWorkingDirSkillsLinks(settings.workingDir, { onConflict: 'skip', includeClaude: true, allowReplaceManaged: true });
            syncToAll(loadUnifiedMcp());
            regenerateB();
            console.log(`[jaw:workingDir] artifacts regenerated for ${settings.workingDir}`);
        } catch (e: unknown) {
            console.error('[jaw:workingDir]', (e as Error).message);
        }
    }

    // Unified messaging runtime restart (handles both Telegram and Discord)
    try {
        await restartMessagingRuntime(prevSnapshot, settings, rawPatch);
    } catch (e: unknown) {
        // Rollback: restore previous settings on restart failure
        console.error('[runtime-settings] restart failed, rolling back:', (e as Error).message);
        replaceSettings(prevSnapshot);
        saveSettings(prevSnapshot);
        throw e;
    }

    return settings;
}
