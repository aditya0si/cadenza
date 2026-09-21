import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the socket origin.
 *
 * The original bug: `SOCKET_URL` was `VITE_SOCKET_URL ?? assetUrl('')`, and `assetUrl('')` returns ''
 * — `io('')` then dials the *current* origin. In the built app (and in any split deployment where
 * the client and API are on different hosts) that upgraded ws://<client-host>/socket.io, which the
 * static host answers with its SPA fallback (HTTP 200) instead of a 101, so collaborative playback
 * and chat silently never connected. Every unit test and the e2e harness missed it because they
 * talk to the API in-process.
 */

const ioMock = vi.fn((..._args: unknown[]) => ({
  auth: {} as { token?: string },
  on: vi.fn(),
  removeAllListeners: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io: ioMock }));

/** Module-level constants read import.meta.env, so re-import after stubbing. */
const loadSocketModule = async (): Promise<typeof import('./socket')> => {
  vi.resetModules();
  return import('./socket');
};

const dialedUrl = (): unknown => ioMock.mock.calls[0]?.[0];

describe('socket origin resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    ioMock.mockClear();
  });

  it('dials the API host when VITE_SOCKET_URL is unset (the split-deployment case)', async () => {
    vi.stubEnv('VITE_API_URL', 'https://cadenza-api.onrender.com/api');
    vi.stubEnv('VITE_SOCKET_URL', '');

    const { getSocket } = await loadSocketModule();
    getSocket('token-1');

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(dialedUrl()).toBe('https://cadenza-api.onrender.com');
  });

  it('honours an explicit VITE_SOCKET_URL when one is configured', async () => {
    vi.stubEnv('VITE_API_URL', 'https://cadenza-api.onrender.com/api');
    vi.stubEnv('VITE_SOCKET_URL', 'https://sockets.example.test');

    const { getSocket } = await loadSocketModule();
    getSocket('token-1');

    expect(dialedUrl()).toBe('https://sockets.example.test');
  });

  it('never dials the page origin or an empty string when the API is on another host', async () => {
    vi.stubEnv('VITE_API_URL', 'https://cadenza-api.onrender.com/api');
    vi.stubEnv('VITE_SOCKET_URL', '');

    const { getSocket } = await loadSocketModule();
    getSocket('token-1');

    expect(dialedUrl()).not.toBe('');
    expect(dialedUrl()).not.toBe(window.location.origin);
    expect(String(dialedUrl()).startsWith('https://cadenza-api.onrender.com')).toBe(true);
  });

  it('keeps the same-origin default when the API URL is a relative proxied path', async () => {
    vi.stubEnv('VITE_API_URL', '/api');
    vi.stubEnv('VITE_SOCKET_URL', '');

    const { getSocket } = await loadSocketModule();
    getSocket('token-1');

    // '' means "the origin that served the app", which is what a dev/preview proxy forwards.
    expect(dialedUrl()).toBe('');
  });
});

/**
 * The server refuses a socket payload over `SOCKET_MAX_PAYLOAD_BYTES` at the
 * transport, so the only trace of *why* the connection dropped is the WebSocket
 * close code inside socket.io's disconnect details. Without this mapping the UI
 * saw a silent disconnect.
 */
describe('oversized payload close code', () => {
  it('maps close code 1009 to a typed PAYLOAD_TOO_LARGE error', async () => {
    const { payloadTooLargeError } = await loadSocketModule();
    const typed = payloadTooLargeError({
      description: 'websocket connection closed',
      context: { code: 1009 },
    });
    expect(typed?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(typed?.message).toMatch(/larger than the server accepts/);
  });

  it('ignores every other drop', async () => {
    const { payloadTooLargeError } = await loadSocketModule();
    expect(payloadTooLargeError({ context: { code: 1000 } })).toBeNull();
    expect(payloadTooLargeError({ context: {} })).toBeNull();
    expect(payloadTooLargeError({ description: 'transport close' })).toBeNull();
    expect(payloadTooLargeError(undefined)).toBeNull();
    expect(payloadTooLargeError('transport close')).toBeNull();
  });
});
