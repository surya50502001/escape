export interface WindowLocationLike {
  protocol: string;
  hostname: string;
  port: string;
  host: string;
}

export interface NetworkEnvLike {
  VITE_WS_URL?: string;
  VITE_WS_PORT?: string;
}

/**
 * Resolves the authoritative WebSocket URL based on environment and runtime context.
 * - Supports VITE_WS_URL explicit override.
 * - Supports VITE_WS_PORT port override.
 * - In Vite development mode (port 5173 / 517x), routes through the `/ws` proxy on the same host:port
 *   to ensure seamless connectivity from both localhost and LAN devices.
 * - In production, defaults to direct server port or current host.
 */
export function resolveWebSocketUrl(
  loc: WindowLocationLike = typeof window !== 'undefined' ? window.location : { protocol: 'http:', hostname: 'localhost', port: '5173', host: 'localhost:5173' },
  env: NetworkEnvLike = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
): string {
  if (env.VITE_WS_URL) {
    return env.VITE_WS_URL;
  }
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = loc.hostname || 'localhost';
  const isViteDev = loc.port === '5173' || (loc.port && Number(loc.port) >= 5170 && Number(loc.port) <= 5180);

  if (env.VITE_WS_PORT) {
    return `${protocol}//${wsHost}:${env.VITE_WS_PORT}`;
  }
  if (isViteDev) {
    return `${protocol}//${loc.host}/ws`;
  }
  const portPart = loc.port ? `:${loc.port}` : ':3001';
  return `${protocol}//${wsHost}${portPart}`;
}
