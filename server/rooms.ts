import { WebSocket } from 'ws';
import { GameEngine } from './gameEngine.js';

export interface RoomSession {
  resumeToken: string;
  playerId: string;
  name: string;
  ws: WebSocket | null;
  disconnectTime: number | null;
}

export interface RoomClient {
  ws: WebSocket;
  playerId: string;
  resumeToken: string;
  msgCount: number;
  lastResetTime: number;
}

/**
 * An isolated match room hosting an independent match lifecycle:
 * independent GameEngine, players, timers, equipment, and physics.
 */
export class MatchRoom {
  public id: string;
  public engine: GameEngine;
  public sessions: Map<string, RoomSession> = new Map();
  public playerToSession: Map<string, string> = new Map();
  public clients: Map<WebSocket, RoomClient> = new Map();
  public createdAt: number;

  constructor(id: string = 'default') {
    this.id = id;
    this.engine = new GameEngine();
    this.createdAt = Date.now();
  }

  /** Advance authoritative physics & game logic for this room */
  public update(): void {
    this.engine.update();
  }

  /** Broadcast current room state to all clients connected to this room */
  public broadcast(): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify({
      type: 'SYNC',
      state: this.engine.state
    });

    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) {
        ws.send(payload);
      }
    }
  }

  /** Cleanly remove a client socket on disconnect */
  public handleClientDisconnect(ws: WebSocket, now: number = Date.now()): void {
    const client = this.clients.get(ws);
    if (client) {
      this.clients.delete(ws);
      const session = this.sessions.get(client.resumeToken);
      if (session && session.ws === ws) {
        session.ws = null;
        session.disconnectTime = now;
        this.engine.removePlayer(client.playerId, false);
      }
    }
  }

  /** Periodic cleanup of expired disconnected sessions (60s grace period) */
  public cleanExpiredSessions(now: number = Date.now()): void {
    for (const [token, session] of this.sessions.entries()) {
      if (session.disconnectTime !== null && (now - session.disconnectTime > 60000)) {
        this.engine.removePlayer(session.playerId, true);
        this.playerToSession.delete(session.playerId);
        this.sessions.delete(token);
      }
    }
  }
}

/**
 * RoomManager coordinates isolated MatchRooms across the server.
 * Preserves the default single-room experience while allowing isolated matches.
 */
export class RoomManager {
  private rooms: Map<string, MatchRoom> = new Map();

  constructor() {
    this.rooms.set('default', new MatchRoom('default'));
  }

  public getOrCreateRoom(id: string = 'default'): MatchRoom {
    let room = this.rooms.get(id);
    if (!room) {
      room = new MatchRoom(id);
      this.rooms.set(id, room);
    }
    return room;
  }

  public getRoom(id: string): MatchRoom | undefined {
    return this.rooms.get(id);
  }

  public getDefaultRoom(): MatchRoom {
    return this.getOrCreateRoom('default');
  }

  public getAllRooms(): MatchRoom[] {
    return Array.from(this.rooms.values());
  }

  public removeRoom(id: string): boolean {
    if (id === 'default') return false; // Default room is persistent
    return this.rooms.delete(id);
  }

  public updateAllRooms(): void {
    for (const room of this.rooms.values()) {
      room.update();
      room.broadcast();
    }
  }

  public cleanAllExpiredSessions(now: number = Date.now()): void {
    for (const room of this.rooms.values()) {
      room.cleanExpiredSessions(now);
    }
  }
}
