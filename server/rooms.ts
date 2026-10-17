import { WebSocket } from 'ws';
import crypto from 'crypto';
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

  /** Check if a private room has no active clients and no unexpired sessions */
  public isExpired(now: number = Date.now()): boolean {
    if (this.id === 'default') return false; // Default room is permanent
    if (this.clients.size > 0) return false;
    if (this.sessions.size === 0) return true;
    for (const session of this.sessions.values()) {
      if (session.disconnectTime === null) return false;
      if (now - session.disconnectTime <= 60000) return false;
    }
    return true;
  }
}

/**
 * RoomManager coordinates isolated MatchRooms across the server.
 * Preserves the default single-room experience while allowing isolated matches.
 */
export class RoomManager {
  private rooms: Map<string, MatchRoom> = new Map();
  private tokenToRoomId: Map<string, string> = new Map();

  constructor() {
    this.rooms.set('default', new MatchRoom('default'));
  }

  /** Generate an unguessable 6-character alphanumeric room code */
  public generateRoomCode(): string {
    let code: string;
    do {
      code = crypto.randomBytes(3).toString('hex').toUpperCase();
    } while (this.rooms.has(code) || code === 'DEFAULT');
    return code;
  }

  /** Create an isolated private room with an unguessable room code */
  public createPrivateRoom(): MatchRoom {
    const code = this.generateRoomCode();
    const room = new MatchRoom(code);
    this.rooms.set(code, room);
    return room;
  }

  public getOrCreateRoom(id: string = 'default'): MatchRoom {
    const cleanId = id.trim().toUpperCase() || 'default';
    let room = this.rooms.get(cleanId);
    if (!room) {
      room = new MatchRoom(cleanId);
      this.rooms.set(cleanId, room);
    }
    return room;
  }

  public getRoom(id: string): MatchRoom | undefined {
    return this.rooms.get(id.trim().toUpperCase());
  }

  public getDefaultRoom(): MatchRoom {
    return this.rooms.get('default')!;
  }

  /** Find the room where a resume token was originally registered */
  public findRoomByToken(token: string): MatchRoom | undefined {
    const roomId = this.tokenToRoomId.get(token);
    if (roomId && this.rooms.has(roomId)) {
      return this.rooms.get(roomId);
    }
    for (const room of this.rooms.values()) {
      if (room.sessions.has(token)) {
        this.tokenToRoomId.set(token, room.id);
        return room;
      }
    }
    return undefined;
  }

  public associateTokenWithRoom(token: string, roomId: string): void {
    this.tokenToRoomId.set(token, roomId.trim().toUpperCase());
  }

  /** Find which room owns a given WebSocket connection */
  public findRoomBySocket(ws: WebSocket): MatchRoom | undefined {
    for (const room of this.rooms.values()) {
      if (room.clients.has(ws)) {
        return room;
      }
    }
    return undefined;
  }

  public getAllRooms(): MatchRoom[] {
    return Array.from(this.rooms.values());
  }

  public removeRoom(id: string): boolean {
    const cleanId = id.trim().toUpperCase();
    if (cleanId === 'DEFAULT' || cleanId === 'default') return false;
    const room = this.rooms.get(cleanId);
    if (room) {
      for (const token of room.sessions.keys()) {
        this.tokenToRoomId.delete(token);
      }
    }
    return this.rooms.delete(cleanId);
  }

  public updateAllRooms(): void {
    for (const room of this.rooms.values()) {
      room.update();
      room.broadcast();
    }
  }

  public cleanAllExpiredSessions(now: number = Date.now()): void {
    for (const [id, room] of Array.from(this.rooms.entries())) {
      room.cleanExpiredSessions(now);
      if (id !== 'default' && room.isExpired(now)) {
        this.removeRoom(id);
      }
    }
  }
}
