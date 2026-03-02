import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, 'templates');

const templateCache = new Map<string, string>();

/** Load a .md template from prompt/templates/ with caching */
export function loadTemplate(name: string): string {
    if (templateCache.has(name)) return templateCache.get(name)!;
    const filePath = join(TEMPLATE_DIR, name);
    const content = fs.readFileSync(filePath, 'utf8');
    templateCache.set(name, content);
    return content;
}

/** Replace {{VAR}} placeholders in template string */
export function renderTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** Load + render in one call */
export function loadAndRender(name: string, vars: Record<string, string>): string {
    return renderTemplate(loadTemplate(name), vars);
}

/** Parse worker-context.md into phase → content map */
export function parseWorkerContexts(): Record<number, string> {
    const content = loadTemplate('worker-context.md');
    const result: Record<number, string> = {};
    const sections = content.split(/^## Phase (\d+)/m);
    // sections: ['', '2', ' — Plan Audit\n...', '3', ' — Implementation\n...', '4', ' — Check\n...']
    for (let i = 1; i < sections.length; i += 2) {
        const phaseStr = sections[i];
        const bodyRaw = sections[i + 1];
        if (!phaseStr || !bodyRaw) continue;
        const phase = parseInt(phaseStr, 10);
        const body = bodyRaw.replace(/^ — .+\n/, '').trim();
        if (body) result[phase] = body;
    }
    return result;
}

/** Clear template cache (call on regenerateB or settings change) */
export function clearTemplateCache() { templateCache.clear(); }
