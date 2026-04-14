import type { Express } from 'express';
import type { AuthMiddleware } from './types.js';
import fs from 'fs';
import { join } from 'path';
import { normalizeLocale } from '../core/i18n.js';
import { settings } from '../core/config.js';

export function registerI18nRoutes(app: Express, requireAuth: AuthMiddleware, projectRoot: string): void {
    app.get('/api/i18n/languages', (_, res) => {
        const localeDir = join(projectRoot, 'public', 'locales');
        if (!fs.existsSync(localeDir)) return res.json({ languages: ['ko'], default: 'ko' });
        const langs = fs.readdirSync(localeDir)
            .filter(f => f.endsWith('.json') && !f.startsWith('skills-'))
            .map(f => f.replace('.json', ''));
        res.json({ languages: langs, default: normalizeLocale(settings.locale, 'ko') });
    });

    app.get('/api/i18n/:lang', (req, res) => {
        const raw = req.params.lang.replace(/[^a-z-]/gi, '');
        const lang = normalizeLocale(raw, '');
        if (!lang) return res.status(404).json({ error: 'locale not found' });
        const filePath = join(projectRoot, 'public', 'locales', `${lang}.json`);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'locale not found' });
        res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    });
}
