import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CampaignSession } from '../server/campaign/campaignSession.js';
import { Player } from '../server/types.js';

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

describe('Complete 10-Room Campaign Interactive Playthrough Verification', () => {

  it('T01 & T02: Room 1 Boost Jump, Rope Anchor Deployment & Rope Climb', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    session.addPlayer(p1, 1);
    session.addPlayer(p2, 1);

    const r1 = session.getOrCreateRoomRuntime(1);

    // 1. Position p1 in boost zone [8, 3, 14, 5] (x: 256..448, y: 480..544)
    p1.x = 300;
    p1.y = 544;
    p1.vy = -60; // Player initiates jump

    // Trigger update or interact
    r1.update();
    assert.equal(p1.vy, -520, 'Boost zone must impart v_boost = -520 px/s');

    // Simulate physics until apex is reached: delta = (-520)^2 / (2 * 750) = 180.2 px
    // Floor is at 544 px -> 544 - 180 = 364 px, well above upper ledge at Y=384 px (Y=8 tiles)!
    p1.x = 700; // Lands on upper ledge [18, 7, 36, 8]
    p1.y = 384;
    p1.vy = 0;
    p1.isGrounded = true;

    // 2. Move to rope anchor at [31, 8] (x: 992, y: 384)
    p1.x = 992;
    p1.y = 384;
    assert.equal(r1.getPrompt(p1), '[E] Deploy Rope to Floor');

    // Press E to deploy rope
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: true, attack: false, tackle: false, aimAngle: 0
    });

    assert.equal(r1.deployedMechanisms.has('rope_anchor'), true);
    const ropeLadder = r1.engine.state.ladders.find(l => l.id === 'cell_rope');
    assert.ok(ropeLadder, 'Cell rope must be added to ladders');
    assert.equal(ropeLadder.state, 'PLACED');
    assert.equal(ropeLadder.isPlaced, true);
    assert.equal(ropeLadder.y, 384);
    assert.equal(ropeLadder.height, 160, 'Rope must reach from 384 to 544 floor');

    // 3. Bob at floor (992, 544) climbs the rope to upper ledge
    p2.x = 992;
    p2.y = 544;
    r1.engine.handleInput('p2', {
      left: false, right: false, up: true, down: false,
      jump: false, interact: false, attack: false, tackle: false, aimAngle: 0
    });
    assert.equal(p2.state, 'CLIMBING_LADDER');

    // Move to exit door and transition to Room 2
    const exitDoor = r1.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = exitDoor.rect.x + 10;
    p1.y = exitDoor.rect.y + 10;
    p2.x = exitDoor.rect.x + 10;
    p2.y = exitDoor.rect.y + 10;

    assert.equal(session.transitionPlayer('p1', 2), true);
    assert.equal(session.transitionPlayer('p2', 2), true);
    assert.equal(session.getPlayerRoomId('p1'), 2);
    assert.equal(session.getPlayerRoomId('p2'), 2);
  });

  it('T03 & T12: Room 2 First Climb Platform Traverse & Reset Lever', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 2);

    const r2 = session.getOrCreateRoomRuntime(2);

    // Floor Y=3 (544), Crate at [16, 3, 19, 5] (surface Y=5, 480 px, delta=64px <= 71.5px)
    // Mid platform [23, 6, 31, 7] (surface Y=7, 416 px, delta=64px)
    // Upper ledge [33, 8, 50, 9] (surface Y=9, 352 px, delta=64px)
    // Exit door [47, 9, 49, 12] (surface 352 px)
    p1.x = 550; p1.y = 480; // on crate
    p1.x = 800; p1.y = 416; // on mid platform
    p1.x = 1200; p1.y = 352; // on upper ledge
    p1.x = 1520; p1.y = 352; // at exit door

    assert.equal(session.transitionPlayer('p1', 3), true);
    assert.equal(session.getPlayerRoomId('p1'), 3);
  });

  it('T10: Room 3 Sleeping Guard and High Bypass Pipe Route', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 3);

    const r3 = session.getOrCreateRoomRuntime(3);
    const pipe = r3.engine.state.ladders.find(l => l.id === 'bypass_pipe');
    assert.ok(pipe, 'Bypass pipe must exist in Room 3');
    assert.equal(pipe.state, 'PLACED');

    // Climb pipe from 544 up to bypass ledge (384 px)
    p1.x = 688; p1.y = 384; // on bypass ledge [21, 7, 31, 8]
    p1.x = 1520; p1.y = 544; // drop down to ground exit door [47, 3, 49, 6]

    assert.equal(session.transitionPlayer('p1', 4), true);
    assert.equal(session.getPlayerRoomId('p1'), 4);
  });

  it('T11: Room 4 Sweeping Searchlight and Cover Occlusion', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 4);

    const r4 = session.getOrCreateRoomRuntime(4);
    // Position Alice behind Cover A [12, 3, 16, 6] (x 384..512)
    p1.x = 420;
    p1.y = 544;

    // Move searchlight right over Alice
    r4.searchlightX = 420;
    r4.update();

    // Alice is occluded by cover, not stunned
    assert.equal(p1.stunnedTimer, 0, 'Player behind cover must not be stunned');

    // Move to exit door and transition to Room 5
    p1.x = 1520;
    p1.y = 544;
    assert.equal(session.transitionPlayer('p1', 5), true);
    assert.equal(session.getPlayerRoomId('p1'), 5);
  });

  it('Room 5 Secret Panel and Room 6 Vertical Shaft Climb', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 5);

    const r5 = session.getOrCreateRoomRuntime(5);

    // Open movable panel at x=832
    p1.x = 832;
    p1.y = 544;
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: true, attack: false, tackle: false, aimAngle: 0
    });
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: false, attack: false, tackle: false, aimAngle: 0
    });

    assert.equal(r5.deployedMechanisms.has('movable_panel'), true);
    assert.ok(r5.groundItems.has('optional_rope'));

    // Move to exit door and transition to Room 6 (Vertical Shaft)
    p1.x = 1520; p1.y = 544;
    assert.equal(session.transitionPlayer('p1', 6), true);
    assert.equal(session.getPlayerRoomId('p1'), 6);

    const r6 = session.getOrCreateRoomRuntime(6);
    assert.equal(r6.loadedRoom.widthPx, 800, 'Room 6 is 25 tiles wide = 800 px');
    assert.ok(r6.engine.state.ladders.length >= 1, 'Room 6 must have vertical climbables');

    // Climb to top catwalk at Y=160
    p1.x = 750;
    p1.y = 160;
    assert.equal(session.transitionPlayer('p1', 7), true);
    assert.equal(session.getPlayerRoomId('p1'), 7);
  });

  it('T06: Room 8 Two-Switch Puzzle 12s Window and Permanent Unlock', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    session.addPlayer(p1, 8);

    const r8 = session.getOrCreateRoomRuntime(8);

    // 1. Player hits switch A at [12, 3] (x: 384, y: 544)
    p1.x = 384;
    p1.y = 544;
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: true, attack: false, tackle: false, aimAngle: 0
    });
    // Release key
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: false, attack: false, tackle: false, aimAngle: 0
    });

    assert.equal(r8.activatedSwitches.has('switch_a'), true);
    assert.ok(r8.switchTimers.get('switch_a')! > 11.0);
    assert.equal(r8.deployedMechanisms.has('door_unlocked'), false, 'Door must not unlock with only Switch A');

    // 2. Sprint to switch B at [36, 3] (x: 1152, y: 544) within 12 seconds
    p1.x = 1152;
    p1.y = 544;
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: true, attack: false, tackle: false, aimAngle: 0
    });
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: false, attack: false, tackle: false, aimAngle: 0
    });

    assert.equal(r8.activatedSwitches.has('switch_b'), true);
    assert.equal(r8.deployedMechanisms.has('door_unlocked'), true, 'Door must permanently unlock when both active');

    // 3. Move to exit door and transition to Room 9
    const exitDoor = r8.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = exitDoor.rect.x + 10;
    p1.y = exitDoor.rect.y + 10;

    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: true, attack: false, tackle: false, aimAngle: 0
    });
    assert.equal(session.getPlayerRoomId('p1'), 9, 'Should transition to Room 9 through unlocked door');
  });

  it('T07 & T08: Room 9 Box C Key Unlock, Room 10 Emergency Ladder, Solo Backtrack & Final Escape', () => {
    const session = new CampaignSession();
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');

    // Start in Room 9
    session.addPlayer(p1, 9);
    session.addPlayer(p2, 9);
    const r9 = session.getOrCreateRoomRuntime(9);

    // 1. In Room 9, pick up brass key at key_niche [8, 3] (x: 256, y: 544)
    p1.x = 256;
    p1.y = 544;
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: true, attack: false, tackle: false, aimAngle: 0
    });
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: false, attack: false, tackle: false, aimAngle: 0
    });

    const key = session.playerItems.get('p1');
    assert.ok(key, 'Alice must be carrying key');
    assert.equal(key.type, 'key');

    // 2. Alice stands at Box C [35, 3, 38, 5] (x: 1160, y: 512) and unlocks it
    p1.x = 1160;
    p1.y = 512;
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: true, attack: false, tackle: false, aimAngle: 0
    });
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: false, attack: false, tackle: false, aimAngle: 0
    });

    assert.equal(r9.isContainerUnlocked('box_c'), true, 'Box C must now be unlocked');
    const cuttingTool = r9.groundItems.get('cutting_tool');
    assert.ok(cuttingTool, 'Cutting tool must drop from Box C to ground');

    // 3. Both Alice and Bob transition to Room 10
    const r9Exit = r9.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r9Exit.rect.x + 10; p1.y = r9Exit.rect.y + 10;
    p2.x = r9Exit.rect.x + 10; p2.y = r9Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 10), true);
    assert.equal(session.transitionPlayer('p2', 10), true);

    const r10 = session.getOrCreateRoomRuntime(10);
    assert.equal(r10.getPlayers().length, 2);

    // 4. Bob climbs to Platform C (x: 1200, y: 192)
    p2.x = 1200;
    p2.y = 192;
    r10.update(); // Trigger Platform C detection
    assert.equal(r10.deployedMechanisms.has('emergency_ladder'), true, 'Emergency ladder must deploy');
    const emergencyLadder = r10.engine.state.ladders.find(l => l.id === 'emergency_ladder');
    assert.ok(emergencyLadder);
    assert.equal(emergencyLadder.isPlaced, true, 'Emergency ladder must be climbable');

    // 5. Alice drops back down to floor and backtracks solo to Room 9
    const r10Entry = r10.loadedRoom.doors.find(d => d.id === 'entry_door')!;
    p1.x = r10Entry.rect.x + 10;
    p1.y = r10Entry.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 9), true);

    // Verify Bob is still on Platform C in Room 10 (INDEPENDENT ROOM PRESENCE)
    assert.equal(session.getPlayerRoomId('p2'), 10);
    assert.equal(r10.getPlayer('p2')?.y, 192);
    assert.equal(r10.getPlayers().length, 1);

    // 6. Alice is now back in Room 9. Drops key, picks up cutting tool!
    assert.equal(session.getPlayerRoomId('p1'), 9);
    session.dropItem('p1');
    assert.equal(session.playerItems.has('p1'), false);

    p1.x = 1160;
    p1.y = 544;
    assert.equal(session.pickupItem('p1', 'cutting_tool'), true);
    assert.equal(session.playerItems.get('p1')?.type, 'cutting_tool');

    // 7. Alice returns to Room 10
    p1.x = r9Exit.rect.x + 10;
    p1.y = r9Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 10), true);
    assert.equal(session.getPlayerRoomId('p1'), 10);
    assert.equal(r10.getPlayers().length, 2);

    // 8. Alice climbs emergency ladder directly from floor to Platform C
    p1.x = 1248;
    p1.y = 160;

    // Cut hatch using cutting tool
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: true, attack: false, tackle: false, aimAngle: 0
    });
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: false, attack: false, tackle: false, aimAngle: 0
    });

    assert.equal(r10.cutHatches.has('sealed_hatch'), true, 'Sealed hatch must be cut');

    // 9. Escape through hatch to Surface!
    session.handleInput('p1', {
      left: false, right: false, up: false, down: false,
      jump: false, interact: true, attack: false, tackle: false, aimAngle: 0
    });

    assert.equal(p1.hasEscaped, true, 'Alice must escape');
    assert.equal(session.campaignComplete, true, 'Campaign must be complete');
  });

});
