import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { GameEngine } from './gameEngine.js';
import { RoomManager, RoomSession, RoomClient, MatchRoom } from './rooms.js';
import { ClientInput, MAX_PLAYERS, Player } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

export const roomManager = new RoomManager();
export const defaultRoom = roomManager.getDefaultRoom();
export const engine = defaultRoom.engine;
export const sessions = defaultRoom.sessions;
export const clients = defaultRoom.clients;
export const playerToSession = defaultRoom.playerToSession;

// Serve static frontend build if available
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

export type SessionInfo = RoomSession;
export type ConnectedClient = RoomClient;

const MAX_MESSAGES_PER_SEC = 60;
const MAX_MESSAGE_BYTES = 4096;

/**
 * Strict boolean validator: only literal `true` is accepted.
 * Guards against loose truthy evaluations like `Boolean("false") === true`.
 */
export function strictBool(val: unknown): boolean {
  return val === true;
}

/**
 * Validates and sanitizes player names.
 * Trims whitespace, limits to 16 characters, strips HTML/control characters.
 */
export function sanitizePlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length === 0) return null;
  const clamped = trimmed.slice(0, 16);
  const sanitized = clamped.replace(/[<>'"&]/g, '').trim();
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Validates and sanitizes raw input from clients.
 * Protects against NaN, Infinity, invalid types, and malformed fields.
 */
export function sanitizeInput(raw: unknown): ClientInput | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  let aimAngle = 0;
  if (typeof obj.aimAngle === 'number' && Number.isFinite(obj.aimAngle) && !Number.isNaN(obj.aimAngle)) {
    // Clamp to valid radian range
    aimAngle = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, obj.aimAngle));
  }

  return {
    left: strictBool(obj.left),
    right: strictBool(obj.right),
    up: strictBool(obj.up),
    down: strictBool(obj.down),
    jump: strictBool(obj.jump),
    interact: strictBool(obj.interact),
    attack: strictBool(obj.attack),
    tackle: strictBool(obj.tackle),
    pull: strictBool(obj.pull),
    climbKick: strictBool(obj.climbKick),
    climbGrab: strictBool(obj.climbGrab),
    struggle: strictBool(obj.struggle),
    aimAngle
  };
}

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (rawMessage: Buffer | string) => {
    // Message payload size limit
    if (rawMessage.length > MAX_MESSAGE_BYTES) {
      return;
    }

    // Rate limit check
    const currentRoom = roomManager.findRoomBySocket(ws);
    const client = currentRoom ? currentRoom.clients.get(ws) : null;
    const now = Date.now();
    if (client) {
      if (now - client.lastResetTime >= 1000) {
        client.msgCount = 0;
        client.lastResetTime = now;
      }
      client.msgCount++;
      if (client.msgCount > MAX_MESSAGES_PER_SEC) {
        return; // Drop excessive messages to prevent flood
      }
    }

    try {
      const data = JSON.parse(rawMessage.toString());
      if (!data || typeof data !== 'object') return;

      if (data.type === 'JOIN') {
        const sanitizedName = sanitizePlayerName(data.name);
        if (!sanitizedName) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            code: 'INVALID_NAME',
            message: 'Please enter a valid player name (1-16 characters).'
          }));
          return;
        }

        const token = typeof data.resumeToken === 'string' ? data.resumeToken.trim() : '';
        const requestedCode = typeof data.roomCode === 'string' ? data.roomCode.trim().toUpperCase() : '';
        const shouldCreate = data.createRoom === true;

        let targetRoom: MatchRoom | undefined;

        // 1. Reconnection Check: Reconnect ONLY to player's original room
        if (token) {
          const originalRoom = roomManager.findRoomByToken(token);
          if (originalRoom) {
            targetRoom = originalRoom;
          }
        }

        // 2. Room Resolution if not reconnecting to an existing session
        if (!targetRoom) {
          if (shouldCreate) {
            targetRoom = roomManager.createPrivateRoom();
          } else if (requestedCode && requestedCode !== 'DEFAULT') {
            targetRoom = roomManager.getRoom(requestedCode);
            if (!targetRoom) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'ROOM_NOT_FOUND',
                message: `Room "${requestedCode}" does not exist. Check code or create a new room.`
              }));
              return;
            }
          } else {
            targetRoom = roomManager.getDefaultRoom();
          }
        }

        // 3. Check for existing session in this room
        if (token && targetRoom.sessions.has(token)) {
          const session = targetRoom.sessions.get(token)!;
          const isStillValid = session.disconnectTime === null || (now - session.disconnectTime < 60000);
          const existingPlayer = targetRoom.engine.state.players.find(p => p.id === session.playerId);

          if (isStillValid && existingPlayer) {
            const oldWs = session.ws;
            if (oldWs && oldWs !== ws) {
              targetRoom.clients.delete(oldWs);
              try {
                if (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING) {
                  oldWs.close(1000, 'Reconnected from another window');
                }
              } catch {
                // Ignore socket close error
              }
            }
            session.ws = ws;
            session.disconnectTime = null;
            session.name = sanitizedName;
            existingPlayer.name = sanitizedName;

            targetRoom.clients.set(ws, {
              ws,
              playerId: session.playerId,
              resumeToken: session.resumeToken,
              msgCount: 0,
              lastResetTime: now
            });

            ws.send(JSON.stringify({
              type: 'WELCOME',
              playerId: session.playerId,
              name: session.name,
              resumeToken: session.resumeToken,
              phase: targetRoom.engine.state.phase,
              roomCode: targetRoom.id
            }));
            return;
          }
        }

        // 4. Capacity validation for target room
        if (targetRoom.engine.state.players.length >= MAX_PLAYERS) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            code: 'ROOM_FULL',
            message: 'Room is full. Try again later.'
          }));
          return;
        }

        // 5. Add new player to target room
        const playerId = `p_${crypto.randomBytes(4).toString('hex')}`;
        const resumeToken = crypto.randomUUID();
        const player = targetRoom.engine.addHumanPlayer(playerId, sanitizedName);

        if (!player) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            code: 'ROOM_FULL',
            message: 'Room is full. Try again later.'
          }));
          return;
        }

        const newSession: SessionInfo = {
          resumeToken,
          playerId,
          name: sanitizedName,
          ws,
          disconnectTime: null
        };
        targetRoom.sessions.set(resumeToken, newSession);
        targetRoom.playerToSession.set(playerId, resumeToken);
        roomManager.associateTokenWithRoom(resumeToken, targetRoom.id);

        targetRoom.clients.set(ws, {
          ws,
          playerId,
          resumeToken,
          msgCount: 0,
          lastResetTime: now
        });

        ws.send(JSON.stringify({
          type: 'WELCOME',
          playerId,
          name: sanitizedName,
          resumeToken,
          phase: targetRoom.engine.state.phase,
          roomCode: targetRoom.id
        }));

      } else if (data.type === 'INPUT') {
        const room = roomManager.findRoomBySocket(ws);
        if (room) {
          const roomClient = room.clients.get(ws);
          if (roomClient) {
            const validatedInput = sanitizeInput(data.input);
            if (validatedInput) {
              room.engine.handleInput(roomClient.playerId, validatedInput);
            }
          }
        }
      } else if (data.type === 'READY') {
        const room = roomManager.findRoomBySocket(ws);
        if (room) {
          if (room.engine.state.phase === 'LOBBY' && room.engine.state.players.length >= 1) {
            room.engine.startNewMatch();
          }
        }
      }
    } catch {
      // Ignore malformed JSON safely
    }
  });

  const handleDisconnect = () => {
    handleClientDisconnect(ws);
  };

  ws.on('close', handleDisconnect);
  ws.on('error', handleDisconnect);
});

export function handleClientDisconnect(ws: WebSocket, now: number = Date.now()): void {
  const room = roomManager.findRoomBySocket(ws) || defaultRoom;
  room.handleClientDisconnect(ws, now);
}

const isMain = Boolean(process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js')));

if (isMain) {
  // Periodic Session Expiry Cleanup (every 5 seconds)
  setInterval(() => {
    roomManager.cleanAllExpiredSessions(Date.now());
  }, 5000);

  // Authoritative Tick Loop at 30 FPS across all active rooms
  const TICK_INTERVAL_MS = 1000 / 30;

  setInterval(() => {
    roomManager.updateAllRooms();
  }, TICK_INTERVAL_MS);

  const PORT = Number(process.env.PORT) || 3001;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[The Pit Server] Local: http://localhost:${PORT}`);
    console.log(`[The Pit Server] LAN:   http://192.168.0.6:${PORT}`);
  });
}

