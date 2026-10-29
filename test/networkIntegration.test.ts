import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { server, wss } from '../server/server.js';
import { campaignManager, CampaignManager } from '../server/campaign/campaignManager.js';
import { resolveWebSocketUrl } from '../src/networkConfig.js';

describe('Network Integration: Real WebSocket Disconnect, Grace Period & Reconnection', () => {
  let port: number;
  let wsUrl: string;

  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        wsUrl = `ws://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => {
      wss.close(() => {
        server.close(() => {
          resolve();
        });
      });
    });
  });

  function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs: number = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout after ${timeoutMs}ms waiting for WebSocket message`));
      }, timeoutMs);

      function onMsg(raw: any) {
        try {
          const parsed = JSON.parse(raw.toString());
          if (predicate(parsed)) {
            cleanup();
            resolve(parsed);
          }
        } catch {
          // Ignore parse errors for irrelevant frames
        }
      }

      function cleanup() {
        clearTimeout(timer);
        ws.off('message', onMsg);
      }

      ws.on('message', onMsg);
    });
  }

  it('NET-01: Real WebSocket disconnect preserves private campaign during grace period and reconnects to active room', async () => {
    const ws1 = new WebSocket(wsUrl);

    await new Promise((resolve) => ws1.once('open', resolve));

    // 1. Join and create a new private campaign
    ws1.send(JSON.stringify({
      type: 'JOIN',
      name: 'Alice',
      mode: 'campaign',
      createCampaign: true
    }));

    const welcome1 = await waitForMessage(ws1, (m) => m.type === 'WELCOME');
    assert.equal(welcome1.mode, 'campaign');
    assert.equal(welcome1.name, 'Alice');
    assert.ok(welcome1.resumeToken, 'Must provide resumeToken');
    assert.ok(welcome1.roomCode.startsWith('CAMP-'), 'Must provide CAMP- code');
    assert.equal(welcome1.roomId, 1, 'Initial room must be Room 1');

    const roomCode = welcome1.roomCode;
    const resumeToken = welcome1.resumeToken;
    const playerId = welcome1.playerId;

    // 2. Advance Alice to Room 2
    const camp = campaignManager.getCampaign(roomCode);
    assert.ok(camp, 'Campaign session must exist in manager');
    camp.intro.skip();
    const r1 = camp.getOrCreateRoomRuntime(1);
    const exitDoor = r1.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    const p = r1.getPlayer(playerId)!;
    p.x = exitDoor.rect.x + 10;
    p.y = exitDoor.rect.y + 10;
    assert.equal(camp.transitionPlayer(playerId, 2), true);
    assert.equal(camp.getPlayerRoomId(playerId), 2);

    // 3. Alice disconnects (socket closes)
    await new Promise<void>((resolve) => {
      ws1.once('close', () => resolve());
      ws1.close();
    });

    // Wait a brief tick for server handleClientDisconnect
    await new Promise((r) => setTimeout(r, 50));

    // Campaign has 0 active connected players
    assert.equal(camp.players.size, 0);
    assert.ok(camp.emptySince !== null, 'emptySince timestamp must be set');

    // 4. Run periodic cleanup sweeps during the 5-minute grace period (e.g. at now + 15s)
    campaignManager.cleanExpiredCampaigns(Date.now() + 15_000);
    assert.ok(campaignManager.getCampaign(roomCode), 'Campaign must NOT be deleted during grace period');

    // 5. Alice reconnects using a brand new WebSocket connection with saved resumeToken
    const ws2 = new WebSocket(wsUrl);
    await new Promise((resolve) => ws2.once('open', resolve));

    ws2.send(JSON.stringify({
      type: 'JOIN',
      name: 'Alice',
      mode: 'campaign',
      roomCode: roomCode,
      resumeToken: resumeToken
    }));

    const welcome2 = await waitForMessage(ws2, (m) => m.type === 'WELCOME');
    assert.equal(welcome2.mode, 'campaign');
    assert.equal(welcome2.playerId, playerId, 'Player ID must be preserved');
    assert.equal(welcome2.roomCode, roomCode, 'Room code must match');
    assert.equal(welcome2.roomId, 2, 'Player must be restored directly to Room 2');

    // Verify campaign is active again and emptySince reset
    assert.equal(camp.players.size, 1);
    assert.equal(camp.emptySince, null, 'emptySince must be cleared when player rejoins');

    // 6. Test Expiry: Alice disconnects again, and we simulate time past the 5-minute grace period
    await new Promise<void>((resolve) => {
      ws2.once('close', () => resolve());
      ws2.close();
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(camp.players.size, 0);

    // Simulate cleanup past the 5-minute grace period (300,001 ms)
    campaignManager.cleanExpiredCampaigns(Date.now() + CampaignManager.CAMPAIGN_EXPIRY_GRACE_MS + 1000);
    assert.equal(campaignManager.getCampaign(roomCode), undefined, 'Campaign must be purged after grace period expires');
    assert.equal(campaignManager.findCampaignByToken(resumeToken), undefined, 'Token associations must be cleaned up');
  });

  it('NET-02: Real WebSocket enforces 5-player maximum capacity in campaign mode', async () => {
    // 1. Create a private campaign with Player 1
    const sockets: WebSocket[] = [];

    const ws1 = new WebSocket(wsUrl);
    sockets.push(ws1);
    await new Promise((r) => ws1.once('open', r));

    ws1.send(JSON.stringify({
      type: 'JOIN',
      name: 'Prisoner1',
      mode: 'campaign',
      createCampaign: true
    }));

    const welcome1 = await waitForMessage(ws1, (m) => m.type === 'WELCOME');
    const roomCode = welcome1.roomCode;
    const token1 = welcome1.resumeToken;

    // 2. Connect Players 2, 3, 4, 5
    for (let i = 2; i <= 5; i++) {
      const ws = new WebSocket(wsUrl);
      sockets.push(ws);
      await new Promise((r) => ws.once('open', r));

      ws.send(JSON.stringify({
        type: 'JOIN',
        name: `Prisoner${i}`,
        mode: 'campaign',
        roomCode: roomCode
      }));

      const welcome = await waitForMessage(ws, (m) => m.type === 'WELCOME');
      assert.equal(welcome.mode, 'campaign');
      assert.equal(welcome.roomCode, roomCode);
    }

    const camp = campaignManager.getCampaign(roomCode)!;
    assert.equal(camp.players.size, 5, 'Must have exactly 5 players joined');

    // 3. Player 6 attempts to join -> must be rejected with ROOM_FULL
    const ws6 = new WebSocket(wsUrl);
    sockets.push(ws6);
    await new Promise((r) => ws6.once('open', r));

    ws6.send(JSON.stringify({
      type: 'JOIN',
      name: 'Prisoner6',
      mode: 'campaign',
      roomCode: roomCode
    }));

    const error6 = await waitForMessage(ws6, (m) => m.type === 'ERROR');
    assert.equal(error6.code, 'ROOM_FULL', '6th player must be rejected with ROOM_FULL');
    assert.ok(error6.message.includes('5 prisoners'), 'Message specifies 5 prisoners');

    // 4. Reconnect test: Player 1 disconnects and reconnects with token1 -> should succeed
    await new Promise<void>((resolve) => {
      ws1.once('close', () => resolve());
      ws1.close();
    });
    await new Promise((r) => setTimeout(r, 50));

    const ws1Reconnect = new WebSocket(wsUrl);
    sockets.push(ws1Reconnect);
    await new Promise((r) => ws1Reconnect.once('open', r));

    ws1Reconnect.send(JSON.stringify({
      type: 'JOIN',
      name: 'Prisoner1',
      mode: 'campaign',
      roomCode: roomCode,
      resumeToken: token1
    }));

    const welcome1Reconnected = await waitForMessage(ws1Reconnect, (m) => m.type === 'WELCOME');
    assert.equal(welcome1Reconnected.playerId, welcome1.playerId, 'Reconnecting player rejoins slot');

    // Clean up open test sockets
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
  });

  it('NET-03: Real WebSocket unified rate limiting and 4KB message payload size validation with observable server rejection', async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.once('open', r));

    // 1. Join campaign
    ws.send(JSON.stringify({
      type: 'JOIN',
      name: 'RateTester',
      mode: 'campaign',
      createCampaign: true
    }));
    const welcome = await waitForMessage(ws, (m) => m.type === 'WELCOME');
    assert.equal(welcome.name, 'RateTester');
    const camp = campaignManager.getCampaign(welcome.roomCode)!;
    // Skip intro so Room 1 input is unlocked for gameplay
    camp.intro.skip();
    const player = camp.players.get(welcome.playerId)!;
    assert.ok(player, 'Player must exist in campaign');
    assert.equal(player.angle, 0, 'Initial angle must be 0');

    // 2. Oversized payload (> 4096 bytes) should be dropped silently by server (no angle update)
    const oversized = JSON.stringify({
      type: 'INPUT',
      input: {
        up: false, down: false, left: false, right: false,
        jump: false, interact: false, tackle: false, pull: false, struggle: false,
        aimAngle: 9.99,
        blob: 'A'.repeat(5000)
      }
    });
    assert.ok(oversized.length > 4096, 'Oversized payload exceeds 4096 bytes');
    ws.send(oversized);
    await new Promise((r) => setTimeout(r, 40));
    camp.update();
    assert.equal(player.angle, 0, 'Oversized payload must be dropped by server without updating angle');

    // 3. Send 59 valid messages within current second window with aimAngle = 1.25
    // Note: JOIN was msg 1, oversized payload was dropped before rate counter, so 59 inputs reaches the 60 msg threshold
    for (let i = 0; i < 59; i++) {
      ws.send(JSON.stringify({
        type: 'INPUT',
        input: {
          up: false, down: false, left: false, right: false,
          jump: false, interact: false, tackle: false, pull: false, struggle: false,
          aimAngle: 1.25
        }
      }));
    }
    await new Promise((r) => setTimeout(r, 60));
    camp.update();
    assert.equal(player.angle, 1.25, 'Valid messages within rate limit must be processed by server');

    // 4. Send excessive messages (exceeding 60 msgs/s) with aimAngle = 2.50
    // Sockets exceeding 60 per sec must have messages dropped
    for (let i = 0; i < 20; i++) {
      ws.send(JSON.stringify({
        type: 'INPUT',
        input: {
          up: false, down: false, left: false, right: false,
          jump: false, interact: false, tackle: false, pull: false, struggle: false,
          aimAngle: 2.50
        }
      }));
    }
    await new Promise((r) => setTimeout(r, 60));
    camp.update();
    // Angle must NOT be 2.50 because rate limit dropped the excessive messages
    assert.equal(player.angle, 1.25, 'Messages beyond 60/sec threshold must be dropped by server');

    // 5. Wait for rate limit window (1000ms) to reset
    await new Promise((r) => setTimeout(r, 1100));

    // Send a new input with aimAngle = 2.50 after reset
    ws.send(JSON.stringify({
      type: 'INPUT',
      input: {
        up: false, down: false, left: false, right: false,
        jump: false, interact: false, tackle: false, pull: false, struggle: false,
        aimAngle: 2.50
      }
    }));
    await new Promise((r) => setTimeout(r, 50));
    camp.update();
    assert.equal(player.angle, 2.50, 'Rate limit resets after 1000ms, accepting valid input again');

    ws.close();
  });

  it('NET-04: Authoritative socket ownership supersedes old socket and stale disconnect is ignored', async () => {
    // 1. Connect on socket 1
    const ws1 = new WebSocket(wsUrl);
    await new Promise((r) => ws1.once('open', r));

    ws1.send(JSON.stringify({
      type: 'JOIN',
      name: 'StaleTester',
      mode: 'campaign',
      createCampaign: true
    }));

    const welcome1 = await waitForMessage(ws1, (m) => m.type === 'WELCOME');
    const roomCode = welcome1.roomCode;
    const resumeToken = welcome1.resumeToken;
    const playerId = welcome1.playerId;
    const camp = campaignManager.getCampaign(roomCode)!;

    assert.equal(camp.players.size, 1);
    const serverWs1 = campaignManager.getPlayerSocket(playerId)!;
    assert.ok(serverWs1, 'Server socket 1 must be registered');

    // Track if ws1 receives close frame
    let ws1ClosedByServer = false;
    ws1.on('close', (code, reason) => {
      ws1ClosedByServer = true;
    });

    // 2. Connect on socket 2 using same resumeToken while socket 1 is still open
    const ws2 = new WebSocket(wsUrl);
    await new Promise((r) => ws2.once('open', r));

    ws2.send(JSON.stringify({
      type: 'JOIN',
      name: 'StaleTester',
      mode: 'campaign',
      roomCode: roomCode,
      resumeToken: resumeToken
    }));

    const welcome2 = await waitForMessage(ws2, (m) => m.type === 'WELCOME');
    assert.equal(welcome2.playerId, playerId, 'Session preserved across new socket');

    // Socket 2 is now authoritative server socket
    const serverWs2 = campaignManager.getPlayerSocket(playerId)!;
    assert.ok(serverWs2, 'Server socket 2 must be registered');
    assert.notEqual(serverWs1, serverWs2, 'Server socket 2 must replace server socket 1');

    // Wait for server to have closed ws1
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(ws1ClosedByServer, true, 'Old socket must be closed by server with code 1000');

    // 3. Stale socket disconnect protection:
    // Even after ws1's close event has completed, ws2 and the player MUST remain active!
    assert.equal(camp.players.size, 1, 'Player must remain active in campaign');
    assert.ok(camp.players.has(playerId), 'Player ID must still exist in campaign');

    // Send input from authoritative socket 2
    ws2.send(JSON.stringify({
      type: 'INPUT',
      input: {
        up: false, down: false, left: false, right: true,
        jump: false, interact: false, tackle: false, pull: false, struggle: false,
        angle: 0
      }
    }));

    camp.update();
    const p = camp.players.get(playerId)!;
    assert.ok(p, 'Player must exist and process inputs from authoritative socket');

    ws2.close();
  });

  it('NET-05: Sanitizes unknown resume tokens and generates cryptographically secure UUID', async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.once('open', r));

    // Client sends an arbitrary forged resume token
    const spoofedToken = 'malicious_spoofed_token_0xDEADBEEF';
    ws.send(JSON.stringify({
      type: 'JOIN',
      name: 'TokenAudit',
      mode: 'campaign',
      createCampaign: true,
      resumeToken: spoofedToken
    }));

    const welcome = await waitForMessage(ws, (m) => m.type === 'WELCOME');
    // Must reject spoofed token and issue genuine UUID
    assert.notEqual(welcome.resumeToken, spoofedToken, 'Server must never accept unverified client-supplied token');
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.match(welcome.resumeToken, uuidRegex, 'Server must assign freshly generated UUID v4 token');

    ws.close();
  });

  it('NET-06: Authoritative platform surface snapping on item drop and disconnect', () => {
    const camp = campaignManager.createCampaign();
    camp.intro.skip();

    // 1. Room 10 Platform C snapping test:
    // Platform C rect in tiles is [26, 13, 44, 14] -> pixel Y = (20 - 14)*32 = 192.
    // X span in px is [26*32, 44*32] = [832, 1408]. Floor is 544.
    const r10 = camp.getOrCreateRoomRuntime(10);
    const p1 = {
      id: 'p_drop_1',
      name: 'Cutter',
      isBot: false,
      x: 1000,
      y: 192,
      vx: 0,
      vy: 0,
      facing: 'RIGHT' as const,
      angle: 0,
      color: '#3498db',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR' as const,
      isGrounded: true,
      stunnedTimer: 0,
      tackleCooldown: 0,
      attackCooldown: 0,
      rocks: 0,
      hasEscaped: false,
      sabotages: 0,
      climbKickTimer: 0,
      climbAttackCooldown: 0,
      climbGrabbingId: null,
      grabbedByPlayerId: null,
      struggleMeter: 0,
      hazardCooldown: 0,
      carryingLadderId: null
    };

    camp.addPlayer(p1, 10);
    p1.x = 1000;
    p1.y = 192;

    const cuttingTool = {
      id: 'cutting_tool',
      type: 'cutting_tool',
      x: 1000,
      y: 192,
      roomId: 10,
      carriedByPlayerId: p1.id
    };
    camp.playerItems.set(p1.id, cuttingTool);

    // Player explicitly drops item while on Platform C
    assert.equal(camp.dropItem(p1.id), true);
    const groundItem = r10.groundItems.get('cutting_tool')!;
    assert.ok(groundItem, 'Item must be on ground in room 10');
    assert.equal(groundItem.y, 192, 'Item must snap to Platform C surface at y=192, not floor y=544');

    // 2. Room 1 Upper Walkway snapping on player disconnect:
    // Upper walkway rect in tiles [36, 7, 50, 8] -> pixel Y = (20 - 8)*32 = 384.
    // X span in px is [1152, 1600].
    const r1 = camp.getOrCreateRoomRuntime(1);
    const p2 = {
      id: 'p_drop_2',
      name: 'Walker',
      isBot: false,
      x: 1250,
      y: 384,
      vx: 0,
      vy: 0,
      facing: 'RIGHT' as const,
      angle: 0,
      color: '#e74c3c',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR' as const,
      isGrounded: true,
      stunnedTimer: 0,
      tackleCooldown: 0,
      attackCooldown: 0,
      rocks: 0,
      hasEscaped: false,
      sabotages: 0,
      climbKickTimer: 0,
      climbAttackCooldown: 0,
      climbGrabbingId: null,
      grabbedByPlayerId: null,
      struggleMeter: 0,
      hazardCooldown: 0,
      carryingLadderId: null
    };

    camp.addPlayer(p2, 1);
    p2.x = 1250;
    p2.y = 384;

    const keyItem = {
      id: 'brass_key',
      type: 'key',
      x: 1250,
      y: 384,
      roomId: 1,
      carriedByPlayerId: p2.id
    };
    camp.playerItems.set(p2.id, keyItem);

    // Player unexpectedly disconnects while standing on upper walkway
    camp.handlePlayerDisconnect(p2.id);
    const droppedKey = r1.groundItems.get('brass_key')!;
    assert.ok(droppedKey, 'Item must drop on player disconnect');
    assert.equal(droppedKey.y, 384, 'Dropped item must land on upper walkway at y=384, not room floor');
  });

  it('NET-07: WebSocket URL resolution supports Vite dev proxy, production direct, and env overrides', () => {
    // 1. Vite dev on localhost:5173 -> proxies via /ws on same host
    const viteDevUrl = resolveWebSocketUrl({
      protocol: 'http:',
      hostname: 'localhost',
      port: '5173',
      host: 'localhost:5173'
    }, {});
    assert.equal(viteDevUrl, 'ws://localhost:5173/ws');

    // 2. Vite dev on LAN 192.168.1.50:5173 -> proxies via /ws on same LAN host
    const lanDevUrl = resolveWebSocketUrl({
      protocol: 'http:',
      hostname: '192.168.1.50',
      port: '5173',
      host: '192.168.1.50:5173'
    }, {});
    assert.equal(lanDevUrl, 'ws://192.168.1.50:5173/ws');

    // 3. Direct production on port 3001
    const prodDirectUrl = resolveWebSocketUrl({
      protocol: 'http:',
      hostname: '192.168.1.50',
      port: '3001',
      host: '192.168.1.50:3001'
    }, {});
    assert.equal(prodDirectUrl, 'ws://192.168.1.50:3001');

    // 4. Production HTTPS deployment with custom / empty port
    const prodHttpsUrl = resolveWebSocketUrl({
      protocol: 'https:',
      hostname: 'thepit.example.com',
      port: '',
      host: 'thepit.example.com'
    }, {});
    assert.equal(prodHttpsUrl, 'wss://thepit.example.com:3001');

    // 5. Explicit VITE_WS_URL override
    const overrideUrl = resolveWebSocketUrl({
      protocol: 'http:',
      hostname: 'localhost',
      port: '5173',
      host: 'localhost:5173'
    }, { VITE_WS_URL: 'wss://custom.socket.server/live' });
    assert.equal(overrideUrl, 'wss://custom.socket.server/live');

    // 6. Explicit VITE_WS_PORT override
    const portOverrideUrl = resolveWebSocketUrl({
      protocol: 'http:',
      hostname: 'localhost',
      port: '5173',
      host: 'localhost:5173'
    }, { VITE_WS_PORT: '4000' });
    assert.equal(portOverrideUrl, 'ws://localhost:4000');
  });

  it('NET-08: Simultaneous JOIN requests with the same resume token safely resolves authoritative socket', async () => {
    // 1. Join campaign and get token
    const ws1 = new WebSocket(wsUrl);
    await new Promise((r) => ws1.once('open', r));

    ws1.send(JSON.stringify({
      type: 'JOIN',
      name: 'SimultaneousUser',
      mode: 'campaign',
      createCampaign: true
    }));
    const welcome1 = await waitForMessage(ws1, (m) => m.type === 'WELCOME');
    const token = welcome1.resumeToken;
    const roomCode = welcome1.roomCode;
    const playerId = welcome1.playerId;

    // 2. Open two sockets nearly simultaneously with the same token
    const ws2A = new WebSocket(wsUrl);
    const ws2B = new WebSocket(wsUrl);

    await Promise.all([
      new Promise((r) => ws2A.once('open', r)),
      new Promise((r) => ws2B.once('open', r))
    ]);

    let ws2AClosed = false;
    let ws2BClosed = false;
    ws2A.on('close', () => { ws2AClosed = true; });
    ws2B.on('close', () => { ws2BClosed = true; });

    // Send JOINs
    ws2A.send(JSON.stringify({ type: 'JOIN', name: 'SimultaneousUser', mode: 'campaign', roomCode, resumeToken: token }));
    ws2B.send(JSON.stringify({ type: 'JOIN', name: 'SimultaneousUser', mode: 'campaign', roomCode, resumeToken: token }));

    // Wait for processing
    await new Promise((r) => setTimeout(r, 120));

    const camp = campaignManager.getCampaign(roomCode)!;
    // Exactly one player in campaign — no duplication!
    assert.equal(camp.players.size, 1);
    assert.ok(camp.players.has(playerId));

    // Exactly one of the two sockets is authoritative
    const activeServerWs = campaignManager.getPlayerSocket(playerId);
    assert.ok(activeServerWs, 'Authoritative server socket must be recorded');

    // Clean up
    if (ws1.readyState === WebSocket.OPEN) ws1.close();
    if (ws2A.readyState === WebSocket.OPEN) ws2A.close();
    if (ws2B.readyState === WebSocket.OPEN) ws2B.close();
  });

  it('NET-09: Repeated sequential reconnects preserve player identity and state across 5 hops', async () => {
    let currentWs = new WebSocket(wsUrl);
    await new Promise((r) => currentWs.once('open', r));

    currentWs.send(JSON.stringify({
      type: 'JOIN',
      name: 'HopUser',
      mode: 'campaign',
      createCampaign: true
    }));
    const welcome = await waitForMessage(currentWs, (m) => m.type === 'WELCOME');
    const token = welcome.resumeToken;
    const roomCode = welcome.roomCode;
    const playerId = welcome.playerId;
    const camp = campaignManager.getCampaign(roomCode)!;

    // Move player and pick up item
    const r1 = camp.getOrCreateRoomRuntime(1);
    const player = camp.players.get(playerId)!;
    player.x = 250;
    player.angle = 1.0;

    for (let hop = 2; hop <= 5; hop++) {
      const nextWs = new WebSocket(wsUrl);
      await new Promise((r) => nextWs.once('open', r));

      nextWs.send(JSON.stringify({
        type: 'JOIN',
        name: 'HopUser',
        mode: 'campaign',
        roomCode,
        resumeToken: token
      }));

      const hopWelcome = await waitForMessage(nextWs, (m) => m.type === 'WELCOME');
      assert.equal(hopWelcome.playerId, playerId, `Hop ${hop} must preserve playerId`);
      assert.equal(camp.players.size, 1, `Hop ${hop} must not duplicate player records`);
      assert.equal(player.x, 250, `Hop ${hop} must preserve player position`);

      await new Promise((r) => setTimeout(r, 40));
      currentWs = nextWs;
    }

    if (currentWs.readyState === WebSocket.OPEN) currentWs.close();
  });

  it('NET-10: Reconnecting player permitted when campaign is at 5/5 full capacity', async () => {
    const sockets: WebSocket[] = [];
    const ws1 = new WebSocket(wsUrl);
    sockets.push(ws1);
    await new Promise((r) => ws1.once('open', r));

    ws1.send(JSON.stringify({
      type: 'JOIN',
      name: 'Team1',
      mode: 'campaign',
      createCampaign: true
    }));
    const w1 = await waitForMessage(ws1, (m) => m.type === 'WELCOME');
    const roomCode = w1.roomCode;
    const token1 = w1.resumeToken;

    // Join 4 more players
    for (let i = 2; i <= 5; i++) {
      const ws = new WebSocket(wsUrl);
      sockets.push(ws);
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({
        type: 'JOIN',
        name: `Team${i}`,
        mode: 'campaign',
        roomCode
      }));
      await waitForMessage(ws, (m) => m.type === 'WELCOME');
    }

    const camp = campaignManager.getCampaign(roomCode)!;
    assert.equal(camp.players.size, 5, 'Campaign must be at 5/5 full capacity');

    // Player 1 reconnects from a new socket while campaign is at 5/5
    const ws1Reconnect = new WebSocket(wsUrl);
    sockets.push(ws1Reconnect);
    await new Promise((r) => ws1Reconnect.once('open', r));

    ws1Reconnect.send(JSON.stringify({
      type: 'JOIN',
      name: 'Team1',
      mode: 'campaign',
      roomCode,
      resumeToken: token1
    }));

    const wReconnect = await waitForMessage(ws1Reconnect, (m) => m.type === 'WELCOME');
    assert.equal(wReconnect.playerId, w1.playerId, 'Must allow reconnecting existing player even when room is full');
    assert.equal(camp.players.size, 5, 'Must remain at exactly 5 players without exceeding cap');

    for (const s of sockets) {
      if (s.readyState === WebSocket.OPEN) s.close();
    }
  });

  it('NET-11: Campaign expiry boundaries: before (299s), at (300s), and after (301s)', () => {
    const camp = campaignManager.createCampaign();
    const code = camp.id;
    assert.ok(campaignManager.getCampaign(code));

    // Add player and disconnect to trigger empty state
    const p = {
      id: 'p_exp',
      name: 'Exp',
      isBot: false,
      x: 100,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT' as const,
      angle: 0,
      color: '#3498db',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR' as const,
      isGrounded: true,
      stunnedTimer: 0,
      tackleCooldown: 0,
      attackCooldown: 0,
      rocks: 0,
      hasEscaped: false,
      sabotages: 0,
      climbKickTimer: 0,
      climbAttackCooldown: 0,
      climbGrabbingId: null,
      grabbedByPlayerId: null,
      struggleMeter: 0,
      hazardCooldown: 0,
      carryingLadderId: null
    };

    camp.addPlayer(p, 1, 'token_exp_test');
    campaignManager.associateTokenWithCampaign('token_exp_test', code);

    // Disconnect
    const disconnectTime = 1_000_000;
    camp.handlePlayerDisconnect(p.id);
    camp.emptySince = disconnectTime;

    // Boundary 1: at 299s (before 5 minutes grace period of 300s)
    campaignManager.cleanExpiredCampaigns(disconnectTime + 299_000);
    assert.ok(campaignManager.getCampaign(code), 'Campaign must NOT be deleted before 300s');

    // Reconnecting resets emptySince
    camp.addPlayer(p, 1, 'token_exp_test');
    assert.equal(camp.emptySince, null, 'Reconnecting player resets emptySince');

    // Disconnect again
    camp.handlePlayerDisconnect(p.id);
    camp.emptySince = disconnectTime;

    // Boundary 2 & 3: at 300s and after (300s + 1ms)
    campaignManager.cleanExpiredCampaigns(disconnectTime + CampaignManager.CAMPAIGN_EXPIRY_GRACE_MS);
    assert.equal(campaignManager.getCampaign(code), undefined, 'Campaign must be purged at >= 300s');
    assert.equal(campaignManager.findCampaignByToken('token_exp_test'), undefined, 'Token associations must be purged');

    // Public campaign CAMP-PUBLIC is permanent and never purged
    const publicCamp = campaignManager.getDefaultCampaign();
    publicCamp.emptySince = disconnectTime;
    campaignManager.cleanExpiredCampaigns(disconnectTime + 10_000_000);
    assert.ok(campaignManager.getCampaign('CAMP-PUBLIC'), 'CAMP-PUBLIC must never be deleted');
  });

  it('NET-12: Comprehensive platform surface snapping: platform tops, overlapping stacked platforms, wall edges, below platforms, floor drops, and boundary clamping', () => {
    const camp = campaignManager.createCampaign();
    camp.intro.skip();
    const r10 = camp.getOrCreateRoomRuntime(10);

    // 1. Platform C top surface (Room 10 Platform C [26, 13, 44, 14] -> pixel Y = 192, X span [832, 1408])
    const item1 = { id: 'item_top', type: 'tool', x: 1000, y: 192, roomId: 10, carriedByPlayerId: null };
    r10.dropItem(item1, 1000, 192);
    assert.equal(item1.y, 192, 'Item dropped on platform top must snap to y=192');

    // 2. Jumping above platform (y=150 above Platform C at y=192)
    const item2 = { id: 'item_air', type: 'tool', x: 1000, y: 150, roomId: 10, carriedByPlayerId: null };
    r10.dropItem(item2, 1000, 150);
    assert.equal(item2.y, 192, 'Item dropped in air above platform must snap to platform top');

    // 3. Vertically stacked platforms (below Platform C y=192, above Platform B y=320)
    // Dropping at y=250 snaps to intermediate Platform B (y=320), NOT up to Platform C (y=192)
    const itemStacked = { id: 'item_stacked', type: 'tool', x: 1000, y: 250, roomId: 10, carriedByPlayerId: null };
    r10.dropItem(itemStacked, 1000, 250);
    assert.equal(itemStacked.y, 320, 'Item dropped below Platform C must snap to intermediate Platform B at y=320');

    // 4. Below lowest platform (player at y=350 below Platform B at y=320)
    // Must NOT snap up to 320 or 192; must fall to floor y=544
    const itemBelow = { id: 'item_below', type: 'tool', x: 1000, y: 350, roomId: 10, carriedByPlayerId: null };
    r10.dropItem(itemBelow, 1000, 350);
    assert.equal(itemBelow.y, 544, 'Item dropped below lowest platform must fall to floor');

    // 4. Wall edge horizontal boundary:
    // Platform C right edge is 1408 px
    const itemInsideEdge = { id: 'item_edge_in', type: 'tool', x: 1400, y: 192, roomId: 10, carriedByPlayerId: null };
    r10.dropItem(itemInsideEdge, 1400, 192);
    assert.equal(itemInsideEdge.y, 192, 'Item dropped inside platform edge must snap to platform');

    const itemOutsideEdge = { id: 'item_edge_out', type: 'tool', x: 1450, y: 192, roomId: 10, carriedByPlayerId: null };
    r10.dropItem(itemOutsideEdge, 1450, 192);
    assert.equal(itemOutsideEdge.y, 544, 'Item dropped beyond platform edge must fall past platform to floor');

    // 5. Overlapping stacked platforms in Room 2:
    // mid_platform surface y=416, upper_ledge surface y=352
    const r2 = camp.getOrCreateRoomRuntime(2);
    const itemMid = { id: 'item_mid', type: 'tool', x: 800, y: 416, roomId: 2, carriedByPlayerId: null };
    r2.dropItem(itemMid, 800, 416);
    assert.equal(itemMid.y, 416, 'Item on mid_platform must land at y=416');

    // 6. Horizontal room boundary clamping:
    // Room width is 1600 px. Drops at negative X or excessive X must clamp to playable bounds
    const itemClampLeft = { id: 'item_clamp_l', type: 'tool', x: -50, y: 544, roomId: 10, carriedByPlayerId: null };
    r10.dropItem(itemClampLeft, -50, 544);
    assert.equal(itemClampLeft.x, 32, 'Item dropped at negative X must clamp to left room boundary');

    const itemClampRight = { id: 'item_clamp_r', type: 'tool', x: 2000, y: 544, roomId: 10, carriedByPlayerId: null };
    r10.dropItem(itemClampRight, 2000, 544);
    assert.equal(itemClampRight.x, r10.loadedRoom.widthPx - 32, 'Item dropped past room width must clamp to right boundary');
  });
});
