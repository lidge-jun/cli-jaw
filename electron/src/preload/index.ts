import { contextBridge } from 'electron';
import { getLatestMetrics, setupMetricsBridge } from './metrics.js';

const DESKTOP_IDENTITY = {
  name: 'cli-jaw-desktop',
  electron: true,
  header: 'X-CLI-Jaw-Electron',
} as const;

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const rawUrl = input instanceof Request ? input.url : input.toString();
    const url = new URL(rawUrl, window.location.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function installDesktopFetchHeader(): void {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isSameOrigin(input)) return nativeFetch(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(DESKTOP_IDENTITY.header, '1');
    return nativeFetch(input, { ...init, headers });
  };
}

contextBridge.exposeInMainWorld('cliJawDesktop', {
  identify: () => DESKTOP_IDENTITY,
  getMetrics: () => getLatestMetrics(),
});

installDesktopFetchHeader();
setupMetricsBridge();
