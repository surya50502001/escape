import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GameEngine, HATCH_ZONE } from '../server/gameEngine.js';
import { FLOOR_Y, LOWER_FLOOR_Y, MAZE_WALLS, SHAFT_LEFT_X, SHAFT_RIGHT_X } from '../server/types.js';

describe('Collision & Traversal Physics Audit', () => {

  it('should never land a falling player on thin vertical wall tops (shaft gap walls, pillars)', () => {
    const engine = new GameEngine();
    const player = engine.addHumanPlayer('p1', 'Alice')!;
    engine.startNewMatch();

    // Find standalone thin vertical walls with open space above (dividing upper lintel, security gate pillar, left & right shaft walls)
    const thinVerticalWalls = MAZE_WALLS.filter(w => 
      !w.isPlatform && w.solid && (w.x === 420 || w.x === 1230 || w.x === 2100 || w.x === 2258)
    );
    assert.strictEqual(thinVerticalWalls.length, 4, 'Must have 4 standalone thin vertical walls in maze');

    for (const wall of thinVerticalWalls) {
      // Place player directly above the top edge of this vertical wall
      player.x = wall.x + wall.width / 2;
      player.y = wall.y - 10;
      player.vy = 200;
      player.state = 'FALLING';
      player.isGrounded = false;

      // Update engine physics
      engine.update();

      // The player must NOT have landed on the top of this thin vertical wall
      assert.notStrictEqual(player.y, wall.y, `Player must not land on thin vertical wall at x=${wall.x}, y=${wall.y}`);
    }
  });

  it('should stop horizontal velocity cleanly when colliding with solid walls without penetration', () => {
    const engine = new GameEngine();
    const player = engine.addHumanPlayer('p1', 'Alice')!;
    engine.startNewMatch();

    // Position player on floor near the solid left boundary wall
    player.x = 40;
    player.y = FLOOR_Y;
    player.vx = -300;
    player.state = 'ON_FLOOR';

    // Simulate input running left into the wall
    engine.handleInput('p1', {
      left: true, right: false, up: false, down: false,
      tackle: false, kick: false, grab: false, struggle: false,
      pickDrop: false, throwRope: false, pullRope: false,
      aimAngle: 0, mouseWorldX: 0, mouseWorldY: 0
    });

    for (let i = 0; i < 15; i++) {
      engine.update();
    }

    // Must be stopped at world boundary (min 35) without penetrating through wall
    assert.ok(player.x >= 35, `Player x (${player.x}) must not penetrate left wall (min 35)`);
    assert.strictEqual(player.vx, 0, 'Horizontal velocity must be zeroed upon colliding with wall');
  });

  it('should drop cleanly through shaft gap into basement without clipping or getting stuck', () => {
    const engine = new GameEngine();
    const player = engine.addHumanPlayer('p1', 'Alice')!;
    engine.startNewMatch();

    // Position player right over the shaft opening
    const shaftCenterX = (SHAFT_LEFT_X + SHAFT_RIGHT_X) / 2;
    player.x = shaftCenterX;
    player.y = FLOOR_Y - 20;
    player.state = 'FALLING';
    player.vy = 100;
    player.vx = 0;
    player.isGrounded = false;

    // Advance physics until landing
    for (let i = 0; i < 60; i++) {
      engine.update();
      if (player.isGrounded) break;
    }

    assert.strictEqual(player.isGrounded, true, 'Player should successfully land in the basement');
    assert.strictEqual(player.y, LOWER_FLOOR_Y, 'Player landing level must be the basement lower floor');
    assert.strictEqual(player.vy, 0, 'Velocity must be zeroed on basement floor landing');
  });

  it('should land properly on valid walkable platforms (dormitory walkway)', () => {
    const engine = new GameEngine();
    const player = engine.addHumanPlayer('p1', 'Alice')!;
    engine.startNewMatch();

    // Find dormitory platform
    const dormPlatform = MAZE_WALLS.find(w => w.isPlatform && w.y < FLOOR_Y && w.width > 200);
    assert.ok(dormPlatform, 'Must find a walkable upper platform');

    player.x = dormPlatform.x + dormPlatform.width / 2;
    player.y = dormPlatform.y - 30;
    player.vy = 250;
    player.state = 'FALLING';
    player.isGrounded = false;

    for (let i = 0; i < 20; i++) {
      engine.update();
      if (player.isGrounded) break;
    }

    assert.strictEqual(player.isGrounded, true, 'Player should land on walkable platform');
    assert.strictEqual(player.y, dormPlatform.y, 'Player Y must match platform surface');
    assert.strictEqual(player.vy, 0, 'Velocity must be stopped on platform surface');
  });
});
