import { useState } from 'react';
import type { FormEvent } from 'react';
import type { JawCeoController } from './useJawCeo';
import type { JawCeoCompletion, JawCeoConsoleTab, JawCeoResponseMode } from './types';

export type ChatEntry = {
    id: string;
    role: 'user' | 'ceo' | 'tool';
    text: string;
    at: string;
};

export type JawCeoConsoleModel = {
    tab: JawCeoConsoleTab;
    setTab: (tab: JawCeoConsoleTab) => void;
    message: string;
    setMessage: (value: string) => void;
    responseMode: JawCeoResponseMode;
    setResponseMode: (mode: JawCeoResponseMode) => void;
    chat: ChatEntry[];
    submitMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    summarize: (completion: JawCeoCompletion) => Promise<void>;
    continueCompletion: (completion: JawCeoCompletion) => Promise<void>;
};

function pushChat(setChat: (fn: (prev: ChatEntry[]) => ChatEntry[]) => void, entry: Omit<ChatEntry, 'id' | 'at'> & { at?: string }, prefix: string): void {
    const at = entry.at || new Date().toISOString();
    setChat(prev => [...prev, { id: `${prefix}-${Date.now()}`, ...entry, at }]);
}

function createSubmitMessage(args: {
    ceo: JawCeoController;
    message: string;
    responseMode: JawCeoResponseMode;
    setMessage: (value: string) => void;
    setChat: (fn: (prev: ChatEntry[]) => ChatEntry[]) => void;
    setTab: (tab: JawCeoConsoleTab) => void;
}) {
    return async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const text = args.message.trim();
        if (!text) return;
        args.setMessage('');
        pushChat(args.setChat, { role: 'user', text }, 'user');
        try {
            const result = await args.ceo.sendText(text, args.responseMode);
            pushChat(args.setChat, { role: 'ceo', text: result.data?.response || result.error?.message || 'Jaw CEO completed the request.' }, 'ceo');
            args.setTab('chat');
        } catch (error) {
            pushChat(args.setChat, { role: 'tool', text: (error as Error).message }, 'err');
        }
    };
}

function createCompletionActions(args: {
    ceo: JawCeoController;
    responseMode: JawCeoResponseMode;
    setChat: (fn: (prev: ChatEntry[]) => ChatEntry[]) => void;
    setTab: (tab: JawCeoConsoleTab) => void;
}) {
    return {
        summarize: async (completion: JawCeoCompletion): Promise<void> => {
            const result = await args.ceo.summarizeCompletion(completion.completionKey, 'short');
            pushChat(args.setChat, { role: 'ceo', text: result.data?.summary || result.error?.message || 'Summary unavailable.' }, 'sum');
            args.setTab('chat');
        },
        continueCompletion: async (completion: JawCeoCompletion): Promise<void> => {
            const mode = args.responseMode === 'voice' || args.responseMode === 'both' || args.responseMode === 'silent' ? args.responseMode : 'text';
            const result = await args.ceo.continueCompletion(completion.completionKey, mode);
            pushChat(args.setChat, { role: 'ceo', text: String((result.data as { response?: string } | undefined)?.response || result.error?.message || 'Completion continued.') }, 'cont');
            args.setTab('chat');
        },
    };
}

export function useJawCeoConsoleModel(args: { ceo: JawCeoController }): JawCeoConsoleModel {
    const [tab, setTab] = useState<JawCeoConsoleTab>('chat'), [message, setMessage] = useState(''), [responseMode, setResponseMode] = useState<JawCeoResponseMode>('text');
    const [chat, setChat] = useState<ChatEntry[]>([]);
    const completionActions = createCompletionActions({ ceo: args.ceo, responseMode, setChat, setTab });
    return {
        tab, setTab, message, setMessage, responseMode, setResponseMode, chat,
        submitMessage: createSubmitMessage({ ceo: args.ceo, message, responseMode, setMessage, setChat, setTab }),
        ...completionActions,
    };
}
