import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameEngine } from './gameEngine.js';
import { BotController } from './botController.js';
import { ClientInput } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const engine = new GameEngine();
const botController = new BotController();

// Serve static frontend build if available
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

interface ConnectedClient {
  ws: WebSocket;
  playerId: string;
  msgCount: number;
  lastResetTime: number;
}

const clients = new Map<WebSocket, ConnectedClient>();
const MAX_MESSAGES_PER_SEC = 60;

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
  if (typeof obj.aimAngle === 'number' && Number.isFinite(obj.aimAngle)) {
    // Clamp to valid radian range
    aimAngle = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, obj.aimAngle));
  }

  return {
    left: Boolean(obj.left),
    right: Boolean(obj.right),
    up: Boolean(obj.up),
    down: Boolean(obj.down),
    jump: Boolean(obj.jump),
    interact: Boolean(obj.interact),
    attack: Boolean(obj.attack),
    tackle: Boolean(obj.tackle),
    aimAngle
  };
}

wss.on('connection', (ws: WebSocket) => {
  const playerId = `player_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const player = engine.addHumanPlayer(playerId, 'You');

  // Room Full Handling
  if (!player) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      code: 'ROOM_FULL',
      message: 'The cell is currently at full capacity (10/10 prisoners).'
    }));
    ws.close(1008, 'Room Full');
    return;
  }

  const clientInfo: ConnectedClient = {
    ws,
    playerId,
    msgCount: 0,
    lastResetTime: Date.now()
  };
  clients.set(ws, clientInfo);

  // Send initial welcome with assigned ID
  ws.send(JSON.stringify({
    type: 'WELCOME',
    playerId,
    name: player.name
  }));

  ws.on('message', (message: string) => {
    // Rate limit check
    const now = Date.now();
    if (now - clientInfo.lastResetTime >= 1000) {
      clientInfo.msgCount = 0;
      clientInfo.lastResetTime = now;
    }
    clientInfo.msgCount++;
    if (clientInfo.msgCount > MAX_MESSAGES_PER_SEC) {
      // Drop excessive message to prevent server flood
      return;
    }

    try {
      const data = JSON.parse(message.toString());
      if (data && data.type === 'INPUT') {
        const validatedInput = sanitizeInput(data.input);
        if (validatedInput) {
          engine.handleInput(playerId, validatedInput);
        }
      } else if (data && data.type === 'SET_NAME') {
        if (typeof data.name === 'string') {
          const sanitized = data.name.trim().slice(0, 15);
          if (sanitized && player) {
            player.name = sanitized;
          }
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    engine.removePlayer(playerId);
  });

  ws.on('error', () => {
    clients.delete(ws);
    engine.removePlayer(playerId);
  });
});

// Authoritative Tick Loop at 30 FPS
const TICK_INTERVAL_MS = 1000 / 30;

setInterval(() => {
  // Update Bot inputs
  for (const p of engine.state.players) {
    if (p.isBot) {
      const botInput = botController.getBotInput(p, engine.state);
      engine.handleInput(p.id, botInput);
    }
  }

  // Update Game State (advances physics, checks quota, flushes soundEvents)
  engine.update();

  // Broadcast state to all connected clients
  if (clients.size > 0) {
    const payload = JSON.stringify({
      type: 'SYNC',
      state: engine.state
    });

    for (const [ws] of clients) {
      if (ws.readyState === WebSocket.OPEN) {
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
