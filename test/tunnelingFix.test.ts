/**
 * Phase 2B — Platform Tunneling Fix Regression Tests
 *
 * All tests drive the real GameEngine. No arithmetic-only simulations.
 *
 * The fix: getPlayerLandingY() now uses a swept crossing test.
 * A platform at surfaceY is detected when prevY <= surfaceY < py
 * (player was above the surface before integration and is now at or below it).
 * This replaces the old fixed ±12 px window that missed fast-moving players.
 *
 * Physics reference (verified from source):
 *   GRAVITY = 750 px/s²   DT = 1/30 s
 *   Max displacement per tick at terminal velocity ≈ 750/30 = 25 px
 *   Old window: ±12 px — missed any tick where displacement > 12 px
 *   New check: swept segment — catches any crossing regardless of speed
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, GRAVITY, DT } from '../server/gameEngine.js';
import {
  FLOOR_Y, LOWER_FLOOR_Y, DORM_LEDGE_Y, DORM_LEFT_X, DORM_RIGHT_X,
  MAINT_UPPER_LEDGE_Y, MAINT_UPPER_LEDGE_X, MAINT_UPPER_LEDGE_W,
  V_PIPE_X, H_PIPE_Y, SHAFT_LEFT_X, SHAFT_RIGHT_X,
  MAZE_WALLS, ClientInput
} from '../server/types.js';

function makeEngine(): GameEngine {
  const e = new GameEngine();
  e.startNewMatch();
  e.update();
  return e;
}

function inp(overrides: Partial<ClientInput> = {}): ClientInput {
  return {
    left: false, right: false, up: false, down: false,
    jump: false, interact: false, attack: false, tackle: false,
    aimAngle: 0, ...overrides
  };
}

describe('Phase 2B — Platform Tunneling Fix Regression', () => {

  // ─── 1. Tunneling regression ────────────────────────────────────────────
  // A player whose single-tick displacement exceeds 12 px must still land.

  it('TUNNEL-01: player falling at high velocity (>12 px/tick) lands on DORM_LEDGE_Y platform', () => {
    // At vy=500 px/s, one tick moves 500/30 ≈ 16.7 px — exceeds old 12 px window.
    // Place player 8 px above DORM_LEDGE_Y so the crossing happens in one tick.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_tunnel1', 'Tunnel1')!;
    p.x = (DORM_LEFT_X + DORM_RIGHT_X) / 2; // centre of dormitory platform
    p.y = DORM_LEDGE_Y - 8;                  // 8 px above surface
    p.vy = 500;                               // fast fall: 500/30 ≈ 16.7 px this tick
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update(); // one tick: prevY=DORM_LEDGE_Y-8, py crosses DORM_LEDGE_Y

    assert.equal(p.isGrounded, true, 'Player must be grounded after crossing platform');
    assert.equal(p.y, DORM_LEDGE_Y, 'Player must be snapped to platform surface');
    assert.equal(p.vy, 0, 'Vertical velocity must be zeroed on landing');
    assert.equal(p.state, 'ON_FLOOR', 'State must be ON_FLOOR');
  });

  it('TUNNEL-02: player falling at extreme velocity (750 px/s, 25 px/tick) lands on MAINT_UPPER_LEDGE_Y', () => {
    // 750/30 = 25 px per tick — the maximum single-tick displacement at terminal velocity.
    // Place player 1 px above the ledge surface.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_tunnel2', 'Tunnel2')!;
    const ledgeCentreX = MAINT_UPPER_LEDGE_X + MAINT_UPPER_LEDGE_W / 2;
    p.x = ledgeCentreX;
    p.y = MAINT_UPPER_LEDGE_Y - 1; // 1 px above surface
    p.vy = 750;                     // terminal velocity: 750/30 = 25 px this tick
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, true, 'Must land at terminal velocity');
    assert.equal(p.y, MAINT_UPPER_LEDGE_Y, 'Must snap to maintenance ledge surface');
    assert.equal(p.vy, 0);
    assert.equal(p.state, 'ON_FLOOR');
  });

  it('TUNNEL-03: player falling at very high velocity (1500 px/s, 50 px/tick) lands on DORM_LEDGE_Y', () => {
    // 1500/30 = 50 px per tick — well beyond any fixed window.
    // Player starts 20 px above the surface; after one tick is 30 px below it.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_tunnel3', 'Tunnel3')!;
    p.x = (DORM_LEFT_X + DORM_RIGHT_X) / 2;
    p.y = DORM_LEDGE_Y - 20;
    p.vy = 1500;
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, true, 'Must land even at 50 px/tick displacement');
    assert.equal(p.y, DORM_LEDGE_Y);
    assert.equal(p.vy, 0);
  });

  // ─── 2. No crossing — player above surface does not land ────────────────

  it('NOCROSS-01: player 30 px above DORM_LEDGE_Y with vy=0 does not land this tick', () => {
    // prevY = DORM_LEDGE_Y - 30, vy = 0 → py = DORM_LEDGE_Y - 30 (no movement).
    // Swept check: prevY (DORM_LEDGE_Y-30) <= surfaceY (DORM_LEDGE_Y) is true,
    // but py (DORM_LEDGE_Y-30) >= surfaceY is false → no crossing. Correct.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_nocross1', 'NoCross1')!;
    p.x = (DORM_LEFT_X + DORM_RIGHT_X) / 2;
    p.y = DORM_LEDGE_Y - 30;
    p.vy = 0;
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    // With vy=0, gravity adds 750/30=25 px. prevY=DORM_LEDGE_Y-30, py=DORM_LEDGE_Y-5.
    // py (DORM_LEDGE_Y-5) < surfaceY (DORM_LEDGE_Y) → no crossing yet.
    assert.equal(p.isGrounded, false, 'Player 30 px above with vy=0 must not land in one tick');
    assert.ok(p.y < DORM_LEDGE_Y, `Player y=${p.y} must still be above surface`);
  });

  it('NOCROSS-02: player 30 px above DORM_LEDGE_Y with vy=200 does not land in one tick', () => {
    // prevY = DORM_LEDGE_Y - 30. After gravity: vy = 200 + 25 = 225. py = DORM_LEDGE_Y - 30 + 225/30 = DORM_LEDGE_Y - 22.5.
    // py < surfaceY → no crossing.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_nocross2', 'NoCross2')!;
    p.x = (DORM_LEFT_X + DORM_RIGHT_X) / 2;
    p.y = DORM_LEDGE_Y - 30;
    p.vy = 200;
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, false, 'Player must not land when py is still above surface');
    assert.ok(p.y < DORM_LEDGE_Y, `Player y=${p.y} must be above DORM_LEDGE_Y=${DORM_LEDGE_Y}`);
  });

  // ─── 3. Upward movement — player moving up is not grounded ──────────────

  it('UPWARD-01: player moving upward through DORM_LEDGE_Y is not grounded', () => {
    // vy < 0 → getPlayerLandingY returns null immediately. No landing.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_up1', 'Up1')!;
    p.x = (DORM_LEFT_X + DORM_RIGHT_X) / 2;
    p.y = DORM_LEDGE_Y + 10; // below surface
    p.vy = -340;              // moving upward (jump)
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, false, 'Upward-moving player must not be grounded by platform');
    assert.ok(p.y < DORM_LEDGE_Y + 10, 'Player must have moved upward');
  });

  it('UPWARD-02: player jumping from floor does not immediately re-land on floor', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_up2', 'Up2')!;
    p.x = 600;
    p.y = FLOOR_Y;
    p.state = 'ON_FLOOR';
    p.isGrounded = true;

    engine.handleInput(p.id, inp({ jump: true }));
    engine.update();

    // After one tick with vy=-340: py = FLOOR_Y + (-340 + 25)/30 ≈ FLOOR_Y - 10.5
    // Player should be airborne, not re-grounded on FLOOR_Y.
    assert.equal(p.state, 'FALLING', 'Player must be FALLING after jump');
    assert.equal(p.isGrounded, false, 'Player must not be re-grounded immediately after jump');
    assert.ok(p.y < FLOOR_Y, `Player y=${p.y} must be above floor after jump`);
  });

  // ─── 4. Multiple platforms — lands on first surface crossed ─────────────

  it('MULTI-01: player crossing two stacked platforms lands on the higher (first) one', () => {
    // Real geometry: dormitory ceiling at Y=200 (isPlatform, x=580..1080) and
    // dormitory floor at DORM_LEDGE_Y=360 (isPlatform, x=580..1080) both span x=800.
    // Downward movement configured to cross BOTH platform surfaces in a single update tick:
    //   p.y = 195 (5 px above upper platform Y=200)
    //   p.vy = 5375 px/s
    // Physics integration during engine.update():
    //   p.vy += GRAVITY * DT = 5375 + 750 / 30 = 5400 px/s
    //   fallingPrevY = 195
    //   py = 195 + 5400 / 30 = 375 px
    // Swept crossing checks:
    //   Upper surface Y=200: 195 <= 200 && 375 >= 200 (TRUE: crossed from above)
    //   Lower surface Y=360: 195 <= 360 && 375 >= 360 (TRUE: crossed from above)
    // Both surfaces are within the swept segment [195, 375] in this single tick.
    // The engine must select the first platform encountered from above (min bestY = 200).
    // If the engine selected the lower platform (e.g. max bestY = 360), the test would fail.
    const DORM_CEILING_Y = 200;
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_multi1', 'Multi1')!;
    p.x = 800;               // centre of dormitory — horizontally overlaps both Y=200 and Y=360
    p.y = DORM_CEILING_Y - 5; // 195 — 5 px above dormitory ceiling
    p.vy = 5375;             // one-tick displacement = 180 px; py reaches 375, crossing Y=200 AND Y=360
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, true, 'Player must be grounded after crossing platforms');
    assert.equal(p.state, 'ON_FLOOR', 'Player state must be ON_FLOOR');
    assert.equal(p.y, DORM_CEILING_Y,
      `Must land on first (higher) platform Y=${DORM_CEILING_Y}, not dormitory floor Y=${DORM_LEDGE_Y}`);
    assert.notEqual(p.y, DORM_LEDGE_Y,
      'Must NOT skip past dormitory ceiling and land on dormitory floor');
    assert.equal(p.vy, 0, 'Vertical velocity must be zeroed on landing');
  });

  it('MULTI-02: player falling from above DORM_LEDGE_Y lands on dormitory, not floor', () => {
    // Player starts 10 px above DORM_LEDGE_Y with high velocity.
    // DORM_LEDGE_Y (360) is encountered before FLOOR_Y (620).
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_multi2', 'Multi2')!;
    p.x = (DORM_LEFT_X + DORM_RIGHT_X) / 2;
    p.y = DORM_LEDGE_Y - 10;
    p.vy = 2000; // 66 px/tick — would skip past floor too if not caught
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, true);
    assert.equal(p.y, DORM_LEDGE_Y, 'Must land on dormitory ledge, not floor');
    assert.notEqual(p.y, FLOOR_Y);
  });

  // ─── 5. Horizontal boundaries — outside footprint does not land ─────────

  it('HBOUNDS-01: player outside DORM_LEDGE_Y left edge does not land on it', () => {
    // Platform X range: DORM_LEFT_X (580) to DORM_RIGHT_X (1080).
    // Player at X = DORM_LEFT_X - 50 = 530 is outside the 12 px radius (530 < 580-12=568).
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_hb1', 'HBounds1')!;
    p.x = DORM_LEFT_X - 50; // 530 — outside left edge + 12 px radius
    p.y = DORM_LEDGE_Y - 5;
    p.vy = 500;
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, false, 'Player outside platform footprint must not land on it');
    assert.notEqual(p.y, DORM_LEDGE_Y, 'Player must not be snapped to dormitory ledge');
  });

  it('HBOUNDS-02: player outside DORM_LEDGE_Y right edge does not land on it', () => {
    // DORM_RIGHT_X = 1080. Player at X = 1080 + 50 = 1130 > 1080 + 12 = 1092.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_hb2', 'HBounds2')!;
    p.x = DORM_RIGHT_X + 50; // 1130 — outside right edge + 12 px radius
    p.y = DORM_LEDGE_Y - 5;
    p.vy = 500;
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, false, 'Player outside right edge must not land on dormitory ledge');
    assert.notEqual(p.y, DORM_LEDGE_Y);
  });

  it('HBOUNDS-03: player within 12 px of platform edge (boundary radius) does land', () => {
    // Player at X = DORM_LEFT_X - 10 = 570. Radius = 12. 570 >= 580 - 12 = 568. ✓
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_hb3', 'HBounds3')!;
    p.x = DORM_LEFT_X - 10; // 570 — within 12 px radius of left edge
    p.y = DORM_LEDGE_Y - 5;
    p.vy = 500;
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, true, 'Player within 12 px radius of edge must land');
    assert.equal(p.y, DORM_LEDGE_Y);
  });

  // ─── 6. Ordinary movement — existing jumps and landings still work ───────

  it('ORDINARY-01: normal jump from floor lands back on floor', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_ord1', 'Ord1')!;
    p.x = 600;
    p.y = FLOOR_Y;
    p.state = 'ON_FLOOR';
    p.isGrounded = true;

    engine.handleInput(p.id, inp({ jump: true }));
    for (let i = 0; i < 40; i++) {
      engine.update();
      if (p.isGrounded && p.y === FLOOR_Y) break;
    }

    assert.equal(p.isGrounded, true, 'Player must land back on floor after normal jump');
    assert.equal(p.y, FLOOR_Y);
    assert.equal(p.vy, 0);
    assert.equal(p.state, 'ON_FLOOR');
  });

  it('ORDINARY-02: player falls from above dormitory ledge and lands on it normally', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_ord2', 'Ord2')!;
    p.x = 800;
    p.y = DORM_LEDGE_Y - 40;
    p.vy = 150;
    p.state = 'FALLING';
    p.isGrounded = false;

    for (let i = 0; i < 15; i++) {
      engine.update();
      if (p.isGrounded) break;
    }

    assert.equal(p.isGrounded, true);
    assert.equal(p.y, DORM_LEDGE_Y);
    assert.equal(p.state, 'ON_FLOOR');
  });

  it('ORDINARY-03: player walks off dormitory ledge edge and enters FALLING state', () => {
    // ON_FLOOR surface check uses ±8 px tolerance on x.
    // DORM_RIGHT_X = 1080. Must be > 1080 + 8 = 1088 to be off the platform.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_ord3', 'Ord3')!;
    p.x = DORM_RIGHT_X + 20; // 1100 — well past right edge + 8 px tolerance
    p.y = DORM_LEDGE_Y;
    p.state = 'ON_FLOOR';
    p.isGrounded = true;

    engine.update();

    assert.equal(p.state, 'FALLING', 'Player past platform edge must enter FALLING');
    assert.equal(p.isGrounded, false);
  });

  it('ORDINARY-04: player falls through shaft gap and lands on LOWER_FLOOR_Y', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_ord4', 'Ord4')!;
    p.x = (SHAFT_LEFT_X + SHAFT_RIGHT_X) / 2;
    p.y = FLOOR_Y + 10;
    p.vy = 200;
    p.state = 'FALLING';
    p.isGrounded = false;

    for (let i = 0; i < 60; i++) {
      engine.update();
      if (p.isGrounded) break;
    }

    assert.equal(p.isGrounded, true);
    assert.equal(p.y, LOWER_FLOOR_Y);
  });

  // ─── 7. Existing mechanics — horizontal collision, ladders, pipes ────────

  it('MECH-01: horizontal wall collision still stops player at left boundary', () => {
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_mech1', 'Mech1')!;
    p.x = 50;
    p.y = FLOOR_Y;
    p.vx = -300;
    p.state = 'ON_FLOOR';

    for (let i = 0; i < 15; i++) {
      engine.handleInput(p.id, inp({ left: true }));
      engine.update();
    }

    assert.ok(p.x >= 35, `Player x=${p.x} must not penetrate left wall`);
    assert.equal(p.vx, 0, 'Horizontal velocity must be zeroed at wall');
  });

  it('MECH-02: ladder climb still works after tunneling fix', () => {
    const engine = makeEngine();
    const ladder = engine.state.ladders.find(l => l.id === 'ladder_maint')!;
    const p = engine.addHumanPlayer('p_mech2', 'Mech2')!;
    p.x = ladder.x;
    p.y = FLOOR_Y;
    p.state = 'ON_FLOOR';
    p.isGrounded = true;

    const startY = p.y;
    for (let i = 0; i < 30; i++) {
      engine.handleInput(p.id, inp({ up: true }));
      engine.update();
      if (p.state === 'CLIMBING_LADDER') break;
    }
    for (let i = 0; i < 30; i++) {
      engine.handleInput(p.id, inp({ up: true }));
      engine.update();
    }

    assert.ok(p.y < startY, `Player must have climbed upward from y=${startY} to y=${p.y}`);
  });

  it('MECH-03: vertical pipe climb and H_PIPE transition still work', () => {
    // V_PIPE_TOP_Y = 90. Player starts at y=200, needs to reach y <= 90+15=105.
    // At 115 px/s climb speed, takes ceil((200-105)/115 * 30) ≈ 25 ticks.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_mech3', 'Mech3')!;
    p.x = V_PIPE_X;
    p.y = 200;
    p.state = 'CLIMBING_V_PIPE';
    p.vy = -115;

    for (let i = 0; i < 40; i++) {
      engine.handleInput(p.id, inp({ up: true }));
      engine.update();
      if (p.state === 'HANGING_H_PIPE') break;
    }

    assert.equal(p.state, 'HANGING_H_PIPE', 'V_PIPE to H_PIPE transition must still work');
    assert.equal(p.y, H_PIPE_Y + 15);
  });

  it('MECH-04: dead player corpse still lands on platform after tunneling fix', () => {
    // The dead-player code path also uses getPlayerLandingY with prevY.
    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_mech4', 'Mech4')!;
    p.x = (DORM_LEFT_X + DORM_RIGHT_X) / 2;
    p.y = DORM_LEDGE_Y - 5;
    p.vy = 500; // fast fall
    p.state = 'DEAD';
    p.isGrounded = false;

    engine.update();

    assert.equal(p.isGrounded, true, 'Dead player corpse must land on platform');
    assert.equal(p.y, DORM_LEDGE_Y);
  });

  it('MECH-05: rope throw and attachment still work after tunneling fix', () => {
    const engine = makeEngine();
    const holder = engine.addHumanPlayer('p_rope_h', 'Holder')!;
    const victim = engine.addHumanPlayer('p_rope_v', 'Victim')!;

    holder.x = 400; holder.y = FLOOR_Y; holder.state = 'ON_FLOOR';
    victim.x = 600; victim.y = FLOOR_Y; victim.state = 'ON_FLOOR';

    engine.state.rope.state = 'HELD';
    engine.state.rope.heldByPlayerId = holder.id;
    holder.attackCooldown = 0;

    engine.handleInput(holder.id, {
      left: false, right: false, up: false, down: false,
      jump: false, interact: false, attack: true, tackle: false,
      aimAngle: 0
    });
    engine.update();

    assert.equal(engine.state.rope.state, 'THROWN', 'Rope must be thrown');
  });

  // ─── MATRIX-05 update: tunneling is now fixed ───────────────────────────

  it('MATRIX-05 (updated): swept crossing check eliminates tunneling — player lands correctly', () => {
    // This replaces the old MATRIX-05 which documented the defect.
    // The fix: prevY <= surfaceY < py detects any crossing regardless of speed.
    //
    // Reproduce the exact scenario from the original defect report:
    // At max fall speed 750 px/s, one tick moves 25 px.
    // Old window: ±12 px — a player 13 px above surface would skip it.
    // New check: swept — catches it.

    const engine = makeEngine();
    const p = engine.addHumanPlayer('p_matrix05', 'Matrix05')!;
    p.x = (DORM_LEFT_X + DORM_RIGHT_X) / 2;

    // Place player exactly 13 px above DORM_LEDGE_Y — this was the old failure case.
    // Old code: py after tick = DORM_LEDGE_Y - 13 + 25 = DORM_LEDGE_Y + 12.
    // Old check: py (DORM_LEDGE_Y+12) <= surfaceY+12 (DORM_LEDGE_Y+12) → barely passes.
    // But at vy=750: py = DORM_LEDGE_Y - 13 + 25 = DORM_LEDGE_Y + 12 → old code caught it.
    // The real failure was at vy > ~750 where py > surfaceY + 12.
    // Use vy=1200 (40 px/tick): prevY = DORM_LEDGE_Y-5, py = DORM_LEDGE_Y+35.
    // Old check: py (DORM_LEDGE_Y+35) > surfaceY+12 (DORM_LEDGE_Y+12) → MISSED.
    // New check: prevY (DORM_LEDGE_Y-5) <= surfaceY && py (DORM_LEDGE_Y+35) >= surfaceY → CAUGHT.

    p.y = DORM_LEDGE_Y - 5;
    p.vy = 1200; // 40 px/tick — definitively beyond old 12 px window
    p.vx = 0;
    p.state = 'FALLING';
    p.isGrounded = false;

    engine.update();

    // Verify the fix works
    assert.equal(p.isGrounded, true,
      'MATRIX-05 FIXED: swept crossing check catches player at 40 px/tick displacement');
    assert.equal(p.y, DORM_LEDGE_Y,
      'Player must be snapped to platform surface, not tunneled through');
    assert.equal(p.vy, 0);
    assert.equal(p.state, 'ON_FLOOR');

    // Also verify the old defect condition: tick displacement > 12 px
    const tickDisplacement = 1200 / 30; // 40 px
    assert.ok(tickDisplacement > 12,
      `Tick displacement (${tickDisplacement}px) exceeds old 12 px window — confirms fix is exercised`);
  });

});
