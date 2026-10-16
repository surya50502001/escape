import { GameState } from '../server/types.js';
import { GameRenderer } from './renderer.js';
import { InputManager } from './input.js';
import { sound } from './audio.js';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const audioBtn = document.getElementById('audioBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

const renderer = new GameRenderer(canvas);
const inputManager = new InputManager(canvas);

let localPlayerId: string = '';
let latestState: GameState | null = null;

// Audio toggle
audioBtn.addEventListener('click', () => {
  sound.init();
  sound.enabled = !sound.enabled;
  audioBtn.textContent = sound.enabled ? '🔊 Audio: ON' : '🔇 Audio: OFF';
});

// Setup WebSocket Connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsHost = window.location.hostname || 'localhost';
const wsPort = window.location.port || '3001';
const wsUrl = `${protocol}//${wsHost}:${wsPort}`;

const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  statusDiv.textContent = 'CONNECTED TO THE PIT';
  statusDiv.style.color = '#2ecc71';
};

ws.onclose = () => {
  statusDiv.textContent = 'DISCONNECTED FROM SERVER';
  statusDiv.style.color = '#e74c3c';
};

ws.onerror = () => {
  statusDiv.textContent = 'SERVER ERROR - RETRYING...';
  statusDiv.style.color = '#e74c3c';
};

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'WELCOME') {
      localPlayerId = data.playerId;
    } else if (data.type === 'SYNC') {
      latestState = data.state;

      // Update local player position for mouse aiming reference
      const me = latestState?.players.find(p => p.id === localPlayerId);
      if (me) {
        (window as unknown as { localPlayerX: number; localPlayerY: number }).localPlayerX = me.x;
        (window as unknown as { localPlayerY: number }).localPlayerY = me.y;
      }

      // Handle Sound & Visual Events
      if (latestState?.soundEvents) {
        for (const ev of latestState.soundEvents) {
          if (ev.type === 'GUNSHOT') {
            sound.playGunshot();
            if (ev.x !== undefined && ev.y !== undefined) {
              renderer.addBloodSparks(ev.x, ev.y, '#e74c3c', 25);
            }
          } else if (ev.type === 'CLANG') {
            sound.playClang();
          } else if (ev.type === 'TACKLE') {
            sound.playTackle();
            if (ev.x !== undefined && ev.y !== undefined) {
              renderer.addBloodSparks(ev.x, ev.y, '#ecf0f1', 10);
            }
          } else if (ev.type === 'ROCK_HIT') {
            sound.playRockHit();
            if (ev.x !== undefined && ev.y !== undefined) {
              renderer.addBloodSparks(ev.x, ev.y, '#f39c12', 15);
            }
          } else if (ev.type === 'ESCAPE') {
            sound.playEscape();
          } else if (ev.type === 'ANNOUNCEMENT') {
            sound.playAnnouncement();
          }
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
};

// Send player input loop (30 FPS)
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN && localPlayerId) {
    const currentInput = inputManager.poll();
    ws.send(JSON.stringify({
      type: 'INPUT',
      input: currentInput
    }));
  }
}, 1000 / 30);

// Render loop (60 FPS)
function gameLoop() {
  if (latestState) {
    renderer.render(latestState, localPlayerId);
  }
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
