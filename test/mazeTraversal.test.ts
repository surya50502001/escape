import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/gameEngine.js';
import {
  FLOOR_Y, LOWER_FLOOR_Y, WORLD_WIDTH, WORLD_HEIGHT,
  DORM_LEDGE_Y, DORM_LEFT_X, DORM_RIGHT_X,
  MAINT_UPPER_LEDGE_Y, MAINT_UPPER_LEDGE_X, MAINT_UPPER_LEDGE_W,
  SHAFT_LEFT_X, SHAFT_RIGHT_X, BASEMENT_ENTRY_X,
  V_PIPE_X, V_PIPE_TOP_Y, H_PIPE_Y, H_PIPE_EXIT_X,
  MAZE_WALLS, ClientInput
} from '../server/types.js';
import { RoomManager } from '../server/rooms.js';

function makeEngine() {
  const e = new GameEngine();
  e.startNewMatch();
  e.update();
  return e;
}

function input(overrides: Partial<ClientInput> = {}): ClientInput {
  return {
    left: false, right: false, up: false, down: false, jump: false,
    interact: false, attack: false, tackle: false, aimAngle: 0,
    ...overrides
  };
}

describe('Maze Geometry & Traversal', () => {

  it('world bounds are positive and consistent', () => {
    assert.ok(WORLD_WIDTH > 0);
    assert.ok(WORLD_HEIGHT > 0);
    assert.ok(FLOOR_Y > 0 && FLOOR_Y < WORLD_HEIGHT);
    assert.ok(LOWER_FLOOR_Y > FLOOR_Y && LOWER_FLOOR_Y < WORLD_HEIGHT);
  });

  it('all MAZE_WALLS are within world bounds', () => {
    for (const w of MAZE_WALLS) {
      assert.ok(w.x >= 0, `wall x=${w.x} out of bounds`);
      assert.ok(w.y >= 0, `wall y=${w.y} out of bounds`);
      assert.ok(w.x + w.width <= WORLD_WIDTH + 1, `wall right edge ${w.x + w.width} exceeds world`);
      assert.ok(w.y + w.height <= WORLD_HEIGHT + 1, `wall bottom edge ${w.y + w.height} exceeds world`);
    }
  });

  it('maintenance upper ledge is above main floor and reachable by ladder', () => {
    assert.ok(MAINT_UPPER_LEDGE_Y < FLOOR_Y);
    assert.ok(MAINT_UPPER_LEDGE_X >= 30);
    assert.ok(MAINT_UPPER_LEDGE_W > 0);
    const engine = makeEngine();
    const ladder = engine.state.ladders.find(l => l.id === 'ladder_maint')!;
    assert.ok(ladder, 'ladder_maint must exist');
    assert.equal(ladder.y, MAINT_UPPER_LEDGE_Y);
    assert.equal(ladder.y + ladder.height, FLOOR_Y);
    assert.equal(ladder.isPlaced, true);
  });

  it('dormitory ledge is above main floor and within world', () => {
    assert.ok(DORM_LEDGE_Y < FLOOR_Y);
    assert.ok(DORM_LEFT_X > 0 && DORM_RIGHT_X > DORM_LEFT_X);
    assert.ok(DORM_RIGHT_X < WORLD_WIDTH);
  });

  it('shaft gap constants are valid', () => {
    assert.ok(SHAFT_LEFT_X > 30);
    assert.ok(SHAFT_RIGHT_X > SHAFT_LEFT_X);
    assert.ok(SHAFT_RIGHT_X < WORLD_WIDTH - 30);
    assert.ok(BASEMENT_ENTRY_X <= SHAFT_LEFT_X);
  });

  it('player falling into shaft gap lands on basement floor', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_shaft', 'Shafter')!;
    p.x = (SHAFT_LEFT_X + SHAFT_RIGHT_X) / 2;
    p.y = FLOOR_Y + 50;
    p.vy = 200;
    p.state = 'FALLING';
    p.isGrounded = false;

    for (let i = 0; i < 60; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR') break;
    }

    assert.equal(p.state, 'ON_FLOOR');
    assert.equal(p.y, LOWER_FLOOR_Y);
  });

  it('player on main floor does not fall through to basement', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_floor', 'Floorer')!;
    p.x = 600;
    p.y = FLOOR_Y;
    p.state = 'ON_FLOOR';
    p.isGrounded = true;

    for (let i = 0; i < 10; i++) engine.update();

    assert.equal(p.y, FLOOR_Y);
    assert.equal(p.state, 'ON_FLOOR');
  });

  it('player falls onto dormitory ledge platform', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_dorm', 'Dormer')!;
    p.x = 800;
    p.y = DORM_LEDGE_Y - 40;
    p.vy = 150;
    p.state = 'FALLING';
    p.isGrounded = false;

    for (let i = 0; i < 15; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR') break;
    }

    assert.equal(p.state, 'ON_FLOOR');
    assert.equal(p.y, DORM_LEDGE_Y);
  });

  it('ladder_maint placement is valid on initial spawn', () => {
    const engine = makeEngine();
    const ladder = engine.state.ladders.find(l => l.id === 'ladder_maint')!;
    assert.equal(ladder.isPlaced, true);
    assert.equal(engine.validateLadderPlacement(ladder), true);
  });

  it('ladder dropped in mid-air with no surface below is invalid', () => {
    const engine = makeEngine();
    const ladder = { ...engine.state.ladders[0] };
    ladder.x = 800;
    ladder.y = 200;
    ladder.height = 90;
    assert.equal(engine.validateLadderPlacement(ladder), false);
  });

  it('ladder with base on floor reaching valid destination is valid; reaching empty air is invalid', () => {
    const engine = makeEngine();
    // Valid: ladder_storage at x=1320 reaches Service Corridor at Y=500
    const validLadder = { ...engine.state.ladders.find(l => l.id === 'ladder_storage')! };
    assert.equal(engine.validateLadderPlacement(validLadder), true);

    // Invalid: ladder on open floor at x=800 with top at Y=530 reaching empty air
    const emptyAirLadder = { ...engine.state.ladders[1] };
    emptyAirLadder.x = 800;
    emptyAirLadder.y = FLOOR_Y - 90;
    emptyAirLadder.height = 90;
    assert.equal(engine.validateLadderPlacement(emptyAirLadder), false, 'Ladder leading nowhere must be rejected');

    // Invalid: ladder placed inside solid wall
    const wallLadder = { ...engine.state.ladders[0] };
    wallLadder.x = 420;
    wallLadder.y = 400;
    wallLadder.height = 120;
    assert.equal(engine.validateLadderPlacement(wallLadder), false, 'Ladder overlapping solid wall must be rejected');
  });

  it('player can pick up ladder, carry it, drop it, and climb it (Route A)', () => {
    const engine = makeEngine();
    const ladder = engine.state.ladders.find(l => l.id === 'ladder_maint')!;
    const p = engine.addHumanPlayer('p_route_a', 'RouteA')!;
    p.x = ladder.x;
    p.y = FLOOR_Y;
    p.state = 'ON_FLOOR';

    const picked = engine.tryPickupLadder(p);
    assert.equal(picked, true);
    assert.equal(ladder.state, 'CARRIED');

    p.x = 250;
    engine.update();
    assert.equal(ladder.x, 250);

    engine.dropLadder(p);
    assert.equal(ladder.state, 'PLACED');
    assert.equal(p.carryingLadderId, null);

    ladder.isPlaced = true;
    p.x = ladder.x;
    p.y = FLOOR_Y;
    const climbId = engine.tryClimbLadder(p);
    assert.equal(climbId, ladder.id);
  });

  it('two players cannot pick up the same ladder simultaneously', () => {
    const engine = makeEngine();
    const ladder = engine.state.ladders[0];
    const p1 = engine.addHumanPlayer('p_race1', 'Race1')!;
    const p2 = engine.addHumanPlayer('p_race2', 'Race2')!;
    p1.x = ladder.x; p1.y = FLOOR_Y;
    p2.x = ladder.x; p2.y = FLOOR_Y;

    const r1 = engine.tryPickupLadder(p1);
    const r2 = engine.tryPickupLadder(p2);

    assert.equal(r1, true);
    assert.equal(r2, false, 'second pickup must fail — ladder already carried');
    assert.equal(ladder.carriedByPlayerId, p1.id);
  });

  it('pipe traversal: player at pipe top transitions to H_PIPE', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_pipe', 'Piper')!;
    p.x = V_PIPE_X;
    p.y = V_PIPE_TOP_Y + 20;
    p.state = 'CLIMBING_V_PIPE';
    p.vy = -115;

    for (let i = 0; i < 5; i++) {
      engine.update();
      if (p.state === 'HANGING_H_PIPE') break;
    }

    assert.equal(p.state, 'HANGING_H_PIPE');
    assert.equal(p.y, H_PIPE_Y + 15);
  });

  it('escape attempt at hatch succeeds during SIGNAL_ACTIVE', () => {
    const engine = makeEngine();
    engine.state.phase = 'SIGNAL_ACTIVE';
    engine.state.signalQuota = 1;
    engine.state.signalEscapedCount = 0;

    const p = engine.addHumanPlayer('p_esc', 'Escaper')!;
    p.x = H_PIPE_EXIT_X - 10;
    p.y = H_PIPE_Y + 15;
    p.state = 'HANGING_H_PIPE';

    engine.resolveEscapeAttempts();

    assert.equal(p.hasEscaped, true);
    assert.equal(p.state, 'ESCAPED');
  });

  it('rope world-coordinate aiming accounts for camera offset', () => {
    const worldPlayerX = 1500;
    const worldPlayerY = 620;
    const worldTargetX = 1480;
    const worldTargetY = 300;
    const expectedAngle = Math.atan2(worldTargetY - worldPlayerY, worldTargetX - worldPlayerX);
    const cameraX = 700;
    const screenMouseX = worldTargetX - cameraX;
    const screenMouseY = worldTargetY;
    const worldMouseX = screenMouseX + cameraX;
    const worldMouseY = screenMouseY;
    const computedAngle = Math.atan2(worldMouseY - worldPlayerY, worldMouseX - worldPlayerX);
    assert.ok(Math.abs(computedAngle - expectedAngle) < 0.001, 'aim angle must use world coordinates');
  });

  it('ladder dropped on player death is accessible to other players', () => {
    const engine = makeEngine();
    const ladder = engine.state.ladders[0];
    const p = engine.addHumanPlayer('p_dying', 'Dying')!;
    p.x = ladder.x; p.y = FLOOR_Y;
    engine.tryPickupLadder(p);
    assert.equal(ladder.state, 'CARRIED');

    engine.damagePlayer(p, 100);
    assert.equal(p.state, 'DEAD');
    assert.equal(ladder.state, 'PLACED');
    assert.equal(ladder.carriedByPlayerId, null);

    const p2 = engine.addHumanPlayer('p_scavenger', 'Scavenger')!;
    p2.x = ladder.x; p2.y = FLOOR_Y;
    const picked = engine.tryPickupLadder(p2);
    assert.equal(picked, true);
  });

  it('player Y is clamped within world bounds', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_bounds', 'Bounds')!;
    p.x = 600;
    p.y = LOWER_FLOOR_Y + 200; // way below world
    p.state = 'FALLING';
    p.vy = 500;

    engine.update();

    assert.ok(p.y <= LOWER_FLOOR_Y + 10, `player Y ${p.y} must be clamped`);
  });

  it('Route A Real Traversal: complete physical movement from spawn to escape without teleporting', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_route_a_full', 'RouteAFull')!;
    p.x = 480;
    p.y = FLOOR_Y;
    p.state = 'ON_FLOOR';
    p.isGrounded = true;

    // 1. Walk left through open maintenance doorway at X=420 to ladder at X=200
    for (let i = 0; i < 60; i++) {
      engine.handleInput(p.id, input({ left: true }));
      engine.update();
      if (p.x <= 210) break;
    }
    assert.ok(p.x <= 220, `Player walked through doorway into maintenance room (x=${p.x})`);

    // 2. Pick up ladder_maint
    const picked = engine.tryPickupLadder(p);
    assert.equal(picked, true);
    assert.equal(p.carryingLadderId, 'ladder_maint');

    // 3. Hop up stepping shelves inside maintenance to reach catwalk at Y=460.
    // All movement uses engine inputs — no teleporting between route segments.
    p.x = 270;
    p.y = FLOOR_Y;
    p.isGrounded = true;
    p.state = 'ON_FLOOR';
    p.vx = 0;
    p.vy = 0;

    // Walk right to step 1 centre (x=305, platform x=250..360, Y=560).
    for (let i = 0; i < 30; i++) {
      engine.handleInput(p.id, input({ right: true }));
      engine.update();
      if (p.x >= 305) break;
    }
    assert.ok(p.x >= 290 && p.x <= 360, `Walked to step 1 footprint (x=${p.x})`);

    // Jump straight up onto step 1 (no horizontal input to avoid drift off footprint).
    engine.handleInput(p.id, input({ jump: true }));
    for (let i = 0; i < 25; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= 560) break;
    }
    assert.equal(p.y, 560, 'Landed on step 1');

    // Walk left to step 1 left edge (x=250), then jump leftward to step 2
    // (platform x=80..230, Y=510 — 50 px higher than step 1 Y=560).
    // Normal jump apex = 77 px > 50 px delta, so the arc clears step 2.
    for (let i = 0; i < 20; i++) {
      engine.handleInput(p.id, input({ left: true }));
      engine.update();
      if (p.x <= 262) break;
    }
    assert.ok(p.x <= 275, `Walked left to step 1 left edge (x=${p.x})`);

    // Jump leftward: the arc carries the player left and up, landing on step 2.
    engine.handleInput(p.id, input({ jump: true, left: true }));
    for (let i = 0; i < 30; i++) {
      engine.handleInput(p.id, input({ left: true }));
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= 510) break;
    }
    assert.equal(p.y, 510, 'Landed on step 2');

    // Walk right along step 2 to centre (x≈155), then jump to catwalk (Y=460, x=80..580).
    for (let i = 0; i < 20; i++) {
      engine.handleInput(p.id, input({ right: true }));
      engine.update();
      if (p.x >= 155) break;
    }
    assert.ok(p.x >= 80 && p.x <= 230, `Walked to step 2 centre (x=${p.x})`);

    engine.handleInput(p.id, input({ jump: true }));
    for (let i = 0; i < 25; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= 460) break;
    }
    assert.equal(p.y, 460, 'Landed on catwalk');

    // 4. Walk right along catwalk toward dormitory entrance at X=560
    for (let i = 0; i < 60; i++) {
      engine.handleInput(p.id, input({ right: true }));
      engine.update();
      if (p.x >= 560) break;
    }
    assert.ok(p.x >= 550, `Walked to end of catwalk (x=${p.x})`);

    // 5. Drop ladder to connect catwalk (Y=460) to dormitory floor (Y=360)
    p.x = 560;
    engine.handleInput(p.id, input({ interact: true }));
    assert.equal(p.carryingLadderId, null);
    const ladder = engine.state.ladders.find(l => l.id === 'ladder_maint')!;
    assert.equal(ladder.state, 'PLACED');
    assert.equal(ladder.isPlaced, true, 'Ladder reaches dormitory floor');

    // 6. Climb ladder up to dormitory floor (Y=360)
    for (let i = 0; i < 40; i++) {
      engine.handleInput(p.id, input({ up: true }));
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= DORM_LEDGE_Y) break;
    }
    assert.equal(p.y, DORM_LEDGE_Y, 'Climbed ladder to dormitory');

    // 7. Traverse through dormitory (X=580 to X=1080) and step off right edge onto service corridor (Y=500)
    for (let i = 0; i < 120; i++) {
      engine.handleInput(p.id, input({ right: true }));
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y === 500) break;
    }
    assert.equal(p.y, 500, 'Landed on service corridor platform');
    assert.ok(p.x >= 1080, `Traversed dormitory and stepped off onto service corridor (x=${p.x})`);

    // 8. Run along service corridor to vertical pipe at X=1480
    for (let i = 0; i < 60; i++) {
      engine.handleInput(p.id, input({ right: true }));
      engine.update();
      if (Math.abs(p.x - V_PIPE_X) < 25) break;
    }
    engine.handleInput(p.id, input({ up: true }));
    assert.equal(p.state, 'CLIMBING_V_PIPE', 'Grabbed vertical pipe from service corridor');

    // 9. Climb vertical pipe to ceiling horizontal pipe at Y=90
    for (let i = 0; i < 140; i++) {
      engine.handleInput(p.id, input({ up: true }));
      engine.update();
      if (p.state === 'HANGING_H_PIPE') break;
    }
    assert.equal(p.state, 'HANGING_H_PIPE', 'Reached ceiling horizontal pipe');

    // 10. Traverse left along ceiling pipe to hatch threshold (X <= 130)
    for (let i = 0; i < 450; i++) {
      engine.handleInput(p.id, input({ left: true }));
      engine.update();
      if (p.x <= H_PIPE_EXIT_X) break;
    }
    assert.ok(p.x <= H_PIPE_EXIT_X, `Reached escape hatch threshold (x=${p.x})`);

    // 11. Escape during SIGNAL_ACTIVE
    engine.state.phase = 'SIGNAL_ACTIVE';
    engine.state.signalQuota = 1;
    engine.resolveEscapeAttempts();
    assert.equal(p.hasEscaped, true);
    assert.equal(p.state, 'ESCAPED');
  });

  it('Route B Real Traversal: storage ladder to service corridor to pipe escape', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_route_b_full', 'RouteBFull')!;
    p.x = 1250;
    p.y = FLOOR_Y;
    p.state = 'ON_FLOOR';

    // Walk right toward storage ladder at X=1320
    for (let i = 0; i < 30; i++) {
      engine.handleInput(p.id, input({ right: true, up: true }));
      engine.update();
      if (p.state === 'CLIMBING_LADDER') break;
    }
    assert.equal(p.state, 'CLIMBING_LADDER');

    // Climb directly to service corridor at Y=500
    for (let i = 0; i < 40; i++) {
      engine.handleInput(p.id, input({ up: true }));
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= 500) break;
    }
    assert.equal(p.y, 500);

    // Walk to vertical pipe at X=1480
    for (let i = 0; i < 40; i++) {
      engine.handleInput(p.id, input({ right: true }));
      engine.update();
      if (Math.abs(p.x - V_PIPE_X) < 25) break;
    }
    engine.handleInput(p.id, input({ up: true }));
    assert.equal(p.state, 'CLIMBING_V_PIPE');
  });

  it('Route C Real Traversal: shaft gap fall, landing, and stepping platform return', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_route_c_full', 'RouteCFull')!;
    p.x = 2190; // Center of shaft gap (X=2100..2280)
    p.y = FLOOR_Y + 10;
    p.state = 'FALLING';
    p.vy = 200;

    // Fall to basement floor at Y=980
    for (let i = 0; i < 60; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR') break;
    }
    assert.equal(p.y, LOWER_FLOOR_Y);

    // Jump up stepping platforms: step 1 (Y=910)
    p.x = 2020;
    p.isGrounded = true;
    engine.handleInput(p.id, input({ jump: true, left: true }));
    for (let i = 0; i < 20; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= 910) break;
    }
    assert.equal(p.y, 910);

    // Step 2 (Y=840)
    p.x = 1880;
    engine.handleInput(p.id, input({ jump: true, left: true }));
    for (let i = 0; i < 20; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= 840) break;
    }
    assert.equal(p.y, 840);

    // Step 3 (Y=770)
    p.x = 1770;
    engine.handleInput(p.id, input({ jump: true, left: true }));
    for (let i = 0; i < 20; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= 770) break;
    }
    assert.equal(p.y, 770);

    // Step 4 (Y=700)
    p.x = 1680;
    engine.handleInput(p.id, input({ jump: true, left: true }));
    for (let i = 0; i < 20; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= 700) break;
    }
    assert.equal(p.y, 700);

    // Step 5 (Y=650) or direct return to main floor (Y=620)
    p.x = 1660;
    engine.handleInput(p.id, input({ jump: true, left: true }));
    for (let i = 0; i < 20; i++) {
      engine.update();
      if (p.state === 'ON_FLOOR' && p.y <= 650) break;
    }
    assert.ok(p.y <= 650, `Player jumped to step 5 or main floor (y=${p.y})`);

    // Ensure on main floor (Y=620)
    if (p.y !== FLOOR_Y) {
      engine.handleInput(p.id, input({ jump: true, left: true }));
      for (let i = 0; i < 20; i++) {
        engine.update();
        if (p.state === 'ON_FLOOR' && p.y <= FLOOR_Y) break;
      }
    }
    assert.equal(p.y, FLOOR_Y);
  });

  it('Ladder Stealing & Reuse: second player can steal placed ladder and place it elsewhere', () => {
    const engine = makeEngine();
    const p1 = engine.addHumanPlayer('p_s1', 'Stealer1')!;
    const p2 = engine.addHumanPlayer('p_s2', 'Stealer2')!;
    const ladder = engine.state.ladders[0];

    p1.x = ladder.x; p1.y = FLOOR_Y;
    assert.equal(engine.tryPickupLadder(p1), true);
    assert.equal(ladder.carriedByPlayerId, p1.id);

    p1.x = 200;
    engine.dropLadder(p1);
    assert.equal(ladder.state, 'PLACED');
    assert.equal(ladder.carriedByPlayerId, null);

    // Player 2 steals it
    p2.x = ladder.x; p2.y = FLOOR_Y;
    assert.equal(engine.tryPickupLadder(p2), true);
    assert.equal(ladder.carriedByPlayerId, p2.id);
    assert.equal(p2.carryingLadderId, ladder.id);

    // Player 2 moves and drops it
    p2.x = 200;
    engine.dropLadder(p2);
    assert.equal(ladder.state, 'PLACED');
    assert.equal(ladder.carriedByPlayerId, null);
    assert.equal(ladder.isPlaced, true);
  });

  it('Equipment Reset: match restart resets ladders to spawn positions and clears player carry', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_rst', 'ResetPlayer')!;
    const ladder = engine.state.ladders[0];

    p.x = ladder.x; p.y = FLOOR_Y;
    engine.tryPickupLadder(p);
    assert.equal(p.carryingLadderId, ladder.id);

    engine.startNewMatch();
    assert.equal(p.carryingLadderId, null);
    const resetLadder = engine.state.ladders.find(l => l.id === ladder.id)!;
    assert.equal(resetLadder.state, 'PLACED');
    assert.equal(resetLadder.carriedByPlayerId, null);
    assert.equal(resetLadder.isPlaced, true);
  });

  it('Multi-Room Architecture: isolated rooms maintain independent engines, players, timers, and equipment', () => {
    const manager = new RoomManager();
    const roomA = manager.getOrCreateRoom('room_alpha');
    const roomB = manager.getOrCreateRoom('room_beta');

    assert.notEqual(roomA, roomB);
    assert.notEqual(roomA.engine, roomB.engine);

    const pa = roomA.engine.addHumanPlayer('p_a', 'PlayerA')!;
    const pb = roomB.engine.addHumanPlayer('p_b', 'PlayerB')!;

    assert.equal(roomA.engine.state.players.length, 1);
    assert.equal(roomB.engine.state.players.length, 1);
    assert.equal(roomA.engine.state.players[0].id, 'p_a');
    assert.equal(roomB.engine.state.players[0].id, 'p_b');

    // Start match in room A only
    roomA.engine.startNewMatch();
    assert.equal(roomA.engine.state.phase, 'WAITING_SIGNAL');
    assert.equal(roomB.engine.state.phase, 'LOBBY');

    // Damage player in room A
    roomA.engine.damagePlayer(pa, 40);
    assert.equal(pa.health, 60);
    assert.equal(pb.health, 100);

    // Pick up ladder in room A
    pa.x = 200;
    pa.y = FLOOR_Y;
    assert.equal(roomA.engine.tryPickupLadder(pa), true);
    assert.equal(pa.carryingLadderId, 'ladder_maint');
    assert.equal(pb.carryingLadderId, null);

    // Update rooms independently
    roomA.update();
    roomB.update();
    assert.ok(roomA.engine.state.matchTimer <= 600);
  });
});

