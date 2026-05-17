export function isClaudeLikeCli(cli: string): boolean {
    return cli === 'claude'
        || cli === 'claude-e'
        || cli === 'claude-i'
        || cli === 'claude-exec'
        || cli === 'jaw-claude-i';
}

export function isSessionPersistingCli(cli: string): boolean {
    return cli !== 'claude';
}
