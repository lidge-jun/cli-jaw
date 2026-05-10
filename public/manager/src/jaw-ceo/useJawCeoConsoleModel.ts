import { useState } from 'react';
import type { FormEvent } from 'react';
import type { JawCeoController } from './useJawCeo';
import type { JawCeoCompletion, JawCeoConsoleTab, JawCeoResponseMode } from './types';

export type JawCeoConsoleModel = {
    tab: JawCeoConsoleTab;
    setTab: (tab: JawCeoConsoleTab) => void;
    message: string;
    setMessage: (value: string) => void;
    responseMode: JawCeoResponseMode;
    setResponseMode: (mode: JawCeoResponseMode) => void;
    submitMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    summarize: (completion: JawCeoCompletion) => Promise<void>;
    continueCompletion: (completion: JawCeoCompletion) => Promise<void>;
};

function createSubmitMessage(args: {
    ceo: JawCeoController;
    message: string;
    responseMode: JawCeoResponseMode;
    setMessage: (value: string) => void;
    setTab: (tab: JawCeoConsoleTab) => void;
}) {
    return async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const text = args.message.trim();
        if (!text) return;
        args.setMessage('');
        try {
            await args.ceo.sendText(text, args.responseMode);
            args.setTab('chat');
        } catch (error) {
            void error;
        }
    };
}

function createCompletionActions(args: {
    ceo: JawCeoController;
    responseMode: JawCeoResponseMode;
    setTab: (tab: JawCeoConsoleTab) => void;
}) {
    return {
        summarize: async (completion: JawCeoCompletion): Promise<void> => {
            await args.ceo.summarizeCompletion(completion.completionKey, 'short');
            await args.ceo.refresh();
            args.setTab('chat');
        },
        continueCompletion: async (completion: JawCeoCompletion): Promise<void> => {
            const mode = args.responseMode === 'voice' || args.responseMode === 'both' || args.responseMode === 'silent' ? args.responseMode : 'text';
            await args.ceo.continueCompletion(completion.completionKey, mode);
            await args.ceo.refresh();
            args.setTab('chat');
        },
    };
}

export function useJawCeoConsoleModel(args: { ceo: JawCeoController }): JawCeoConsoleModel {
    const [tab, setTab] = useState<JawCeoConsoleTab>('chat'), [message, setMessage] = useState(''), [responseMode, setResponseMode] = useState<JawCeoResponseMode>('text');
    const completionActions = createCompletionActions({ ceo: args.ceo, responseMode, setTab });
    return {
        tab, setTab, message, setMessage, responseMode, setResponseMode,
        submitMessage: createSubmitMessage({ ceo: args.ceo, message, responseMode, setMessage, setTab }),
        ...completionActions,
    };
}
