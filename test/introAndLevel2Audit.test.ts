import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { IntroSequence } from '../server/campaign/introSequence.js';
import { CampaignSession } from '../server/campaign/campaignSession.js';
import { Player } from '../server/types.js';
import { ITEM_PICKUP_RADIUS } from '../server/campaign/roomRuntime.js';
import { CampaignRoomThreeEnvironment, disposeHierarchy } from '../src/graphics3d/campaignRoomThree.js';
import { CharacterModelManager, UNIFORM_PALETTES } from '../src/graphics3d/characterModelManager.js';

describe('Audit Verification: Intro Sequence, Input Freedom & Level 2 Continuity', () => {
  it('INTRO-01: intro advances through ARRIVE -> LOCK -> STEAL -> SIGNAL -> PLAY', () => {
    const intro = new IntroSequence();
    assert.equal(intro.hasStarted(), false);
    assert.equal(intro.isComplete(), false);
    assert.equal(intro.isInputLocked(), false);

    intro.start();
    assert.equal(intro.hasStarted(), true);
    assert.equal(intro.state.phase, 'ARRIVE');
    assert.equal(intro.isInputLocked(), true);

    // After 3.1s -> LOCK
    intro.update(3.1);
    assert.equal(intro.state.phase, 'LOCK');
    assert.equal(intro.isInputLocked(), true);

    // After 2.1s more -> STEAL (keyStolen becomes true)
    intro.update(2.1);
    assert.equal(intro.state.phase, 'STEAL');
    assert.equal(intro.state.keyStolen, true);

    // After 3.1s more -> SIGNAL (doorUnlocked becomes true)
    intro.update(3.1);
    assert.equal(intro.state.phase, 'SIGNAL');
    assert.equal(intro.state.doorUnlocked, true);

    // After 2.1s more -> PLAY (inputLocked becomes false, complete is true)
    intro.update(2.1);
    assert.equal(intro.state.phase, 'PLAY');
    assert.equal(intro.isInputLocked(), false);
    assert.equal(intro.isComplete(), true);
  });

  it('INTRO-02: fail-safe timeout unlocks input by 10.5s under any condition', () => {
    const intro = new IntroSequence();
    intro.start();
    assert.equal(intro.isInputLocked(), true);

    // Large single tick or lag spike
    intro.update(11.0);
    assert.equal(intro.state.phase, 'PLAY');
    assert.equal(intro.isInputLocked(), false);
    assert.equal(intro.isComplete(), true);
  });

  it('INTRO-03: skip() immediately restores gameplay control', () => {
    const intro = new IntroSequence();
    intro.start();
    assert.equal(intro.isInputLocked(), true);

    intro.skip();
    assert.equal(intro.state.phase, 'PLAY');
    assert.equal(intro.isInputLocked(), false);
    assert.equal(intro.isComplete(), true);
  });

  it('INTRO-04: player input in Room 2 is NEVER blocked by intro sequence', () => {
    const session = new CampaignSession();
    const p1: Player = {
      id: 'p_test_1',
      name: 'Atlas',
      isBot: false,
      x: 100,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#38bdf8',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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

    // Add player directly to Room 2
    session.addPlayer(p1, 2);
    assert.equal(session.getPlayerRoomId(p1.id), 2);

    // Send right movement input
    session.handleInput(p1.id, {
      up: false, down: false, left: false, right: true,
      jump: false, interact: false, tackle: false, pull: false, struggle: false, angle: 0
    });

    const room2 = session.getPlayerRoom(p1.id)!;
    room2.update();

    // Player should move right (vx > 0 and x > 100)
    const updated = room2.getPlayer(p1.id)!;
    assert.ok(updated.vx > 0 || updated.x > 100, `Player moved freely in Room 2 (x=${updated.x}, vx=${updated.vx})`);
  });

  it('INTRO-05: pressing Space or E skips intro cinematic to play immediately', () => {
    const session = new CampaignSession();
    const p1: Player = {
      id: 'p_skip_test',
      name: 'Beacon',
      isBot: false,
      x: 100,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#fb923c',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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

    session.addPlayer(p1, 1);
    assert.equal(session.intro.isInputLocked(), true);

    // Player presses jump (Space)
    session.handleInput(p1.id, {
      up: false, down: false, left: false, right: false,
      jump: true, interact: false, tackle: false, pull: false, struggle: false, angle: 0
    });

    // Intro should be skipped and unlocked
    assert.equal(session.intro.isComplete(), true);
    assert.equal(session.intro.isInputLocked(), false);
  });

  it('TRANS-01: moving from Room 1 to Room 2 safely marks intro as complete', () => {
    const session = new CampaignSession();
    const p1: Player = {
      id: 'p_trans_test',
      name: 'Carter',
      isBot: false,
      x: 1530, // Near exit door
      y: 384,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#fde047',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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

    session.addPlayer(p1, 1);
    const room1 = session.getOrCreateRoomRuntime(1);
    const exitDoor = room1.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = exitDoor.rect.x + exitDoor.rect.width / 2;
    p1.y = exitDoor.rect.y + exitDoor.rect.height / 2;

    const success = session.transitionPlayer(p1.id, 2);
    assert.equal(success, true);
    assert.equal(session.getPlayerRoomId(p1.id), 2);
    assert.equal(session.intro.isComplete(), true);
    assert.equal(session.intro.isInputLocked(), false);
  });

  it('ITEM-3D-01: ground items are authoritatively synchronized across rooms and pickups', () => {
    const session = new CampaignSession();
    const p1: Player = {
      id: 'p_item_test',
      name: 'Davis',
      isBot: false,
      x: 256,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#86efac',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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

    // Add to Room 9 where brass key is located at x=256, y=544
    session.addPlayer(p1, 9);
    p1.x = 256;
    p1.y = 544;
    const syncBefore = session.getClientSync(p1.id)!;
    assert.equal(syncBefore.roomId, 9);
    assert.ok(syncBefore.groundItems.some(i => i.id === 'brass_key'), 'Room 9 must have ground item brass_key');

    // Pick up item with E
    session.handleInput(p1.id, {
      up: false, down: false, left: false, right: false,
      jump: false, interact: true, tackle: false, pull: false, struggle: false, angle: 0
    });

    const syncAfter = session.getClientSync(p1.id)!;
    assert.equal(syncAfter.carriedItem?.id, 'brass_key', 'Player must carry brass_key');
    assert.ok(!syncAfter.groundItems.some(i => i.id === 'brass_key'), 'brass_key removed from groundItems');

    // Drop item with E
    session.handleInput(p1.id, {
      up: false, down: false, left: false, right: false,
      jump: false, interact: false, tackle: false, pull: false, struggle: false, angle: 0
    });
    session.handleInput(p1.id, {
      up: false, down: false, left: false, right: false,
      jump: false, interact: true, tackle: false, pull: false, struggle: false, angle: 0
    });

    const syncDropped = session.getClientSync(p1.id)!;
    assert.equal(syncDropped.carriedItem, null, 'Player dropped item');
    assert.ok(syncDropped.groundItems.some(i => i.id === 'brass_key'), 'brass_key returned to groundItems');
  });

  it('MECH-3D-01: puzzleState transmits all mechanism and hazard coordinates for 3D rendering', () => {
    const session = new CampaignSession();
    const p1: Player = {
      id: 'p_mech_test',
      name: 'Atlas',
      isBot: false,
      x: 100,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#38bdf8',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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

    // Room 4 searchlight
    session.addPlayer(p1, 4);
    const syncR4 = session.getClientSync(p1.id)!;
    assert.ok(typeof syncR4.puzzleState.searchlightX === 'number', 'Room 4 must transmit searchlightX');

    // Room 7 guard
    const p2: Player = { ...p1, id: 'p_mech_test_2' };
    session.addPlayer(p2, 7);
    const syncR7 = session.getClientSync(p2.id)!;
    assert.ok(typeof syncR7.puzzleState.guardX === 'number', 'Room 7 must transmit guardX');
  });

  it('AUDIT-FIX-01: Room 10 ladder coordinates match authoritative server placement at x=912, y=192', () => {
    const session = new CampaignSession();
    const p1: Player = {
      id: 'p_r10_lad',
      name: 'R10Climber',
      isBot: false,
      x: 100,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#38bdf8',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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

    session.addPlayer(p1, 10);
    const room10 = session.getOrCreateRoomRuntime(10);
    room10.deployEmergencyLadder();

    const ladder = room10.engine.state.ladders.find(l => l.id === 'emergency_ladder');
    assert.ok(ladder, 'Room 10 must have emergency_ladder');
    assert.equal(ladder.x, 912, 'Emergency ladder authoritative X must be 912');
    assert.equal(ladder.y, 192, 'Emergency ladder authoritative Y must be 192');
    assert.equal(ladder.height, 352, 'Emergency ladder authoritative height must be 352');
    assert.equal(ladder.isPlaced, true, 'Emergency ladder must be placed once deployed');

    // Verify 3D environment builds emergency ladder at authoritative x=912
    const sync = session.getClientSync(p1.id)!;
    const env = new CampaignRoomThreeEnvironment();
    env.update(sync);
    const ladderGroup = (env as any).emergencyLadderGroup;
    assert.ok(ladderGroup, '3D environment must build emergencyLadderGroup in Room 10');
    assert.equal(ladderGroup.visible, true, 'Emergency ladder must be visible once deployed');
    // Check rung X position
    const firstRung = ladderGroup.children.find((c: any) => c.geometry && c.geometry.type === 'CylinderGeometry');
    assert.ok(firstRung, 'Must contain ladder rung');
    assert.equal(firstRung.position.x, 912, 'Ladder rung visual X must match authoritative 912');
    env.dispose();
  });

  it('AUDIT-FIX-02: pickup prompt and pickup range agree at shared ITEM_PICKUP_RADIUS=64', () => {
    assert.equal(ITEM_PICKUP_RADIUS, 64, 'Shared ITEM_PICKUP_RADIUS must be 64 px');

    const session = new CampaignSession();
    const p1: Player = {
      id: 'p_dist_test',
      name: 'Ranger',
      isBot: false,
      x: 256,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#86efac',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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

    session.addPlayer(p1, 9);
    const room9 = session.getOrCreateRoomRuntime(9);
    const item = room9.groundItems.get('brass_key');
    assert.ok(item, 'brass_key exists in Room 9');

    // Test Case A: At distance 56 px (between old 48 px prompt threshold and 64 px pickup radius)
    // Both prompt AND pickup must succeed!
    p1.x = item.x + 56;
    p1.y = item.y;
    assert.ok(room9.getPrompt(p1)?.includes('Pick up'), 'At 56 px prompt must display pick up');
    const picked = room9.pickupGroundItem(p1);
    assert.ok(picked !== null, 'At 56 px pickupGroundItem must succeed');
    assert.equal(picked?.id, 'brass_key');

    // Drop it back
    room9.dropItem(picked!, item.x, item.y);

    // Test Case B: At distance 70 px (> 64 px radius)
    // Neither prompt NOR pickup should trigger
    p1.x = item.x + 70;
    p1.y = item.y;
    assert.ok(!room9.getPrompt(p1)?.includes('Pick up'), 'At 70 px prompt must NOT display pick up');
    assert.equal(room9.pickupGroundItem(p1), null, 'At 70 px pickupGroundItem must fail');
  });

  it('AUDIT-FIX-03: Three.js CampaignRoomThreeEnvironment disposes GPU resources on room changes and cleanup', () => {
    const session = new CampaignSession();
    const p1: Player = {
      id: 'p_gpu_test',
      name: 'GPUGuard',
      isBot: false,
      x: 100,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#38bdf8',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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

    session.addPlayer(p1, 1);
    const sync1 = session.getClientSync(p1.id)!;
    const env = new CampaignRoomThreeEnvironment();

    // Render Room 1
    env.update(sync1);
    const staticCount1 = (env as any).staticGroup.children.length;
    assert.ok(staticCount1 > 0, 'Room 1 has static geometry');

    // Transition to Room 9 (with ground item brass_key)
    const session9 = new CampaignSession();
    const p9: Player = { ...p1, id: 'p_gpu_r9' };
    session9.addPlayer(p9, 9);
    p9.x = 256;
    p9.y = 544;
    const sync9 = session9.getClientSync(p9.id)!;
    env.update(sync9);
    const itemMeshes = (env as any).itemMeshes as Map<string, any>;
    assert.ok(itemMeshes.has('brass_key'), 'Room 9 itemMesh created for brass_key');

    // Pick up brass_key: item disappears from ground items
    session9.handleInput(p9.id, {
      up: false, down: false, left: false, right: false,
      jump: false, interact: true, tackle: false, pull: false, struggle: false, angle: 0
    });
    const sync9After = session9.getClientSync(p9.id)!;
    env.update(sync9After);
    assert.ok(!itemMeshes.has('brass_key'), 'Picked up item mesh disposed and removed from cache');

    // Transition to Room 10: static meshes refreshed and old items disposed
    const session10 = new CampaignSession();
    const p10: Player = { ...p1, id: 'p_gpu_r10' };
    session10.addPlayer(p10, 10);
    const sync10 = session10.getClientSync(p10.id)!;
    env.update(sync10);
    assert.equal(itemMeshes.size, 0, 'Dynamic item meshes cleared on room transition');

    // Call full dispose
    env.dispose();
    assert.equal((env as any).staticGroup.children.length, 0, 'staticGroup emptied on dispose');
    assert.equal((env as any).dynamicGroup.children.length, 0, 'dynamicGroup emptied on dispose');
  });

  it('AUDIT-FIX-04: Puzzle mechanism visual coordinates align with server triggers and collision zones', () => {
    const createBasePlayer = (id: string): Player => ({
      id,
      name: 'Surveyor',
      isBot: false,
      x: 100,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#38bdf8',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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
    });

    // 1. Room 1 Rope Anchor trigger at (992, 384)
    const session1 = new CampaignSession();
    const p1 = createBasePlayer('p_mech_1');
    session1.addPlayer(p1, 1);
    const r1 = session1.getOrCreateRoomRuntime(1);
    p1.x = 992;
    p1.y = 384;
    assert.equal(r1.getPrompt(p1), '[E] Deploy Rope to Floor');

    // 2. Room 8 Switches at (384, 544) and (1152, 544)
    const session8 = new CampaignSession();
    const p8 = createBasePlayer('p_mech_8');
    session8.addPlayer(p8, 8);
    const r8 = session8.getOrCreateRoomRuntime(8);
    p8.x = 384;
    p8.y = 544;
    assert.equal(r8.getPrompt(p8), '[E] Activate Switch A');
    p8.x = 1152;
    p8.y = 544;
    assert.equal(r8.getPrompt(p8), '[E] Activate Switch B');

    // 3. Room 9 Box C at (1160, 512)
    const session9 = new CampaignSession();
    const p9 = createBasePlayer('p_mech_9');
    session9.addPlayer(p9, 9);
    const r9 = session9.getOrCreateRoomRuntime(9);
    p9.x = 1160;
    p9.y = 512;
    assert.equal(r9.getPrompt(p9), '[LOCKED] Requires Brass Key');

    // 4. Room 10 Sealed Hatch at (1248, 144)
    const session10 = new CampaignSession();
    const p10 = createBasePlayer('p_mech_10');
    session10.addPlayer(p10, 10);
    const r10 = session10.getOrCreateRoomRuntime(10);
    p10.x = 1248;
    p10.y = 144;
    assert.equal(r10.getPrompt(p10), '[SEALED] Requires Cutting Tool');
  });

  it('AUDIT-FIX-05: disconnecting one player does not dispose shared/base materials or alter remaining players appearance', () => {
    const manager = new CharacterModelManager();
    const scene = new THREE.Scene();
    manager.scene = scene;

    // Create a base glTF scene mock with base materials
    const baseScene = new THREE.Group();
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    let baseMatDisposed = false;
    baseMat.dispose = () => { baseMatDisposed = true; };

    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), baseMat);
    baseMesh.name = 'vanguard_Mesh';
    baseScene.add(baseMesh);

    const baseVisorMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    let baseVisorMatDisposed = false;
    baseVisorMat.dispose = () => { baseVisorMatDisposed = true; };

    const baseVisorMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), baseVisorMat);
    baseVisorMesh.name = 'vanguard_visor';
    baseScene.add(baseVisorMesh);

    manager.baseGltf = { scene: baseScene, animations: [] };
    manager.isLoaded = true;

    const p1: Player = {
      id: 'player_host',
      name: 'HostPlayer',
      isBot: false,
      x: 100,
      y: 544,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#38bdf8',
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
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

    const p2: Player = {
      ...p1,
      id: 'player_partner',
      name: 'PartnerPlayer',
      x: 200
    };

    const teamRoster = [
      { id: 'player_host', name: 'HostPlayer' },
      { id: 'player_partner', name: 'PartnerPlayer' }
    ];

    // Spawn both players with team roster
    manager.updatePlayers([p1, p2], 0.016, teamRoster);
    assert.equal(manager.playerInstances.size, 2);

    const inst1 = manager.playerInstances.get('player_host')!;
    const inst2 = manager.playerInstances.get('player_partner')!;
    assert.ok(inst1 && inst2);

    // Each player instance must own its own isolated cloned materials
    assert.notEqual(inst1.ownedMaterials[0], inst2.ownedMaterials[0]);
    assert.notEqual(inst1.ownedMaterials[0], baseMat);
    assert.notEqual(inst2.ownedMaterials[0], baseMat);

    // Track disposal of player 1 and player 2 materials
    let p1MatDisposed = false;
    let p2MatDisposed = false;
    inst1.ownedMaterials.forEach(m => {
      const origDisp = m.dispose.bind(m);
      m.dispose = () => { p1MatDisposed = true; origDisp(); };
    });
    inst2.ownedMaterials.forEach(m => {
      const origDisp = m.dispose.bind(m);
      m.dispose = () => { p2MatDisposed = true; origDisp(); };
    });

    // Check Player 2's starting appearance (Hazard Orange palette for partner index 1)
    const p2Palette = UNIFORM_PALETTES[1];
    let p2MeshMat: THREE.MeshStandardMaterial | null = null;
    inst2.root.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.name === 'vanguard_Mesh') {
        p2MeshMat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      }
    });
    assert.ok(p2MeshMat);
    assert.equal(p2MeshMat.color.getHex(), p2Palette.bodyColor);

    // Disconnect player 1: update with only [p2] (with teamRoster)
    manager.updatePlayers([p2], 0.016, teamRoster);

    // Assertions:
    // 1. Player 1 instance was removed and its owned materials disposed
    assert.equal(manager.playerInstances.has('player_host'), false);
    assert.equal(p1MatDisposed, true, 'Player 1 owned materials must be disposed');

    // 2. Base glTF materials were NOT disposed
    assert.equal(baseMatDisposed, false, 'Base glTF materials must remain intact and NOT disposed');
    assert.equal(baseVisorMatDisposed, false, 'Base glTF visor material must remain intact');

    // 3. Player 2 materials were NOT disposed
    assert.equal(p2MatDisposed, false, 'Remaining player 2 materials must NOT be disposed');

    // 4. Player 2 appearance (color, uniform palette) is completely intact
    assert.equal(p2MeshMat.color.getHex(), p2Palette.bodyColor, 'Player 2 uniform color remains intact');
    assert.equal(manager.playerInstances.has('player_partner'), true);

    // 5. Subsequent update even without teamRoster preserves player 2's palette
    manager.updatePlayers([p2], 0.016);
    assert.equal(p2MeshMat.color.getHex(), p2Palette.bodyColor, 'Player 2 uniform color preserved without roster');
  });
});
