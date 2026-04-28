export type PortRange = {
    from: number;
    to: number;
};

export type HostPort = {
    host: string;
    port: number | null;
};

export type ExpectedHostOptions = {
    host: string;
    port: number;
    allowLocalhostAlias?: boolean;
};

export type OriginValidationOptions = {
    allowedOrigins: string[];
    allowMissing?: boolean;
};

const TCP_PORT_MIN = 1;
const TCP_PORT_MAX = 65535;

export function parsePositivePort(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePositiveCount(value: unknown, fallback: number, max: number): number {
    const parsed = Number(value);
    const count = Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    return Math.max(1, Math.min(count, max));
}

export function toPortRange(from: number, count: number): PortRange {
    return { from, to: from + Math.max(1, count) - 1 };
}

export function isTcpPort(port: number): boolean {
    return Number.isInteger(port) && port >= TCP_PORT_MIN && port <= TCP_PORT_MAX;
}

export function isPortInRange(port: number, range: PortRange): boolean {
    return Number.isInteger(port) && port >= range.from && port <= range.to;
}

export function rangesOverlap(left: PortRange, right: PortRange): boolean {
    return left.from <= right.to && right.from <= left.to;
}

export function assertValidPortRange(range: PortRange, label: string): void {
    if (!isTcpPort(range.from) || !isTcpPort(range.to) || range.from > range.to) {
        throw new Error(`${label} must be a valid TCP port range`);
    }
}

export function assertRangeDoesNotContainPort(range: PortRange, port: number, label: string): void {
    if (isPortInRange(port, range)) {
        throw new Error(`${label} must not include manager port ${port}`);
    }
}

export function assertRangesDoNotOverlap(left: PortRange, right: PortRange, label: string): void {
    if (rangesOverlap(left, right)) {
        throw new Error(`${label} ranges must not overlap`);
    }
}

function normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/^\[(::1)\]$/, '$1');
}

export function isLoopbackHost(host: string): boolean {
    const normalized = normalizeHost(host);
    return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

export function parseHostHeader(header: string | string[] | undefined): HostPort | null {
    if (!header || Array.isArray(header) || header.includes(',')) return null;
    const value = header.trim();
    if (!value) return null;

    const bracketed = value.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (bracketed) {
        return { host: `[${bracketed[1]}]`, port: bracketed[2] ? Number(bracketed[2]) : null };
    }

    const lastColon = value.lastIndexOf(':');
    if (lastColon > -1 && value.indexOf(':') === lastColon) {
        const host = value.slice(0, lastColon);
        const port = Number(value.slice(lastColon + 1));
        return host && Number.isInteger(port) ? { host, port } : null;
    }

    if (value.includes(':')) return null;
    return { host: value, port: null };
}

export function isExpectedHostHeader(
    header: string | string[] | undefined,
    options: ExpectedHostOptions,
): boolean {
    const parsed = parseHostHeader(header);
    if (!parsed || parsed.port !== options.port) return false;
    const expected = normalizeHost(options.host);
    const actual = normalizeHost(parsed.host);
    if (actual === expected) return true;
    return Boolean(options.allowLocalhostAlias) && actual === 'localhost' && expected === '127.0.0.1';
}

export function isAllowedOriginHeader(
    origin: string | string[] | undefined,
    options: OriginValidationOptions,
): boolean {
    if (!origin) return options.allowMissing !== false;
    if (Array.isArray(origin) || origin.includes(',')) return false;
    try {
        const parsed = new URL(origin);
        const normalized = parsed.origin;
        return options.allowedOrigins.includes(normalized);
    } catch {
        return false;
    }
}

export function isAllowedProxyTarget(host: string, port: number, range: PortRange): boolean {
    return isLoopbackHost(host) && isTcpPort(port) && isPortInRange(port, range);
}
