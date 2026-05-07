export function isHeadlessDashboardEnvironment(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
    if (env["CI"] || env["SSH_CONNECTION"] || env["SSH_TTY"] || env["REMOTE_CONTAINERS"] || env["CODESPACES"]) return true;
    if (platform !== 'linux') return false;
    if (env["WSL_DISTRO_NAME"] || env["WSL_INTEROP"]) return true;
    return !env["DISPLAY"] && !env["WAYLAND_DISPLAY"];
}

export function shouldOpenDashboardByDefault(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
    return !isHeadlessDashboardEnvironment(env, platform);
}
