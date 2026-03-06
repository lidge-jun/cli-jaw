// ── Shared State Module ──
// All modules import this to access/modify shared state.
// Object reference ensures mutations are seen across modules.

export type HeartbeatSchedule =
    | {
        kind: 'every';
        minutes: number;
        timeZone?: string;
    }
    | {
        kind: 'cron';
        cron: string;
        timeZone?: string;
    };

export interface HeartbeatJob {
    id: string;
    name?: string;
    enabled?: boolean;
    schedule?: HeartbeatSchedule;
    prompt?: string;
}

export interface CliStatusCache {
    [cli: string]: unknown;
}

export type OrcStateName = 'IDLE' | 'P' | 'A' | 'B' | 'C' | 'D';

export interface AppState {
    ws: WebSocket | null;
    agentBusy: boolean;
    orcState: OrcStateName;
    employees: unknown[];
    allSkills: unknown[];
    currentSkillFilter: string;
    currentAgentDiv: HTMLElement | null;
    attachedFiles: File[];
    heartbeatJobs: HeartbeatJob[];
    heartbeatErrors: Record<string, string>;
    cliStatusCache: CliStatusCache | null;
    cliStatusTs: number;
    isRecording: boolean;
}

export const state: AppState = {
    ws: null,
    agentBusy: false,
    employees: [],
    allSkills: [],
    currentSkillFilter: 'all',
    currentAgentDiv: null,
    attachedFiles: [],
    heartbeatJobs: [],
    heartbeatErrors: {},
    cliStatusCache: null,
    cliStatusTs: 0,
    orcState: 'IDLE',
    isRecording: false,
};
