export function isClaudeLikeCli(cli: string): boolean {
    return cli === 'claude';
}

export function isSessionPersistingCli(cli: string): boolean {
    return cli !== 'claude' && cli !== 'agy';
}
