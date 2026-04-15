import { escapeHtml } from '../render.js';
import { api, getAuthToken } from '../api.js';

type AvatarRole = 'agent' | 'user';
type AvatarServerEntry = {
    kind?: 'emoji' | 'image';
    imageUrl?: string;
    updatedAt?: number | null;
};
type AvatarServerState = Record<AvatarRole, AvatarServerEntry>;
type AvatarState = {
    emoji: string;
    imageUrl: string;
    updatedAt: number | null;
};

const AGENT_KEY = 'agentAvatar';
const USER_KEY = 'userAvatar';
const DEFAULT_AGENT = '🦈';
const DEFAULT_USER = '👤';

const avatarState: Record<AvatarRole, AvatarState> = {
    agent: { emoji: DEFAULT_AGENT, imageUrl: '', updatedAt: null },
    user: { emoji: DEFAULT_USER, imageUrl: '', updatedAt: null },
};

let initialized = false;

function stateFor(role: AvatarRole): AvatarState {
    return avatarState[role];
}

function defaultEmoji(role: AvatarRole): string {
    return role === 'agent' ? DEFAULT_AGENT : DEFAULT_USER;
}

function storageKey(role: AvatarRole): string {
    return role === 'agent' ? AGENT_KEY : USER_KEY;
}

function inputId(role: AvatarRole): string {
    return role === 'agent' ? 'agentAvatarInput' : 'userAvatarInput';
}

function statusId(role: AvatarRole): string {
    return role === 'agent' ? 'agentAvatarStatus' : 'userAvatarStatus';
}

function iconSelector(role: AvatarRole): string {
    return role === 'agent' ? '.agent-icon' : '.user-icon';
}

function getEmoji(role: AvatarRole): string {
    return stateFor(role).emoji;
}

function syncInputs(role: AvatarRole): void {
    const input = document.getElementById(inputId(role)) as HTMLInputElement | null;
    if (input) input.value = getEmoji(role);
    const status = document.getElementById(statusId(role));
    if (status) status.textContent = stateFor(role).imageUrl ? 'image active' : 'emoji active';
}

function setStatus(role: AvatarRole, text: string): void {
    const status = document.getElementById(statusId(role));
    if (status) status.textContent = text;
}

function avatarMarkup(role: AvatarRole): string {
    const current = stateFor(role);
    if (current.imageUrl) {
        return `<img class="avatar-image" src="${escapeHtml(current.imageUrl)}" alt="" loading="lazy" decoding="async">`;
    }
    return escapeHtml(current.emoji);
}

function applyAvatar(role: AvatarRole): void {
    const html = avatarMarkup(role);
    const kind = stateFor(role).imageUrl ? 'image' : 'emoji';
    document.querySelectorAll(iconSelector(role)).forEach((el) => {
        el.innerHTML = html;
        el.setAttribute('data-avatar-kind', kind);
    });
}

function setServerAvatar(role: AvatarRole, payload?: AvatarServerEntry | null): void {
    if (payload?.kind === 'image' && payload.imageUrl) {
        stateFor(role).imageUrl = payload.imageUrl;
        stateFor(role).updatedAt = payload.updatedAt ?? Date.now();
    } else {
        stateFor(role).imageUrl = '';
        stateFor(role).updatedAt = payload?.updatedAt ?? null;
    }
    syncInputs(role);
    applyAvatar(role);
}

async function loadServerAvatars(): Promise<void> {
    const payload = await api<AvatarServerState>('/api/avatar');
    if (!payload) return;
    setServerAvatar('agent', payload.agent);
    setServerAvatar('user', payload.user);
}

async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
    const token = await getAuthToken();
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(path, { ...init, headers });
}

async function uploadAvatar(role: AvatarRole, file: File): Promise<void> {
    setStatus(role, 'uploading...');
    const res = await authorizedFetch(`/api/avatar/${role}/upload`, {
        method: 'POST',
        headers: { 'X-Filename': encodeURIComponent(file.name) },
        body: file,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        setStatus(role, 'upload failed');
        throw new Error(json?.error || `avatar upload failed (${res.status})`);
    }
    setServerAvatar(role, json?.data || json);
}

async function resetAvatarImage(role: AvatarRole): Promise<void> {
    setStatus(role, 'resetting...');
    const res = await authorizedFetch(`/api/avatar/${role}/image`, { method: 'DELETE' });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        setStatus(role, 'reset failed');
        throw new Error(json?.error || `avatar reset failed (${res.status})`);
    }
    setServerAvatar(role, json?.data || json);
}

function bindRoleControls(role: AvatarRole): void {
    const uploadBtnId = role === 'agent' ? 'agentAvatarUploadBtn' : 'userAvatarUploadBtn';
    const resetBtnId = role === 'agent' ? 'agentAvatarResetBtn' : 'userAvatarResetBtn';
    const fileInputId = role === 'agent' ? 'agentAvatarFile' : 'userAvatarFile';

    document.getElementById(uploadBtnId)?.addEventListener('click', () => {
        (document.getElementById(fileInputId) as HTMLInputElement | null)?.click();
    });

    document.getElementById(resetBtnId)?.addEventListener('click', async () => {
        try {
            await resetAvatarImage(role);
        } catch (error) {
            console.warn('[avatar:reset]', (error as Error).message);
        }
    });

    document.getElementById(fileInputId)?.addEventListener('change', async (event: Event) => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
            await uploadAvatar(role, file);
        } catch (error) {
            console.warn('[avatar:upload]', (error as Error).message);
        } finally {
            input.value = '';
        }
    });
}

export function getAgentAvatar(): string { return getEmoji('agent'); }
export function getUserAvatar(): string { return getEmoji('user'); }
export function getAgentAvatarMarkup(): string { return avatarMarkup('agent'); }
export function getUserAvatarMarkup(): string { return avatarMarkup('user'); }

export function setAgentAvatar(emoji: string): void {
    const next = (emoji || '').trim() || DEFAULT_AGENT;
    stateFor('agent').emoji = next;
    localStorage.setItem(storageKey('agent'), next);
    syncInputs('agent');
    if (!stateFor('agent').imageUrl) applyAvatar('agent');
}

export function setUserAvatar(emoji: string): void {
    const next = (emoji || '').trim() || DEFAULT_USER;
    stateFor('user').emoji = next;
    localStorage.setItem(storageKey('user'), next);
    syncInputs('user');
    if (!stateFor('user').imageUrl) applyAvatar('user');
}

export async function initAvatar(): Promise<void> {
    stateFor('agent').emoji = localStorage.getItem(AGENT_KEY) || DEFAULT_AGENT;
    stateFor('user').emoji = localStorage.getItem(USER_KEY) || DEFAULT_USER;
    syncInputs('agent');
    syncInputs('user');

    if (!initialized) {
        initialized = true;

        document.getElementById('avatarSave')?.addEventListener('click', () => {
            const agentInput = document.getElementById('agentAvatarInput') as HTMLInputElement | null;
            const userInput = document.getElementById('userAvatarInput') as HTMLInputElement | null;
            if (agentInput) setAgentAvatar(agentInput.value);
            if (userInput) setUserAvatar(userInput.value);
        });

        for (const id of ['agentAvatarInput', 'userAvatarInput']) {
            document.getElementById(id)?.addEventListener('keydown', (e: Event) => {
                const keyEvent = e as KeyboardEvent;
                if (keyEvent.key === 'Enter') {
                    keyEvent.preventDefault();
                    document.getElementById('avatarSave')?.click();
                    (keyEvent.target as HTMLInputElement).blur();
                }
            });
        }

        bindRoleControls('agent');
        bindRoleControls('user');
    }

    await loadServerAvatars();
    applyAvatar('agent');
    applyAvatar('user');
}
