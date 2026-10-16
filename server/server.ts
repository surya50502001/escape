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
}

const clients = new Map<WebSocket, ConnectedClient>();

wss.on('connection', (ws: WebSocket) => {
  const playerId = `player_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const player = engine.addHumanPlayer(playerId, 'You');
  clients.set(ws, { ws, playerId });

  // Send initial welcome
  ws.send(JSON.stringify({
    type: 'WELCOME',
    playerId,
    name: player.name
  }));

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'INPUT') {
        const input: ClientInput = data.input;
        engine.handleInput(playerId, input);
      } else if (data.type === 'SET_NAME') {
        if (player && typeof data.name === 'string') {
          player.name = data.name.slice(0, 15);
        }
      }
    } catch (e) {
      // Ignore malformed payloads
    }
  });

  ws.on('close', () => {
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

  // Update Game State
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[The Pit Server] Running on http://localhost:${PORT}`);
});
