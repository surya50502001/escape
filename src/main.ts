import { GameState, ServerMessage } from '../server/types.js';
import { ClientCampaignSync } from '../server/campaign/campaignSession.js';
import { GameRenderer } from './renderer.js';
import { InputManager } from './input.js';
import { sound } from './audio.js';

// DOM elements
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const audioBtn = document.getElementById('audioBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const readyBtn = document.getElementById('readyBtn') as HTMLButtonElement | null;
const fullscreenBtn = document.getElementById('fullscreenBtn') as HTMLButtonElement | null;
const roomBadge = document.getElementById('roomBadge') as HTMLDivElement | null;
const roomCodeText = document.getElementById('roomCodeText') as HTMLSpanElement | null;

const joinOverlay = document.getElementById('joinOverlay') as HTMLDivElement;
const joinForm = document.getElementById('joinForm') as HTMLFormElement;
const playerNameInput = document.getElementById('playerNameInput') as HTMLInputElement;
const roomCodeInput = document.getElementById('roomCodeInput') as HTMLInputElement | null;
const joinBtn = document.getElementById('joinBtn') as HTMLButtonElement;
const joinCampaignBtn = document.getElementById('joinCampaignBtn') as HTMLButtonElement | null;
const createCampaignBtn = document.getElementById('createCampaignBtn') as HTMLButtonElement | null;
const joinSurvivalBtn = document.getElementById('joinSurvivalBtn') as HTMLButtonElement | null;
const createRoomBtn = document.getElementById('createRoomBtn') as HTMLButtonElement | null;
const joinError = document.getElementById('joinError') as HTMLDivElement;
const connectingState = document.getElementById('connectingState') as HTMLDivElement;
const connectingText = document.getElementById('connectingText') as HTMLSpanElement;

const renderer = new GameRenderer(canvas);
const inputManager = new InputManager(canvas);

let localPlayerId: string = '';
let localPlayerName: string = '';
let localResumeToken: string = '';
let currentRoomCode: string = '';
let isCampaignMode: boolean = true;
let latestCampaignState: ClientCampaignSync | null = null;
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

// Pre-fill room code from query params or storage
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (roomParam && roomCodeInput) {
  roomCodeInput.value = roomParam.trim().toUpperCase();
} else {
  const savedRoom = sessionStorage.getItem('pit_room_code');
  if (savedRoom && roomCodeInput && savedRoom !== 'default') {
    roomCodeInput.value = savedRoom.toUpperCase();
  }
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
  if (createRoomBtn) createRoomBtn.disabled = false;
  playerNameInput.disabled = false;
  if (roomCodeInput) roomCodeInput.disabled = false;
  joinBtn.textContent = 'RETRY';
  isConnecting = false;
}

function clearError(): void {
  joinError.textContent = '';
  joinError.style.display = 'none';
}

function connectToGame(name: string, roomCode?: string, createRoom?: boolean, mode: 'campaign' | 'survival' = 'campaign'): void {
  if (isConnecting) return;
  isConnecting = true;
  clearError();

  if (joinCampaignBtn) joinCampaignBtn.disabled = true;
  if (createCampaignBtn) createCampaignBtn.disabled = true;
  if (joinSurvivalBtn) joinSurvivalBtn.disabled = true;
  joinBtn.disabled = true;
  if (createRoomBtn) createRoomBtn.disabled = true;
  playerNameInput.disabled = true;
  if (roomCodeInput) roomCodeInput.disabled = true;
  connectingText.textContent = createRoom ? 'CREATING PRIVATE SESSION...' : 'CONNECTING TO SESSION...';
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
    // Send JOIN request with name, mode, stored resumeToken, and room options
    ws?.send(JSON.stringify({
      type: 'JOIN',
      name,
      mode,
      resumeToken: localResumeToken || undefined,
      roomCode: roomCode || undefined,
      createRoom: Boolean(createRoom),
      createCampaign: Boolean(createRoom && mode === 'campaign')
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as any;

      if (data.type === 'WELCOME') {
        localPlayerId = data.playerId;
        localPlayerName = data.name;
        localResumeToken = data.resumeToken;
        currentRoomCode = data.roomCode;
        isCampaignMode = data.mode === 'campaign';

        sessionStorage.setItem('pit_resume_token', data.resumeToken);
        sessionStorage.setItem('pit_player_name', data.name);
        if (data.roomCode) {
          sessionStorage.setItem('pit_room_code', data.roomCode);
          if (roomBadge && roomCodeText) {
            roomBadge.style.display = 'inline-block';
            roomCodeText.textContent = data.roomCode.toUpperCase();
          }
          if (data.roomCode !== 'default') {
            const url = new URL(window.location.href);
            url.searchParams.set('room', data.roomCode);
            window.history.replaceState({}, '', url.toString());
          }
        }

        isConnecting = false;
        joinOverlay.classList.add('hidden');
        statusDiv.textContent = isCampaignMode ? `PRISONER: ${localPlayerName} (CO-OP CAMPAIGN)` : `PRISONER: ${localPlayerName}`;
        statusDiv.style.color = '#22d3ee';
        sound.init();

      } else if (data.type === 'ERROR') {
        isConnecting = false;
        if (data.code === 'ROOM_FULL') {
          showError('Room is full. Try again later.');
        } else if (data.code === 'ROOM_NOT_FOUND') {
          showError(data.message || 'Room code not found.');
        } else {
          showError(data.message || 'Failed to join chamber.');
        }
        ws?.close();

      } else if (data.type === 'SYNC') {
        if (data.mode === 'campaign' && data.campaign) {
          isCampaignMode = true;
          latestCampaignState = data.campaign;

          statusDiv.textContent = `PRISONER: ${localPlayerName} (ROOM ${data.campaign.roomId}/10 — ${data.campaign.roomName.toUpperCase()})`;
          statusDiv.style.color = '#38bdf8';

          const me = latestCampaignState?.players.find(p => p.id === localPlayerId);
          if (me) {
            (window as unknown as { localPlayerX: number; localPlayerY: number; isRopeAttachedToMe: boolean }).localPlayerX = me.x;
            (window as unknown as { localPlayerY: number; isRopeAttachedToMe: boolean }).localPlayerY = me.y;
          }
        } else if (data.state) {
          isCampaignMode = false;
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
            connectToGame(localPlayerName, currentRoomCode || undefined, false, isCampaignMode ? 'campaign' : 'survival');
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

// Button Click: Start Campaign (10 Rooms)
if (joinCampaignBtn) {
  joinCampaignBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const rawName = playerNameInput.value || '';
    const trimmedName = rawName.trim();
    const rawRoom = roomCodeInput ? roomCodeInput.value.trim().toUpperCase() : '';

    if (!trimmedName) {
      showError('Please enter your prisoner name first.');
      return;
    }
    if (trimmedName.length > 16) {
      showError('Name cannot exceed 16 characters.');
      return;
    }

    connectToGame(trimmedName, rawRoom || undefined, false, 'campaign');
  });
}

// Button Click: New Private Campaign
if (createCampaignBtn) {
  createCampaignBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const rawName = playerNameInput.value || '';
    const trimmedName = rawName.trim();

    if (!trimmedName) {
      showError('Please enter your prisoner name first.');
      return;
    }
    if (trimmedName.length > 16) {
      showError('Name cannot exceed 16 characters.');
      return;
    }

    localResumeToken = '';
    sessionStorage.removeItem('pit_resume_token');
    connectToGame(trimmedName, undefined, true, 'campaign');
  });
}

// Button Click: Legacy Survival Mode
if (joinSurvivalBtn) {
  joinSurvivalBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const rawName = playerNameInput.value || '';
    const trimmedName = rawName.trim();
    const rawRoom = roomCodeInput ? roomCodeInput.value.trim().toUpperCase() : '';

    if (!trimmedName) {
      showError('Please enter your prisoner name first.');
      return;
    }
    if (trimmedName.length > 16) {
      showError('Name cannot exceed 16 characters.');
      return;
    }

    connectToGame(trimmedName, rawRoom || undefined, false, 'survival');
  });
}

// Handle Form Submission for Join Game (Enter Key)
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const rawName = playerNameInput.value || '';
  const trimmedName = rawName.trim();
  const rawRoom = roomCodeInput ? roomCodeInput.value.trim().toUpperCase() : '';

  if (!trimmedName) {
    showError('Please enter your name before joining.');
    return;
  }
  if (trimmedName.length > 16) {
    showError('Name cannot exceed 16 characters.');
    return;
  }

  // If code starts with CAMP- or empty, default to campaign mode
  const mode = (rawRoom && !rawRoom.startsWith('CAMP-') && rawRoom !== 'DEFAULT') ? 'survival' : 'campaign';
  connectToGame(trimmedName, rawRoom || undefined, false, mode);
});

// Handle "New Private Room" Button Click (Survival)
if (createRoomBtn) {
  createRoomBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const rawName = playerNameInput.value || '';
    const trimmedName = rawName.trim();

    if (!trimmedName) {
      showError('Please enter your prisoner name first.');
      return;
    }
    if (trimmedName.length > 16) {
      showError('Name cannot exceed 16 characters.');
      return;
    }

    localResumeToken = '';
    sessionStorage.removeItem('pit_resume_token');
    connectToGame(trimmedName, undefined, true, 'survival');
  });
}

// Handle Room Code Badge Click to Copy Invite Link
if (roomBadge) {
  roomBadge.addEventListener('click', () => {
    if (currentRoomCode && currentRoomCode !== 'default') {
      const url = new URL(window.location.href);
      url.searchParams.set('room', currentRoomCode);
      navigator.clipboard.writeText(url.toString()).then(() => {
        const origText = roomBadge.innerHTML;
        roomBadge.innerHTML = 'COPIED LINK! ✔';
        setTimeout(() => {
          roomBadge.innerHTML = origText;
        }, 1500);
      }).catch(() => {});
    }
  });
}

// Send player input loop (30 FPS)
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && localPlayerId) {
    const me = isCampaignMode
      ? latestCampaignState?.players.find(p => p.id === localPlayerId)
      : latestState?.players.find(p => p.id === localPlayerId);

    const currentInput = inputManager.poll(me?.x, me?.y);
    ws.send(JSON.stringify({
      type: 'INPUT',
      input: currentInput
    }));
  }
}, 1000 / 30);

// Render loop (60 FPS)
function gameLoop() {
  if (isCampaignMode && latestCampaignState) {
    renderer.renderCampaign(latestCampaignState, localPlayerId);
    (window as unknown as { cameraX: number; cameraY: number }).cameraX = renderer.getCameraX();
    (window as unknown as { cameraY: number }).cameraY = renderer.getCameraY();
  } else if (latestState) {
    renderer.render(latestState, localPlayerId);
    (window as unknown as { cameraX: number; cameraY: number }).cameraX = renderer.getCameraX();
    (window as unknown as { cameraY: number }).cameraY = renderer.getCameraY();
  }
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
