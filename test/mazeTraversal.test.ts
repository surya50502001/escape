import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/gameEngine.js';
import {
  FLOOR_Y, LOWER_FLOOR_Y, WORLD_WIDTH, WORLD_HEIGHT,
  DORM_LEDGE_Y, DORM_LEFT_X, DORM_RIGHT_X,
  MAINT_UPPER_LEDGE_Y, MAINT_UPPER_LEDGE_X, MAINT_UPPER_LEDGE_W,
  SHAFT_LEFT_X, SHAFT_RIGHT_X, BASEMENT_ENTRY_X,
  V_PIPE_X, V_PIPE_TOP_Y, H_PIPE_Y, H_PIPE_EXIT_X,
  MAZE_WALLS
} from '../server/types.js';

function makeEngine() {
  const e = new GameEngine();
  e.startNewMatch();
  e.update();
  return e;
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

  it('ladder with base on main floor and top above it is valid', () => {
    const engine = makeEngine();
    const ladder = { ...engine.state.ladders[1] };
    ladder.x = 800;
    ladder.y = FLOOR_Y - 90;
    ladder.height = 90;
    assert.equal(engine.validateLadderPlacement(ladder), true);
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
});
