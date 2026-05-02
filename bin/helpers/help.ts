export function shouldShowHelp(argv: string[], startIndex = 3): boolean {
    const args = argv.slice(startIndex);
    return args.includes('--help') || args.includes('-h') || args[0] === 'help';
}

export function printAndExit(text: string): never {
    console.log(text);
    process.exit(0);
}
