import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { GameEngine } from './gameEngine.js';
import { ClientInput, MAX_PLAYERS } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

export const engine = new GameEngine();

// Serve static frontend build if available
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

export interface SessionInfo {
  resumeToken: string;
  playerId: string;
  name: string;
  ws: WebSocket | null;
  disconnectTime: number | null;
}

export const sessions = new Map<string, SessionInfo>();
export const playerToSession = new Map<string, string>();

interface ConnectedClient {
  ws: WebSocket;
  playerId: string;
  resumeToken: string;
  msgCount: number;
  lastResetTime: number;
}

export const clients = new Map<WebSocket, ConnectedClient>();
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
    const client = clients.get(ws);
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

        // 1. Reconnection Check via resumeToken
        const token = typeof data.resumeToken === 'string' ? data.resumeToken.trim() : '';
        if (token && sessions.has(token)) {
          const session = sessions.get(token)!;
          const isStillValid = session.disconnectTime === null || (now - session.disconnectTime < 60000);
          const existingPlayer = engine.state.players.find(p => p.id === session.playerId);

          if (isStillValid && existingPlayer) {
            const oldWs = session.ws;
            if (oldWs && oldWs !== ws) {
              clients.delete(oldWs);
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

            clients.set(ws, {
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
              phase: engine.state.phase
            }));
            return;
          }
        }

        // 2. New Join Check: strictly verify room capacity
        if (engine.state.players.length >= MAX_PLAYERS) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            code: 'ROOM_FULL',
            message: 'Room is full. Try again later.'
          }));
          return;
        }

        const playerId = `p_${crypto.randomBytes(4).toString('hex')}`;
        const resumeToken = crypto.randomUUID();
        const player = engine.addHumanPlayer(playerId, sanitizedName);

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
        sessions.set(resumeToken, newSession);
        playerToSession.set(playerId, resumeToken);

        clients.set(ws, {
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
          phase: engine.state.phase
        }));

      } else if (data.type === 'INPUT') {
        if (client) {
          const validatedInput = sanitizeInput(data.input);
          if (validatedInput) {
            engine.handleInput(client.playerId, validatedInput);
          }
        }
      } else if (data.type === 'READY') {
        if (engine.state.phase === 'LOBBY' && engine.state.players.length >= 1) {
          engine.startNewMatch();
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
  const client = clients.get(ws);
  if (client) {
    clients.delete(ws);
    const session = sessions.get(client.resumeToken);
    if (session) {
      if (session.ws === ws) {
        session.ws = null;
        session.disconnectTime = now;
        engine.removePlayer(client.playerId, false);
      }
    }
  }
}

// Periodic Session Expiry Cleanup (every 5 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.disconnectTime !== null && (now - session.disconnectTime > 60000)) {
      // Reconnect window expired (60s): release player slot permanently
      engine.removePlayer(session.playerId, true);
      playerToSession.delete(session.playerId);
      sessions.delete(token);
    }
  }
}, 5000);

// Authoritative Tick Loop at 30 FPS
const TICK_INTERVAL_MS = 1000 / 30;

setInterval(() => {
  // Update Game State (advances physics, checks quota, flushes soundEvents)
  engine.update();

  // Broadcast state to all connected clients with backpressure protection
  if (clients.size > 0) {
    const payload = JSON.stringify({
      type: 'SYNC',
      state: engine.state
    });

    for (const [ws] of clients) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) {
        ws.send(payload);
      }
    }
  }
}, TICK_INTERVAL_MS);

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[The Pit Server] Local: http://localhost:${PORT}`);
  console.log(`[The Pit Server] LAN:   http://192.168.0.6:${PORT}`);
});
