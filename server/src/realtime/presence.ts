/**
 * Who is actually connected, per room. A user may hold several sockets (two
 * browser tabs); presence only goes away when the last socket for that user
 * leaves, which is what the avatar stack in the UI shows.
 */
export class PresenceRegistry {
  private readonly rooms = new Map<string, Map<string, Set<string>>>();
  private readonly socketRooms = new Map<string, Set<string>>();

  add(roomId: string, userId: string, socketId: string): void {
    let members = this.rooms.get(roomId);
    if (!members) {
      members = new Map<string, Set<string>>();
      this.rooms.set(roomId, members);
    }
    let sockets = members.get(userId);
    if (!sockets) {
      sockets = new Set<string>();
      members.set(userId, sockets);
    }
    sockets.add(socketId);

    let joined = this.socketRooms.get(socketId);
    if (!joined) {
      joined = new Set<string>();
      this.socketRooms.set(socketId, joined);
    }
    joined.add(roomId);
  }

  /** Removes one socket; returns the userId when that was the user's last socket. */
  remove(roomId: string, socketId: string): string | null {
    const members = this.rooms.get(roomId);
    if (!members) return null;
    let disconnectedUser: string | null = null;
    for (const [userId, sockets] of members) {
      if (!sockets.has(socketId)) continue;
      sockets.delete(socketId);
      if (sockets.size === 0) {
        members.delete(userId);
        disconnectedUser = userId;
      }
      break;
    }
    if (members.size === 0) this.rooms.delete(roomId);
    this.socketRooms.get(socketId)?.delete(roomId);
    return disconnectedUser;
  }

  /** Drops a socket from every room it was in (disconnect handler). */
  removeSocket(socketId: string): { roomId: string; userId: string }[] {
    const joined = this.socketRooms.get(socketId);
    if (!joined) return [];
    const affected: { roomId: string; userId: string }[] = [];
    for (const roomId of [...joined]) {
      const userId = this.remove(roomId, socketId);
      if (userId) affected.push({ roomId, userId });
    }
    this.socketRooms.delete(socketId);
    return affected;
  }

  connectedUserIds(roomId: string): string[] {
    return [...(this.rooms.get(roomId)?.keys() ?? [])];
  }

  socketCount(roomId: string): number {
    let total = 0;
    for (const sockets of this.rooms.get(roomId)?.values() ?? []) total += sockets.size;
    return total;
  }

  /** Room ids that currently have at least one connected socket. */
  roomIds(): string[] {
    return [...this.rooms.keys()];
  }
}

