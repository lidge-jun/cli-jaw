export function isClaudeLikeCli(cli: string): boolean {
    return cli === 'claude' || cli === 'claude-i';
}

export function isSessionPersistingCli(cli: string): boolean {
    return cli !== 'claude';
}
