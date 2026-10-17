import { GameState, ServerMessage } from '../server/types.js';
import { GameRenderer } from './renderer.js';
import { InputManager } from './input.js';
import { sound } from './audio.js';

// DOM elements
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const audioBtn = document.getElementById('audioBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const readyBtn = document.getElementById('readyBtn') as HTMLButtonElement | null;
const fullscreenBtn = document.getElementById('fullscreenBtn') as HTMLButtonElement | null;

const joinOverlay = document.getElementById('joinOverlay') as HTMLDivElement;
const joinForm = document.getElementById('joinForm') as HTMLFormElement;
const playerNameInput = document.getElementById('playerNameInput') as HTMLInputElement;
const joinBtn = document.getElementById('joinBtn') as HTMLButtonElement;
const joinError = document.getElementById('joinError') as HTMLDivElement;
const connectingState = document.getElementById('connectingState') as HTMLDivElement;
const connectingText = document.getElementById('connectingText') as HTMLSpanElement;

const renderer = new GameRenderer(canvas);
const inputManager = new InputManager(canvas);

let localPlayerId: string = '';
let localPlayerName: string = '';
let localResumeToken: string = '';
let latestState: GameState | null = null;
let ws: WebSocket | null = null;
let isConnecting: boolean = false;
let reconnectTimer: number | null = null;

// Pre-fill previously stored name from sessionStorage
const savedName = sessionStorage.getItem('pit_player_name');
if (savedName && playerNameInput) {
  playerNameInput.value = savedName;
}
const savedToken = sessionStorage.getItem('pit_resume_token');
if (savedToken) {
  localResumeToken = savedToken;
}

// Audio toggle
audioBtn.addEventListener('click', () => {
  sound.init();
  sound.enabled = !sound.enabled;
  audioBtn.textContent = sound.enabled ? '🔊 Audio: ON' : '🔇 Audio: OFF';
});

// Fullscreen toggle
if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      fullscreenBtn.textContent = '🗗 Exit Fullscreen';
    } else {
      document.exitFullscreen().catch(() => {});
      fullscreenBtn.textContent = '⛶ Fullscreen';
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.textContent = document.fullscreenElement ? '🗗 Exit Fullscreen' : '⛶ Fullscreen';
  });
}

if (readyBtn) {
  readyBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'READY' }));
    }
  });
}

function showError(message: string): void {
  joinError.textContent = message;
  joinError.style.display = 'block';
  connectingState.style.display = 'none';
  joinBtn.disabled = false;
  playerNameInput.disabled = false;
  joinBtn.textContent = 'RETRY';
  isConnecting = false;
}

function clearError(): void {
  joinError.textContent = '';
  joinError.style.display = 'none';
}

function connectToGame(name: string): void {
  if (isConnecting) return;
  isConnecting = true;
  clearError();

  joinBtn.disabled = true;
  playerNameInput.disabled = true;
  connectingText.textContent = 'CONNECTING TO CELL...';
  connectingState.style.display = 'flex';

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = window.location.hostname || 'localhost';
  const wsPort = window.location.port || '3001';
  const wsUrl = `${protocol}//${wsHost}:${wsPort}`;

  if (ws) {
    try {
      ws.close();
    } catch {
      // Ignore
    }
  }

  try {
    ws = new WebSocket(wsUrl);
  } catch {
    showError('Could not establish network connection. Please retry.');
    return;
  }

  ws.onopen = () => {
    connectingText.textContent = 'AUTHENTICATING IDENTITY...';
    // Send JOIN request with name and stored resumeToken
    ws?.send(JSON.stringify({
      type: 'JOIN',
      name,
      resumeToken: localResumeToken || undefined
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as ServerMessage;

      if (data.type === 'WELCOME') {
        localPlayerId = data.playerId;
        localPlayerName = data.name;
        localResumeToken = data.resumeToken;
        sessionStorage.setItem('pit_resume_token', data.resumeToken);
        sessionStorage.setItem('pit_player_name', data.name);

        isConnecting = false;
        joinOverlay.classList.add('hidden');
        statusDiv.textContent = `PRISONER: ${localPlayerName}`;
        statusDiv.style.color = '#22d3ee';
        sound.init();

      } else if (data.type === 'ERROR') {
        isConnecting = false;
        if (data.code === 'ROOM_FULL') {
          showError('Room is full. Try again later.');
        } else {
          showError(data.message || 'Failed to join chamber.');
        }
        ws?.close();

      } else if (data.type === 'SYNC') {
        latestState = data.state;

        if (readyBtn) {
          readyBtn.style.display = (latestState?.phase === 'LOBBY' && localPlayerId) ? 'inline-block' : 'none';
        }
        if (latestState?.phase === 'LOBBY' && localPlayerName) {
          statusDiv.textContent = `PRISONER: ${localPlayerName} (LOBBY - ${latestState.players.length} JOINED)`;
        } else if (localPlayerName) {
          statusDiv.textContent = `PRISONER: ${localPlayerName}`;
        }

        // Update local player position for mouse aiming reference
        const me = latestState?.players.find(p => p.id === localPlayerId);
        if (me) {
          (window as unknown as { localPlayerX: number; localPlayerY: number; isRopeAttachedToMe: boolean }).localPlayerX = me.x;
          (window as unknown as { localPlayerY: number; isRopeAttachedToMe: boolean }).localPlayerY = me.y;
          (window as unknown as { isRopeAttachedToMe: boolean }).isRopeAttachedToMe =
            Boolean(latestState?.rope.state === 'ATTACHED' && latestState?.rope.heldByPlayerId === me.id);
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
            } else if (ev.type === 'ROPE_ATTACH') {
              sound.playRockHit();
            } else if (ev.type === 'ROPE_PULL') {
              sound.playTackle();
            } else if (ev.type === 'FALL_IMPACT') {
              sound.playTackle();
              if (ev.x !== undefined && ev.y !== undefined) {
                renderer.addBloodSparks(ev.x, ev.y, '#94a3b8', 12);
              }
            } else if (ev.type === 'STEAM_HISS') {
              sound.playSteamHiss();
            } else if (ev.type === 'SPIKE_HIT') {
              sound.playSpikeHit();
              if (ev.x !== undefined && ev.y !== undefined) {
                renderer.addBloodSparks(ev.x, ev.y, '#dc2626', 15);
              }
            } else if (ev.type === 'CLIMB_KICK') {
              sound.playClimbKick();
              if (ev.x !== undefined && ev.y !== undefined) {
                renderer.addBloodSparks(ev.x, ev.y, '#f59e0b', 14);
              }
            } else if (ev.type === 'CLIMB_GRAB') {
              sound.playClimbGrab();
              if (ev.x !== undefined && ev.y !== undefined) {
                renderer.addBloodSparks(ev.x, ev.y, '#38bdf8', 10);
              }
            } else if (ev.type === 'CLIMB_STRUGGLE') {
              sound.playStruggle();
            } else if (ev.type === 'PICKUP' || ev.type === 'DROP') {
              sound.playClang();
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  ws.onclose = () => {
    if (!localPlayerId) {
      showError('Unable to connect to The Pit server. Click retry.');
    } else {
      statusDiv.textContent = 'DISCONNECTED - RECONNECTING...';
      statusDiv.style.color = '#e74c3c';

      if (!reconnectTimer) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          if (localPlayerName) {
            connectToGame(localPlayerName);
          }
        }, 2000);
      }
    }
  };

  ws.onerror = () => {
    if (!localPlayerId) {
      showError('Connection error. Server may be offline.');
    }
  };
}

// Handle Form Submission for Join Game
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = playerNameInput.value || '';
  const trimmed = raw.trim();

  if (!trimmed) {
    showError('Please enter your name before joining.');
    return;
  }
  if (trimmed.length > 16) {
    showError('Name cannot exceed 16 characters.');
    return;
  }

  connectToGame(trimmed);
});

// Send player input loop (30 FPS)
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && localPlayerId) {
    const me = latestState?.players.find(p => p.id === localPlayerId);
    const currentInput = inputManager.poll(me?.x, me?.y);
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
    (window as unknown as { cameraX: number; cameraY: number }).cameraX = renderer.getCameraX();
    (window as unknown as { cameraY: number }).cameraY = renderer.getCameraY();
  }
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
