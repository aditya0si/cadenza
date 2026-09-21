import { describe, expect, it } from 'vitest';
import { PresenceRegistry } from '../../src/realtime/presence.js';

describe('PresenceRegistry', () => {
  it('tracks connected users per room', () => {
    const presence = new PresenceRegistry();
    presence.add('room-1', 'user-a', 'socket-1');
    presence.add('room-1', 'user-b', 'socket-2');
    expect(presence.connectedUserIds('room-1').sort()).toEqual(['user-a', 'user-b']);
    expect(presence.socketCount('room-1')).toBe(2);
    expect(presence.roomIds()).toEqual(['room-1']);
  });

  it('keeps a user present while another of their sockets is open', () => {
    const presence = new PresenceRegistry();
    presence.add('room-1', 'user-a', 'socket-1');
    presence.add('room-1', 'user-a', 'socket-2');
    expect(presence.socketCount('room-1')).toBe(2);
    expect(presence.remove('room-1', 'socket-1')).toBeNull();
    expect(presence.connectedUserIds('room-1')).toEqual(['user-a']);
    expect(presence.remove('room-1', 'socket-2')).toBe('user-a');
    expect(presence.connectedUserIds('room-1')).toEqual([]);
    expect(presence.roomIds()).toEqual([]);
  });

  it('reports every room a socket must be cleaned out of on disconnect', () => {
    const presence = new PresenceRegistry();
    presence.add('room-1', 'user-a', 'socket-1');
    presence.add('room-2', 'user-a', 'socket-1');
    presence.add('room-2', 'user-b', 'socket-2');
    const affected = presence.removeSocket('socket-1').sort((a, b) => a.roomId.localeCompare(b.roomId));
    expect(affected).toEqual([
      { roomId: 'room-1', userId: 'user-a' },
      { roomId: 'room-2', userId: 'user-a' },
    ]);
    expect(presence.connectedUserIds('room-2')).toEqual(['user-b']);
    // A second cleanup for the same socket is a no-op.
    expect(presence.removeSocket('socket-1')).toEqual([]);
  });

  it('ignores removals for unknown rooms or sockets', () => {
    const presence = new PresenceRegistry();
    expect(presence.remove('missing-room', 'socket-1')).toBeNull();
    presence.add('room-1', 'user-a', 'socket-1');
    expect(presence.remove('room-1', 'socket-unknown')).toBeNull();
    expect(presence.connectedUserIds('room-1')).toEqual(['user-a']);
  });
});
