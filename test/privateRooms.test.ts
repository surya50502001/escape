import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RoomManager, MatchRoom } from '../server/rooms.js';
import { MAX_PLAYERS } from '../server/types.js';

describe('Private Rooms Lifecycle & Isolation Integration Tests', () => {

  it('should generate unguessable 6-character uppercase alphanumeric room codes', () => {
    const manager = new RoomManager();
    const codes = new Set<string>();

    for (let i = 0; i < 50; i++) {
      const room = manager.createPrivateRoom();
      assert.strictEqual(room.id.length, 6, 'Room code should be 6 characters');
      assert.match(room.id, /^[0-9A-F]{6}$/, 'Room code should be uppercase hex');
      assert.ok(!codes.has(room.id), 'Room code must be unique');
      codes.add(room.id);
    }
  });

  it('should isolate game states between different rooms (players, timers, ladders)', () => {
    const manager = new RoomManager();
    const roomA = manager.createPrivateRoom();
    const roomB = manager.createPrivateRoom();

    // Add player to Room A
    const playerA = roomA.engine.addHumanPlayer('p_a1', 'Prisoner-A');
    assert.ok(playerA);

    // Add player to Room B
    const playerB = roomB.engine.addHumanPlayer('p_b1', 'Prisoner-B');
    assert.ok(playerB);

    // Room A only contains player A
    assert.strictEqual(roomA.engine.state.players.length, 1);
    assert.strictEqual(roomA.engine.state.players[0].name, 'Prisoner-A');

    // Room B only contains player B
    assert.strictEqual(roomB.engine.state.players.length, 1);
    assert.strictEqual(roomB.engine.state.players[0].name, 'Prisoner-B');

    // Move player in Room A
    roomA.engine.handleInput('p_a1', {
      left: false, right: true, up: false, down: false,
      tackle: false, kick: false, grab: false, struggle: false,
      pickDrop: false, throwRope: false, pullRope: false,
      aimAngle: 0, mouseWorldX: 0, mouseWorldY: 0
    });
    roomA.engine.update();

    // Verify Room B player is untouched
    assert.strictEqual(playerB.vx, 0, 'Player in Room B must not be affected by inputs in Room A');
    assert.strictEqual(playerB.x, 300, 'Player B position must remain at spawn');

    // Start match in Room A
    roomA.engine.startNewMatch();
    assert.strictEqual(roomA.engine.state.phase, 'WAITING_SIGNAL');
    assert.strictEqual(roomB.engine.state.phase, 'LOBBY', 'Room B must remain in LOBBY');
  });

  it('should associate resume tokens with specific rooms and reconnect to original room', () => {
    const manager = new RoomManager();
    const roomA = manager.createPrivateRoom();
    const roomB = manager.createPrivateRoom();

    const tokenA = 'token-uuid-room-a';
    const tokenB = 'token-uuid-room-b';

    // Simulate session registration in Room A
    roomA.sessions.set(tokenA, {
      playerId: 'p_a1',
      name: 'Alice',
      resumeToken: tokenA,
      ws: null,
      disconnectTime: null
    });
    manager.associateTokenWithRoom(tokenA, roomA.id);

    // Simulate session registration in Room B
    roomB.sessions.set(tokenB, {
      playerId: 'p_b1',
      name: 'Bob',
      resumeToken: tokenB,
      ws: null,
      disconnectTime: null
    });
    manager.associateTokenWithRoom(tokenB, roomB.id);

    // Find room by token
    const foundRoomA = manager.findRoomByToken(tokenA);
    const foundRoomB = manager.findRoomByToken(tokenB);

    assert.strictEqual(foundRoomA?.id, roomA.id);
    assert.strictEqual(foundRoomB?.id, roomB.id);

    // Attempting to reconnect with tokenA should never resolve to Room B
    assert.notStrictEqual(foundRoomA?.id, roomB.id);
  });

  it('should enforce room capacity limit per room', () => {
    const manager = new RoomManager();
    const room = manager.createPrivateRoom();

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = room.engine.addHumanPlayer(`p_${i}`, `Prisoner-${i}`);
      assert.ok(p, `Player ${i} should be successfully added`);
    }

    assert.strictEqual(room.engine.state.players.length, MAX_PLAYERS);

    // 11th player must be rejected
    const extraPlayer = room.engine.addHumanPlayer('p_extra', 'Extra');
    assert.strictEqual(extraPlayer, null, 'Exceeding room capacity must return null');
  });

  it('should clean up expired private rooms while preserving default room', () => {
    const manager = new RoomManager();
    const defaultRoom = manager.getDefaultRoom();
    const privateRoom = manager.createPrivateRoom();
    const privateId = privateRoom.id;

    assert.ok(manager.getRoom(privateId));

    // Initially with 0 clients and 0 sessions, an empty private room is expired
    assert.strictEqual(privateRoom.isExpired(), true);
    assert.strictEqual(defaultRoom.isExpired(), false, 'Default room must NEVER expire');

    // Run cleanup
    manager.cleanAllExpiredSessions(Date.now());
    assert.strictEqual(manager.getRoom(privateId), undefined, 'Empty private room should be pruned');
    assert.ok(manager.getDefaultRoom(), 'Default room must remain intact');
  });

  it('should retain private room during the 60s disconnect grace period', () => {
    const manager = new RoomManager();
    const room = manager.createPrivateRoom();
    const now = 1000000;

    room.sessions.set('token-1', {
      playerId: 'p1',
      name: 'Alice',
      resumeToken: 'token-1',
      ws: null,
      disconnectTime: now - 30000 // Disconnected 30s ago (within 60s window)
    });

    assert.strictEqual(room.isExpired(now), false, 'Room with active reconnect window must not expire');

    // After 61 seconds
    assert.strictEqual(room.isExpired(now + 31000), true, 'Room after reconnect window expired must expire');
  });
});
