export function isHeadlessBrowserEnvironment(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
    if (env["CI"] || env["SSH_CONNECTION"] || env["SSH_TTY"] || env["REMOTE_CONTAINERS"] || env["CODESPACES"]) return true;
    if (platform !== 'linux') return false;
    if (env["WSL_DISTRO_NAME"] || env["WSL_INTEROP"]) return true;
    return !env["DISPLAY"] && !env["WAYLAND_DISPLAY"];
}

export function shouldOpenBrowserByDefault(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
    return !isHeadlessBrowserEnvironment(env, platform);
}
