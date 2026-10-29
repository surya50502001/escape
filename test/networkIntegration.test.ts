import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { server, wss } from '../server/server.js';
import { campaignManager, CampaignManager } from '../server/campaign/campaignManager.js';

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
});
