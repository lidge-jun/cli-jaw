import { t } from './i18n.js';
import { HELP_TOPICS, isHelpTopicId, type HelpTopic, type HelpTopicId } from './help-content.js';

let initialized = false;
let overlay: HTMLDivElement | null = null;
let titleEl: HTMLSpanElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let closeBtn: HTMLButtonElement | null = null;
let lastOpener: HTMLElement | null = null;
let openState = false;

export function initHelpDialog(): void {
    if (initialized) return;
    initialized = true;
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeydownCapture, true);
}

export function openHelpDialog(
    topicId: HelpTopicId,
    opener: HTMLElement | null = null,
    topicIds: readonly HelpTopicId[] = [topicId],
): void {
    const topic = HELP_TOPICS[topicId];
    if (!topic) {
        console.warn('[help-dialog] unknown topic:', topicId);
        return;
    }
    ensureDialog();
    lastOpener = opener;
    renderTopic(topicId, normalizeTopicIds(topicIds, topicId));
    overlay?.classList.add('open');
    overlay?.setAttribute('aria-hidden', 'false');
    openState = true;
    requestAnimationFrame(() => closeBtn?.focus());
}

export function closeHelpDialog(): void {
    if (!openState) return;
    overlay?.classList.remove('open');
    overlay?.setAttribute('aria-hidden', 'true');
    openState = false;
    const opener = lastOpener;
    lastOpener = null;
    opener?.focus();
}

export function isHelpDialogOpen(): boolean {
    return openState;
}

function handleDocumentClick(event: MouseEvent): void {
    const trigger = (event.target as HTMLElement | null)?.closest('[data-help-topic]') as HTMLElement | null;
    if (!trigger) return;
    const topicId = trigger.getAttribute('data-help-topic');
    if (!isHelpTopicId(topicId)) {
        console.warn('[help-dialog] invalid topic:', topicId);
        return;
    }
    event.preventDefault();
    openHelpDialog(topicId, trigger, parseTopicList(trigger.getAttribute('data-help-topics'), topicId));
}

function handleKeydownCapture(event: KeyboardEvent): void {
    if (!openState || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeHelpDialog();
}

function ensureDialog(): void {
    if (overlay && titleEl && bodyEl && closeBtn) return;

    overlay = document.createElement('div');
    overlay.id = 'helpDialog';
    overlay.className = 'modal-overlay help-dialog-overlay';
    overlay.setAttribute('role', 'presentation');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.addEventListener('click', (event: MouseEvent) => {
        if (event.target === overlay) closeHelpDialog();
    });

    const box = document.createElement('div');
    box.className = 'modal-box help-dialog-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'helpDialogTitle');
    box.addEventListener('click', (event: MouseEvent) => event.stopPropagation());

    const header = document.createElement('div');
    header.className = 'modal-header help-dialog-header';

    titleEl = document.createElement('span');
    titleEl.id = 'helpDialogTitle';

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-modal-close help-dialog-close';
    closeBtn.setAttribute('aria-label', t('help.close'));
    closeBtn.textContent = 'x';
    closeBtn.addEventListener('click', () => closeHelpDialog());

    bodyEl = document.createElement('div');
    bodyEl.className = 'help-dialog-body';

    const footer = document.createElement('div');
    footer.className = 'modal-footer help-dialog-footer';

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn-save help-dialog-done';
    done.textContent = t('help.close');
    done.addEventListener('click', () => closeHelpDialog());

    header.append(titleEl, closeBtn);
    footer.append(done);
    box.append(header, bodyEl, footer);
    overlay.append(box);
    document.body.append(overlay);
}

function renderTopic(topicId: HelpTopicId, topicIds: readonly HelpTopicId[] = [topicId]): void {
    if (!titleEl || !bodyEl || !closeBtn) return;
    const topic = HELP_TOPICS[topicId];
    titleEl.textContent = t(topic.titleKey);
    closeBtn.setAttribute('aria-label', t('help.close'));
    bodyEl.replaceChildren();

    const content = document.createElement('div');
    content.className = 'help-dialog-content';
    appendTopicSections(content, topic);

    if (topicIds.length <= 1) {
        bodyEl.append(content);
        return;
    }

    const layout = document.createElement('div');
    layout.className = 'help-dialog-layout';
    layout.append(createTopicNav(topicIds, topicId), content);
    bodyEl.append(layout);
}

function appendTopicSections(parent: HTMLElement, topic: HelpTopic): void {
    appendTextSection(parent, t('help.section.what'), t(topic.introKey));
    appendTextSection(parent, t('help.section.effect'), t(topic.effectKey), 'help-effect-text');
    appendListSection(parent, t('help.section.useWhen'), topic.useWhenKeys);
    appendListSection(parent, t('help.section.howTo'), topic.howToKeys);
    appendListSection(parent, t('help.section.example'), topic.exampleKeys, false, 'help-example-list');
    if (topic.avoidWhenKeys?.length) appendListSection(parent, t('help.section.avoidWhen'), topic.avoidWhenKeys);
    if (topic.relatedKeys?.length) appendListSection(parent, t('help.section.related'), topic.relatedKeys, true);
}

function createTopicNav(topicIds: readonly HelpTopicId[], activeTopicId: HelpTopicId): HTMLElement {
    const nav = document.createElement('nav');
    nav.className = 'help-dialog-nav';
    nav.setAttribute('aria-label', t('help.section.related'));

    for (const id of topicIds) {
        const topic = HELP_TOPICS[id];
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'help-dialog-nav-item';
        item.textContent = t(topic.titleKey);
        if (id === activeTopicId) {
            item.classList.add('active');
            item.setAttribute('aria-current', 'page');
        }
        item.addEventListener('click', () => renderTopic(id, topicIds));
        nav.append(item);
    }

    return nav;
}

function parseTopicList(raw: string | null, fallback: HelpTopicId): HelpTopicId[] {
    const values = raw?.split(/[\s,]+/).filter(Boolean) ?? [];
    return normalizeTopicIds(values, fallback);
}

function normalizeTopicIds(values: readonly string[], fallback: HelpTopicId): HelpTopicId[] {
    const ids: HelpTopicId[] = [];
    for (const value of values) {
        if (isHelpTopicId(value) && !ids.includes(value)) ids.push(value);
    }
    if (!ids.includes(fallback)) ids.unshift(fallback);
    return ids;
}

function appendTextSection(parent: HTMLElement, heading: string, text: string, className?: string): void {
    const section = createSection(heading);
    const p = document.createElement('p');
    if (className) p.className = className;
    p.textContent = text;
    section.append(p);
    parent.append(section);
}

function appendListSection(
    parent: HTMLElement,
    heading: string,
    keys: string[],
    related = false,
    className?: string,
): void {
    const section = createSection(heading);
    const list = document.createElement('ul');
    list.className = className ?? (related ? 'help-related-list' : 'help-dialog-list');
    for (const key of keys) {
        const item = document.createElement('li');
        item.textContent = t(key);
        list.append(item);
    }
    section.append(list);
    parent.append(section);
}

function createSection(heading: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'help-dialog-section';
    const h3 = document.createElement('h3');
    h3.textContent = heading;
    section.append(h3);
    return section;
}
