import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CampaignSession } from '../server/campaign/campaignSession.js';
import { RoomRuntime } from '../server/campaign/roomRuntime.js';
import { loadRoomFromSpec } from '../server/campaign/roomLoader.js';
import { Player } from '../server/types.js';

function createTestPlayer(id: string, name: string): Player {
  return {
    id,
    name,
    isBot: false,
    x: 100,
    y: 544,
    vx: 0,
    vy: 0,
    state: 'ON_FLOOR',
    facingDirection: 'RIGHT',
    isGrounded: true,
    isClimbing: false,
    isHolding: false,
    isTackling: false,
    tackleTimer: 0,
    stunnedTimer: 0,
    hazardCooldown: 0,
    tackleCooldown: 0,
    attackCooldown: 0,
    hasEscaped: false,
    health: 100,
    stamina: 100,
    sabotages: 0,
    climbKickTimer: 0,
    climbAttackCooldown: 0,
    climbGrabbingId: null,
    grabbedByPlayerId: null,
    struggleMeter: 0,
    carryingLadderId: null,
    color: '#fff',
    score: 0,
    rocks: 0
  };
}

describe('Release Audit: Full Campaign Integration, Mechanics & Airlock Safety', () => {

  it('T05-EVAC-01: 15s forward airlock evacuation pulls delayed player into target room with revival', () => {
    const session = new CampaignSession('CAMP-TEST-EVAC');
    session.intro.skip(); // skip intro

    // Add Player 1 and Player 2 to Room 1
    const p1 = createTestPlayer('p1', 'Player One');
    const p2 = createTestPlayer('p2', 'Player Two');
    session.addPlayer(p1, 1);
    session.addPlayer(p2, 1);

    assert.equal(session.getPlayerRoomId('p1'), 1);
    assert.equal(session.getPlayerRoomId('p2'), 1);

    // Player 1 transitions from Room 1 to Room 2 via exit door
    const r1 = session.activeRooms.get(1)!;
    const exitDoor = r1.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    const p1InR1 = r1.engine.state.players.find(p => p.id === 'p1')!;
    p1InR1.x = exitDoor.rect.x + 10;
    p1InR1.y = exitDoor.rect.y + 10;

    session.handleInput('p1', {
      up: false, down: false, left: false, right: false,
      jump: false, interact: true, dropRope: false, pullRope: false, mouseAngle: 0
    });

    // Player 1 is now in Room 2, Player 2 is still in Room 1
    assert.equal(session.getPlayerRoomId('p1'), 2);
    assert.equal(session.getPlayerRoomId('p2'), 1);

    // Verify evacuation countdown is running for trailing room 1
    const syncP2Before = session.getClientSync('p2')!;
    assert.ok(syncP2Before.evacuationWarning, 'Evacuation warning must be active for Room 1');
    assert.equal(syncP2Before.evacuationWarning!.targetRoomId, 2);
    assert.ok(syncP2Before.evacuationWarning!.remainingSeconds <= 15.0);

    // Simulate 10 seconds of game ticks (300 ticks)
    for (let i = 0; i < 300; i++) {
      session.update();
    }
    // Player 2 still in Room 1 after 10s
    assert.equal(session.getPlayerRoomId('p2'), 1);

    // Down/eliminate Player 2 to test revival on evacuation
    const p2InR1 = session.activeRooms.get(1)!.engine.state.players.find(p => p.id === 'p2')!;
    p2InR1.health = 0;
    p2InR1.state = 'DEAD';

    // Simulate remaining 5.5 seconds (170 ticks, total > 15s)
    for (let i = 0; i < 170; i++) {
      session.update();
    }

    // Player 2 must have been safely evacuated into Room 2 safe staging area and revived
    assert.equal(session.getPlayerRoomId('p2'), 2, 'Player 2 should be evacuated to Room 2');
    const p2InR2 = session.activeRooms.get(2)!.engine.state.players.find(p => p.id === 'p2')!;
    assert.ok(p2InR2, 'Player 2 should exist in Room 2 engine state');
    assert.equal(p2InR2.state, 'ON_FLOOR', 'Evacuated player must be revived');
    assert.ok(p2InR2.health > 0, 'Evacuated player health must be restored');
    assert.ok(p2InR2.x >= 64 && p2InR2.x <= 160, 'Player 2 must be positioned at safe entrance');

    // Evacuation timer for Room 1 is now cleared
    const syncP2After = session.getClientSync('p2')!;
    assert.equal(syncP2After.evacuationWarning, null, 'Evacuation warning cleared when all players grouped');
  });

  it('T05-EVAC-02: Reverse backtrack (10 -> 9) does NOT trigger evacuation or drag teammates', () => {
    const session = new CampaignSession('CAMP-TEST-BACKTRACK');
    session.intro.skip();

    const p1 = createTestPlayer('p1', 'Player One');
    const p2 = createTestPlayer('p2', 'Player Two');
    session.addPlayer(p1, 10);
    session.addPlayer(p2, 10);

    assert.equal(session.getPlayerRoomId('p1'), 10);
    assert.equal(session.getPlayerRoomId('p2'), 10);

    // Player 1 backtracks from Room 10 to Room 9 (via door at x=48, y=544)
    const p1InR10 = session.activeRooms.get(10)!.engine.state.players.find(p => p.id === 'p1')!;
    p1InR10.x = 48;
    p1InR10.y = 544;

    session.handleInput('p1', {
      up: false, down: false, left: false, right: false,
      jump: false, interact: true, dropRope: false, pullRope: false, mouseAngle: 0
    });

    // Player 1 is now in Room 9, Player 2 remains in Room 10
    assert.equal(session.getPlayerRoomId('p1'), 9);
    assert.equal(session.getPlayerRoomId('p2'), 10);

    // Simulate 20 seconds (600 ticks) - NO evacuation should occur for reverse backtrack
    for (let i = 0; i < 600; i++) {
      session.update();
    }

    assert.equal(session.getPlayerRoomId('p1'), 9, 'Player 1 should remain freely in Room 9');
    assert.equal(session.getPlayerRoomId('p2'), 10, 'Player 2 should remain waiting safely in Room 10');
  });

  it('ROOM3-STEALTH-01: Sleeping guard catches ground intruder but bypass pipe evades guard', () => {
    const loadedRoom = loadRoomFromSpec(3);
    const runtime = new RoomRuntime(loadedRoom);

    const groundPlayer = createTestPlayer('p1', 'Ground Infiltrator');
    groundPlayer.x = 768;
    groundPlayer.y = 544; // Floor directly near guard at x=768
    runtime.engine.state.players.push(groundPlayer);

    // Run tick - ground player should be caught, stunned, and teleported to holding nook (x=96, y=544)
    runtime.update(1 / 30);
    assert.equal(groundPlayer.x, 96, 'Caught player returned to holding nook');
    assert.equal(groundPlayer.state, 'STUNNED', 'Caught player is stunned');
    assert.ok(groundPlayer.stunnedTimer > 0, 'Stun timer active');

    // Bypass player traveling high via ceiling pipe / catwalk route (y <= 480)
    const pipePlayer = createTestPlayer('p2', 'Pipe Traverser');
    pipePlayer.x = 768;
    pipePlayer.y = 380; // High above guard
    runtime.engine.state.players.push(pipePlayer);

    runtime.update(1 / 30);
    assert.equal(pipePlayer.x, 768, 'Pipe traverser position not reset');
    assert.notEqual(pipePlayer.state, 'STUNNED', 'Pipe traverser evades guard undetected');
  });

  it('ROOM6-ROPE-01: Upper shaft anchor deploys climbable rope down to recovery platform', () => {
    const loadedRoom = loadRoomFromSpec(6);
    const runtime = new RoomRuntime(loadedRoom);

    const player = createTestPlayer('p1', 'Shaft Climber');
    player.x = 608;
    player.y = 160; // Near shaft rope anchor at [19, 15]

    // Before deploy: prompt says [E] Deploy Rope to Platform
    assert.equal(runtime.getPrompt(player), '[E] Deploy Rope to Platform');

    // Interact with anchor
    const res = runtime.interact(player);
    assert.ok(res);
    assert.equal(res.action, 'DEPLOY_SHAFT_ROPE');
    assert.ok(runtime.deployedMechanisms.has('shaft_rope'));

    // Ladder object exists in engine state for physics climbing
    const rope = runtime.engine.state.ladders.find(l => l.id === 'shaft_rope');
    assert.ok(rope, 'Shaft rope exists in ladders');
    assert.equal(rope.x, 608);
    assert.equal(rope.y, 160);
    assert.equal(rope.height, 352); // Reaches recovery platform at y=512
  });

  it('ROOM5-PANEL-01: Secret panel opens and reveals optional rope', () => {
    const loadedRoom = loadRoomFromSpec(5);
    const runtime = new RoomRuntime(loadedRoom);

    const player = createTestPlayer('p1', 'Scout');
    player.x = 832;
    player.y = 512; // Near secret panel alcove

    assert.equal(runtime.getPrompt(player), '[E] Open Secret Panel');

    const res = runtime.interact(player);
    assert.ok(res);
    assert.equal(res.action, 'OPEN_PANEL');
    assert.ok(runtime.deployedMechanisms.has('movable_panel'));

    const ropeItem = runtime.groundItems.get('optional_rope');
    assert.ok(ropeItem, 'Optional rope ground item spawned');
    assert.equal(ropeItem.type, 'rope');
    assert.equal(ropeItem.roomId, 5);
  });

  it('RECONNECT-01: Reconnecting player restores presence in last active room', () => {
    const session = new CampaignSession('CAMP-TEST-RECONNECT');
    session.intro.skip();

    const p1 = createTestPlayer('p1', 'Alice');
    session.addPlayer(p1, 4);
    assert.equal(session.getPlayerRoomId('p1'), 4);

    // Player disconnects
    session.handlePlayerDisconnect('p1');
    assert.equal(session.players.has('p1'), false);

    // Alice reconnects with same player ID, same player session record
    const sessRecord = session.playerSessions.get('p1');
    assert.ok(sessRecord);
    assert.equal(sessRecord.lastRoomId, 4, 'Session preserved last active room ID');

    // Add back to room using preserved roomId
    const p1Reconnected = createTestPlayer('p1', 'Alice');
    session.addPlayer(p1Reconnected, sessRecord.lastRoomId);
    assert.equal(session.getPlayerRoomId('p1'), 4, 'Alice reconnected directly to Room 4');
  });
});
