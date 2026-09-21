import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { closeSockets, createTestHarness, emitWithAck, type TestHarness } from '../helpers/harness.js';
import { uniqueEventId } from '../helpers/factory.js';
import { messageRepository } from '../../src/repositories/message.repository.js';
import type { RoomDto } from '../../src/http/serializers.js';

/**
 * The bounds that protect the realtime server from one noisy or hostile client.
 *
 * Both were missing: `playback:report` had no token bucket (chat and queue did),
 * and the Socket.IO server had no `maxHttpBufferSize`, so a 1.2 MB payload was
 * buffered and then dropped as a bare disconnect with nothing typed to act on.
 */
const mongoUri = inject('mongoUri');

const REPORT_BURST = 3;
const PAYLOAD_BOUND_BYTES = 8 * 1024;

let harness: TestHarness;
let hostToken: string;
let roomId: string;

interface Ack {
  ok: boolean;
  duplicate?: boolean;
  error?: { code: string; message: string };
  driftMs?: number;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  harness = await createTestHarness(mongoUri, {
    envOverrides: {
      SOCKET_REPORT_BURST: String(REPORT_BURST),
      SOCKET_REPORT_REFILL_PER_SEC: '0.1',
      SOCKET_MAX_PAYLOAD_BYTES: String(PAYLOAD_BOUND_BYTES),
    },
  });
  const host = await harness.signIn('limits-host@cadenza.test', 'Limits Host');
  hostToken = host.token;
  const created = await harness
    .request()
    .post('/api/rooms')
    .set(auth(hostToken))
    .send({ name: 'Limits Room' })
    .expect(201);
  roomId = (created.body.room as RoomDto).id;
});

afterAll(async () => {
  await harness.close();
});

describe('per-socket bounds', () => {
  it('applies the configured payload bound to the socket server', () => {
    expect(harness.env.SOCKET_MAX_PAYLOAD_BYTES).toBe(PAYLOAD_BOUND_BYTES);
    expect(harness.server.realtime.io.engine.opts.maxHttpBufferSize).toBe(PAYLOAD_BOUND_BYTES);
  });

  it('buckets playback:report like chat and queue', async () => {
    const socket = await harness.connectSocket(hostToken);
    await emitWithAck<Ack>(socket, 'room:join', { roomId });

    const codes: (string | undefined)[] = [];
    for (let index = 0; index < REPORT_BURST + 4; index += 1) {
      const ack = await emitWithAck<Ack>(socket, 'playback:report', { roomId, positionMs: 1_000 });
      codes.push(ack.error?.code);
    }

    // The burst goes through, everything after it is refused with a typed code.
    expect(codes.filter((code) => code === undefined)).toHaveLength(REPORT_BURST);
    expect(codes).toContain('RATE_LIMITED');
    await closeSockets(socket);
  });

  it('refuses an oversized payload with a typed close and a typed log, not a silent drop', async () => {
    const socket = await harness.connectSocket(hostToken);
    await emitWithAck<Ack>(socket, 'room:join', { roomId });

    const warned = vi.spyOn(harness.server.ctx.logger, 'warn');
    const dropped = new Promise<{ reason: string; details?: unknown }>((resolve) => {
      socket.once('disconnect', (reason: string, details?: unknown) => resolve({ reason, details }));
    });

    // 1.2 MB — the payload size from the review, over the 8 kB bound here.
    socket.emit(
      'chat:message',
      { roomId, body: 'x'.repeat(1_200_000), eventId: uniqueEventId('chat') },
      () => undefined,
    );

    const drop = await dropped;
    expect(drop.reason).toBe('transport close');
    // 1009 is the WebSocket "message too big" close code: the client can tell
    // this apart from any other drop.
    expect((drop.details as { context?: { code?: number } } | undefined)?.context?.code).toBe(1009);
    expect(warned).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE', limitBytes: PAYLOAD_BOUND_BYTES }),
      expect.stringContaining('SOCKET_MAX_PAYLOAD_BYTES'),
    );
    warned.mockRestore();

    // Nothing was written and nothing was broadcast: the frame never reached a handler.
    expect(await messageRepository.countByRoom(roomId)).toBe(0);
    await closeSockets(socket);
  });

  it('keeps a payload inside the bound working', async () => {
    const socket = await harness.connectSocket(hostToken);
    await emitWithAck<Ack>(socket, 'room:join', { roomId });
    const ack = await emitWithAck<Ack>(socket, 'chat:message', {
      roomId,
      body: 'well inside the bound',
      eventId: uniqueEventId('chat'),
    });
    expect(ack.ok).toBe(true);
    expect(await messageRepository.countByRoom(roomId)).toBe(1);
    await closeSockets(socket);
  });

  it('still refuses a payload over the transport bound for a socket that never joined', async () => {
    const socket = await harness.connectSocket(hostToken);
    const dropped = new Promise<{ details?: unknown }>((resolve) => {
      socket.once('disconnect', (_reason: string, details?: unknown) => resolve({ details }));
    });
    socket.emit('chat:message', { roomId, body: 'y'.repeat(200_000), eventId: uniqueEventId('chat') }, () => undefined);
    const drop = await dropped;
    expect((drop.details as { context?: { code?: number } } | undefined)?.context?.code).toBe(1009);
    await closeSockets(socket);
  });
});
