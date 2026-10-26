import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CampaignSession } from '../server/campaign/campaignSession.js';
import { loadRoomFromSpec, tileRectToPixel } from '../server/campaign/roomLoader.js';
import { Player, FLOOR_Y } from '../server/types.js';

function makePlayer(id: string, name: string): Player {
  return {
    id,
    name,
    isBot: false,
    x: 100,
    y: 544,
    vx: 0,
    vy: 0,
    facing: 'RIGHT',
    angle: 0,
    color: '#3498db',
    health: 100,
    stamina: 100,
    state: 'ON_FLOOR',
    isGrounded: true,
    stunnedTimer: 0,
    tackleCooldown: 0,
    attackCooldown: 0,
    rocks: 3,
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
}

describe('Phase 2C — Campaign Session & Multi-Room Runtime Foundation', () => {

  it('CAMP-SESS-01: creates campaign session and registers 4-player team with resume tokens', () => {
    const session = new CampaignSession();
    assert.match(session.id, /^CAMP-[0-9A-F]{6}$/, 'Session ID must follow CAMP-XXXXXX convention');

    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Diana');

    assert.equal(session.addPlayer(p1, 1), true);
    assert.equal(session.addPlayer(p2, 1), true);
    assert.equal(session.addPlayer(p3, 1), true);
    assert.equal(session.addPlayer(p4, 1), true);

    // Verify all players placed in Room 1
    assert.equal(session.getPlayerRoomId('p1'), 1);
    assert.equal(session.getPlayerRoomId('p2'), 1);
    assert.equal(session.getPlayerRoomId('p3'), 1);
    assert.equal(session.getPlayerRoomId('p4'), 1);

    // Verify unique resume tokens
    const tokens = new Set<string>();
    for (const playerSession of session.playerSessions.values()) {
      assert.ok(playerSession.resumeToken);
      tokens.add(playerSession.resumeToken);
    }
    assert.equal(tokens.size, 4, 'All players must have distinct resume tokens');
  });

  it('CAMP-LOAD-01: loads spec rooms with accurate pixel geometry and dimensions', () => {
    // Standard Room 1: 50 tiles wide x 20 tiles high = 1600 x 640 px
    const r1 = loadRoomFromSpec(1);
    assert.equal(r1.widthPx, 1600);
    assert.equal(r1.heightPx, 640);
    assert.equal(r1.floorYPx, 544); // (20 - 3) * 32 = 544 px
    assert.ok(r1.walls.length >= 4, 'Must have boundaries and platforms');
    assert.ok(r1.doors.length >= 1, 'Room 1 must have an exit door');

    // Narrow Room 6: 25 tiles wide = 800 px
    const r6 = loadRoomFromSpec(6);
    assert.equal(r6.widthPx, 800);
    assert.equal(r6.heightPx, 640);

    // Room 9: Contains Box C and cutting tool
    const r9 = loadRoomFromSpec(9);
    assert.equal(r9.widthPx, 1600);
    assert.ok(r9.items.some(i => i.type === 'cutting_tool'), 'Room 9 must contain cutting_tool item');

    // Room 10: False escape room
    const r10 = loadRoomFromSpec(10);
    assert.equal(r10.widthPx, 1600);
  });

  it('CAMP-TRANS-01: forward transition moves player upon reaching exit door', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 1);

    const room1 = session.getOrCreateRoomRuntime(1);
    const exitDoor = room1.loadedRoom.doors.find(d => d.id === 'exit_door');
    assert.ok(exitDoor, 'Room 1 must have exit_door');

    // Move player inside exit door zone
    p1.x = exitDoor.rect.x + exitDoor.rect.width / 2;
    p1.y = exitDoor.rect.y + exitDoor.rect.height / 2;

    // Transition to Room 2
    const success = session.transitionPlayer('p1', 2);
    assert.equal(success, true, 'Transition to Room 2 must succeed when at door');
    assert.equal(session.getPlayerRoomId('p1'), 2, 'Player room must now be Room 2');

    // Verify removed from Room 1 and present in Room 2
    assert.equal(room1.getPlayer('p1'), undefined);
    const room2 = session.getOrCreateRoomRuntime(2);
    assert.ok(room2.getPlayer('p1'));
  });

  it('CAMP-TRANS-02: rejects illegal transitions (outside door or unlinked room)', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 1);

    // Player far from exit door (at spawn)
    p1.x = 100;
    p1.y = 544;

    // Attempt transition while not at door
    const notAtDoor = session.transitionPlayer('p1', 2);
    assert.equal(notAtDoor, false, 'Must reject transition when not touching exit door');
    assert.equal(session.getPlayerRoomId('p1'), 1);

    // Move to exit door, but attempt transition to unlinked Room 5
    const room1 = session.getOrCreateRoomRuntime(1);
    const exitDoor = room1.loadedRoom.doors[0];
    p1.x = exitDoor.rect.x + 5;
    p1.y = exitDoor.rect.y + 5;

    const unlinked = session.transitionPlayer('p1', 5);
    assert.equal(unlinked, false, 'Must reject transition to unlinked room');
    assert.equal(session.getPlayerRoomId('p1'), 1);
  });

  it('CAMP-BACKTRACK-01: independent room presence — Room 10->9 backtrack does not pull teammates', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');

    // Place both in Room 10
    session.addPlayer(p1, 10);
    session.addPlayer(p2, 10);

    const room10 = session.getOrCreateRoomRuntime(10);
    assert.equal(room10.getPlayers().length, 2);

    // Position Alice at backtrack entry door (Room 10 -> 9: rect [0, 3, 2, 6] tiles)
    const backtrackDoor = room10.loadedRoom.doors.find(d => d.id === 'entry_door');
    assert.ok(backtrackDoor);
    p1.x = backtrackDoor.rect.x + backtrackDoor.rect.width / 2;
    p1.y = backtrackDoor.rect.y + backtrackDoor.rect.height / 2;

    // Keep Bob in the middle of Room 10
    p2.x = 800;
    p2.y = 544;

    // Alice backtracks to Room 9
    const transitioned = session.transitionPlayer('p1', 9);
    assert.equal(transitioned, true, 'Alice must be able to backtrack from Room 10 to Room 9');

    // Core Decision 5 Assertion:
    // Alice is now in Room 9
    assert.equal(session.getPlayerRoomId('p1'), 9);
    // Bob MUST still be in Room 10 — not pulled along!
    assert.equal(session.getPlayerRoomId('p2'), 10, 'Bob must remain in Room 10 during Alice backtrack');
    assert.equal(room10.getPlayer('p2')?.x, 800, 'Bob position in Room 10 must be unchanged');
    assert.equal(room10.getPlayers().length, 1, 'Only Bob should remain in Room 10');

    // Room 9 only has Alice
    const room9 = session.getOrCreateRoomRuntime(9);
    assert.equal(room9.getPlayers().length, 1);
    assert.equal(room9.getPlayer('p1')?.id, 'p1');
  });

  it('CAMP-PERSIST-01: Room 9 puzzle state persists when all players leave and return', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 9);

    const room9 = session.getOrCreateRoomRuntime(9);
    // Alice unlocks Box C in Room 9
    room9.unlockContainer('box_c');
    assert.equal(room9.isContainerUnlocked('box_c'), true);

    // Alice leaves to Room 10
    const exitDoor = room9.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = exitDoor.rect.x + 5;
    p1.y = exitDoor.rect.y + 5;
    assert.equal(session.transitionPlayer('p1', 10), true);

    // Verify Room 9 now has 0 players
    assert.equal(room9.getPlayers().length, 0);

    // Alice backtracks back to Room 9
    const room10 = session.getOrCreateRoomRuntime(10);
    const returnDoor = room10.loadedRoom.doors.find(d => d.id === 'entry_door')!;
    p1.x = returnDoor.rect.x + 5;
    p1.y = returnDoor.rect.y + 5;
    assert.equal(session.transitionPlayer('p1', 9), true);

    // Re-verify Room 9 state: Box C MUST STILL BE UNLOCKED!
    const reenteredRoom9 = session.getOrCreateRoomRuntime(9);
    assert.equal(reenteredRoom9.isContainerUnlocked('box_c'), true, 'Box C must remain unlocked on return');
  });

  it('CAMP-ITEM-01: atomic item pickup enforces max 1 item rule and prevents double pickup', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 9);

    const room9 = session.getOrCreateRoomRuntime(9);
    const cuttingTool = Array.from(room9.groundItems.values()).find(i => i.type === 'cutting_tool')!;
    assert.ok(cuttingTool);

    // Alice stands over the cutting tool
    p1.x = cuttingTool.x;
    p1.y = cuttingTool.y;

    // First pickup succeeds
    const picked = session.pickupItem('p1', cuttingTool.id);
    assert.equal(picked, true, 'Alice should pick up cutting tool');
    assert.equal(session.playerItems.get('p1')?.id, cuttingTool.id);
    assert.equal(room9.groundItems.has(cuttingTool.id), false, 'Item must be removed from ground');

    // Add a second ground item to test "max 1 item" rule
    room9.groundItems.set('key_storage', {
      id: 'key_storage',
      type: 'key',
      roomId: 9,
      x: p1.x,
      y: p1.y,
      carriedByPlayerId: null
    });

    // Attempt second pickup while already carrying tool
    const secondPickup = session.pickupItem('p1', 'key_storage');
    assert.equal(secondPickup, false, 'Must reject second item pickup (max 1 carried item)');
    assert.equal(session.playerItems.get('p1')?.id, cuttingTool.id, 'Alice still holds cutting tool');
  });

  it('CAMP-ITEM-02: carried item moves with player across room transitions', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 9);

    const room9 = session.getOrCreateRoomRuntime(9);
    const cuttingTool = Array.from(room9.groundItems.values()).find(i => i.type === 'cutting_tool')!;
    p1.x = cuttingTool.x;
    p1.y = cuttingTool.y;
    session.pickupItem('p1', cuttingTool.id);

    // Alice moves to exit door and transitions to Room 10
    const exitDoor = room9.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = exitDoor.rect.x + 5;
    p1.y = exitDoor.rect.y + 5;
    assert.equal(session.transitionPlayer('p1', 10), true);

    // Carried item must now report roomId = 10
    const carried = session.playerItems.get('p1');
    assert.ok(carried);
    assert.equal(carried.id, cuttingTool.id);
    assert.equal(carried.roomId, 10, 'Carried item roomId must update to Room 10');
  });

  it('CAMP-ITEM-03: safe disconnect drops carried item to floor beneath player', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 9);

    const room9 = session.getOrCreateRoomRuntime(9);
    const cuttingTool = Array.from(room9.groundItems.values()).find(i => i.type === 'cutting_tool')!;
    p1.x = 600;
    p1.y = 544;
    cuttingTool.x = 600;
    cuttingTool.y = 544;
    session.pickupItem('p1', cuttingTool.id);

    // Alice disconnects
    session.handlePlayerDisconnect('p1');

    // Item must be returned to room 9 floor at Alice last coordinates
    assert.equal(session.playerItems.has('p1'), false);
    const dropped = room9.groundItems.get(cuttingTool.id);
    assert.ok(dropped, 'Item must be on the ground in Room 9 after disconnect');
    assert.equal(dropped.carriedByPlayerId, null);
    assert.equal(dropped.x, 600);
    assert.equal(dropped.y, 544);
  });

  it('CAMP-HANDOFF-01: atomic item handoff transfers item between adjacent players', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    session.addPlayer(p1, 9);
    session.addPlayer(p2, 9);

    const room9 = session.getOrCreateRoomRuntime(9);
    const cuttingTool = Array.from(room9.groundItems.values()).find(i => i.type === 'cutting_tool')!;
    p1.x = 500; p1.y = 544;
    p2.x = 520; p2.y = 544; // 20 px apart (within 64 px reach)
    cuttingTool.x = 500; cuttingTool.y = 544;
    session.pickupItem('p1', cuttingTool.id);

    // Alice hands off tool to Bob
    const handoffSuccess = session.handoffItem('p1', 'p2');
    assert.equal(handoffSuccess, true);
    assert.equal(session.playerItems.has('p1'), false, 'Alice no longer holds tool');
    assert.equal(session.playerItems.get('p2')?.id, cuttingTool.id, 'Bob now holds tool');
  });

});
