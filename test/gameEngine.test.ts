import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/gameEngine.js';
import { sanitizeInput, sanitizePlayerName, strictBool } from '../server/server.js';
import { MAX_PLAYERS, ClientInput, FLOOR_Y, V_PIPE_X, H_PIPE_Y, H_PIPE_EXIT_X } from '../server/types.js';

function createDefaultInput(): ClientInput {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    interact: false,
    attack: false,
    tackle: false,
    aimAngle: 0
  };
}

describe('The Pit - Complete Multiplayer Audit & Unit Tests', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = new GameEngine();
    engine.startNewMatch();
    engine.update(); // Flush initial CLANG sound event from match startup
  });

  // ========================================================
  // 1. PLAYER NAME SANITIZATION & VALIDATION
  // ========================================================
  describe('Player Name Sanitization & Validation', () => {
    it('should accept valid player names', () => {
      assert.equal(sanitizePlayerName('Prisoner 1'), 'Prisoner 1');
      assert.equal(sanitizePlayerName('EscapeArtist'), 'EscapeArtist');
      assert.equal(sanitizePlayerName('  Surya  '), 'Surya');
    });

    it('should reject empty or whitespace-only names', () => {
      assert.equal(sanitizePlayerName(''), null);
      assert.equal(sanitizePlayerName('   '), null);
      assert.equal(sanitizePlayerName(null), null);
      assert.equal(sanitizePlayerName(undefined), null);
      assert.equal(sanitizePlayerName(123), null);
      assert.equal(sanitizePlayerName({}), null);
    });

    it('should truncate and clamp names longer than 16 characters', () => {
      const longName = 'ThisIsAVeryLongPrisonerNameExceeding16Chars';
      const sanitized = sanitizePlayerName(longName);
      assert.ok(sanitized);
      assert.equal(sanitized.length, 16);
      assert.equal(sanitized, 'ThisIsAVeryLongP');
    });

    it('should strip dangerous HTML and control characters', () => {
      const xssName = '<script>alert("hack")</script>';
      const sanitized = sanitizePlayerName(xssName);
      assert.ok(sanitized);
      assert.equal(sanitized.includes('<'), false);
      assert.equal(sanitized.includes('>'), false);
      assert.equal(sanitized.includes('"'), false);
    });
  });

  // ========================================================
  // 2. STRICT INPUT & BOOLEAN VALIDATION (ANTI-COERCION)
  // ========================================================
  describe('Strict Input & Boolean Validation', () => {
    it('strictBool should only accept literal true and reject strings like "false"', () => {
      assert.equal(strictBool(true), true);
      assert.equal(strictBool(false), false);
      assert.equal(strictBool('false'), false, 'String "false" must not evaluate to true!');
      assert.equal(strictBool('true'), false, 'String "true" must not evaluate to true!');
      assert.equal(strictBool(1), false);
      assert.equal(strictBool(0), false);
      assert.equal(strictBool(null), false);
      assert.equal(strictBool(undefined), false);
    });

    it('sanitizeInput should reject loose string booleans and accept strict booleans', () => {
      const looseMalformed = {
        left: 'false',
        right: 'true',
        jump: true,
        aimAngle: 1.2
      };
      const sanitized = sanitizeInput(looseMalformed);
      assert.ok(sanitized);
      assert.equal(sanitized.left, false, 'String "false" must not coerce to true');
      assert.equal(sanitized.right, false, 'String "true" must not coerce to true');
      assert.equal(sanitized.jump, true, 'Literal boolean true must be preserved');
      assert.equal(sanitized.aimAngle, 1.2);
    });

    it('sanitizeInput should safely handle NaN, Infinity and clamp excessive angles', () => {
      assert.equal(sanitizeInput(null), null);
      assert.equal(sanitizeInput('invalid'), null);

      const withNaN = sanitizeInput({ left: true, aimAngle: NaN });
      assert.ok(withNaN);
      assert.equal(withNaN.aimAngle, 0, 'NaN aimAngle must default to 0');

      const withInfinity = sanitizeInput({ aimAngle: Infinity });
      assert.ok(withInfinity);
      assert.equal(withInfinity.aimAngle, 0, 'Infinity aimAngle must default to 0');

      const excessive = sanitizeInput({ aimAngle: 50 });
      assert.ok(excessive);
      assert.ok(excessive.aimAngle <= Math.PI * 2, 'Angle must be clamped to 2*PI');
    });
  });

  // ========================================================
  // 3. CAPACITY, CONCURRENCY & RECONNECTION
  // ========================================================
  describe('Player Capacity, Concurrency & Reconnection', () => {
    it('should allow up to 10 humans and reject the 11th human', () => {
      for (let i = 1; i <= 10; i++) {
        const p = engine.addHumanPlayer(`p_${i}`, `Prisoner ${i}`);
        assert.ok(p, `Player ${i} should be allowed`);
        assert.equal(p.isBot, false);
      }
      assert.equal(engine.state.players.length, MAX_PLAYERS);

      // 11th human must be rejected
      const excess = engine.addHumanPlayer('p_11', 'Excess Prisoner');
      assert.equal(excess, null, '11th player must be rejected when room is full');
      assert.equal(engine.state.players.length, MAX_PLAYERS);
    });

    it('should reconnect existing player without duplicating character or consuming extra slot', () => {
      const p1 = engine.addHumanPlayer('p_1', 'Original Name');
      assert.ok(p1);
      assert.equal(engine.state.players.length, 1);

      // Reconnect with same ID
      const reconnected = engine.addHumanPlayer('p_1', 'Updated Name');
      assert.equal(reconnected?.id, p1.id);
      assert.equal(reconnected?.name, 'Updated Name');
      assert.equal(engine.state.players.length, 1, 'Slot count must not increase on reconnect');
    });

    it('should handle disconnects without corrupting active match state', () => {
      const p1 = engine.addHumanPlayer('p_1', 'Player 1')!;
      p1.health = 80;
      p1.state = 'ON_FLOOR';

      // Temporary disconnect during match
      engine.removePlayer('p_1', false);
      assert.equal(engine.state.players.length, 1, 'Slot is preserved during temporary disconnect grace period');
      assert.equal(p1.vx, 0, 'Velocity stopped on disconnect');

      // Permanent disconnect (session expired)
      engine.removePlayer('p_1', true);
      assert.equal(engine.state.players.length, 0, 'Slot released on permanent session expiry');
    });

    it('should allow players to join an active match safely if under capacity', () => {
      engine.state.phase = 'WAITING_SIGNAL';
      const latePlayer = engine.addHumanPlayer('p_late', 'Late Arrival');
      assert.ok(latePlayer);
      assert.equal(latePlayer.health, 100);
      assert.equal(latePlayer.state, 'ON_FLOOR');
      assert.equal(engine.state.phase, 'WAITING_SIGNAL', 'Joining match should not reset active phase');
    });
  });

  // ========================================================
  // 4. ROPE MECHANICS & DISCONNECT CLEANUP
  // ========================================================
  describe('Rope Mechanics & Disconnect Cleanup', () => {
    it('should cleanly drop rope to floor if holder disconnects', () => {
      const p1 = engine.addHumanPlayer('p_1', 'Holder')!;
      engine.state.rope.state = 'HELD';
      engine.state.rope.heldByPlayerId = p1.id;

      // Disconnect holder
      engine.removePlayer(p1.id, false);

      assert.equal(engine.state.rope.state, 'ON_FLOOR', 'Rope must drop to floor when holder disconnects');
      assert.equal(engine.state.rope.heldByPlayerId, null);
    });

    it('should cleanly release rope if attached victim disconnects', () => {
      const thrower = engine.addHumanPlayer('p_1', 'Thrower')!;
      const victim = engine.addHumanPlayer('p_2', 'Victim')!;

      engine.state.rope.state = 'ATTACHED';
      engine.state.rope.heldByPlayerId = thrower.id;
      engine.state.rope.attachedPlayerId = victim.id;

      // Disconnect victim
      engine.removePlayer(victim.id, false);

      assert.equal(engine.state.rope.state, 'ON_FLOOR', 'Rope must return to floor when victim disconnects');
      assert.equal(engine.state.rope.attachedPlayerId, null);
    });

    it('should attach rope to climbing victim without auto-pulling until explicit yank command', () => {
      const thrower = engine.addHumanPlayer('p_thrower', 'Thrower')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      victim.x = V_PIPE_X;
      victim.y = 300;
      victim.state = 'CLIMBING_V_PIPE';

      thrower.x = V_PIPE_X - 100;
      thrower.y = FLOOR_Y;
      thrower.state = 'ON_FLOOR';
      engine.state.rope.state = 'HELD';
      engine.state.rope.heldByPlayerId = thrower.id;

      // Throw rope
      const aim = Math.atan2(victim.y - thrower.y, victim.x - thrower.x);
      const throwInput = createDefaultInput();
      throwInput.attack = true;
      throwInput.aimAngle = aim;
      engine.handleInput(thrower.id, throwInput);

      assert.equal(engine.state.rope.state, 'THROWN');

      // Simulate contact
      engine.state.rope.x = victim.x - 5;
      engine.state.rope.y = victim.y;
      engine.state.rope.vx = 0;
      engine.state.rope.vy = 0;
      engine.update();

      assert.equal(engine.state.rope.state, 'ATTACHED');
      assert.equal(engine.state.rope.attachedPlayerId, victim.id);

      // Verify NO auto-pull
      engine.update();
      assert.equal(victim.state, 'CLIMBING_V_PIPE', 'Victim must not be auto-pulled without input');

      // Explicit yank via tackle key
      const pullInput = createDefaultInput();
      pullInput.tackle = true;
      engine.handleInput(thrower.id, pullInput);

      assert.equal(victim.state, 'FALLING');
      assert.ok(victim.stunnedTimer > 0);
      assert.equal(engine.state.rope.state, 'ON_FLOOR');
    });

    it('should allow picking up rope with E and dropping with E when held', () => {
      const player = engine.addHumanPlayer('p_picker', 'Picker')!;
      engine.state.rope.state = 'ON_FLOOR';
      engine.state.rope.x = 200;
      engine.state.rope.y = FLOOR_Y;
      player.x = 210;
      player.y = FLOOR_Y;

      // Pick up with E
      const pickupInput = createDefaultInput();
      pickupInput.interact = true;
      engine.handleInput(player.id, pickupInput);

      assert.equal(engine.state.rope.state, 'HELD');
      assert.equal(engine.state.rope.heldByPlayerId, player.id);

      // Drop with E
      const dropInput = createDefaultInput();
      dropInput.interact = true;
      engine.handleInput(player.id, dropInput);

      assert.equal(engine.state.rope.state, 'ON_FLOOR');
      assert.equal(engine.state.rope.heldByPlayerId, null);
    });

    it('should attach rope to standing player on floor, drag on pull, and release with E', () => {
      const holder = engine.addHumanPlayer('p_holder', 'Holder')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      holder.x = 200;
      holder.y = FLOOR_Y;
      victim.x = 350;
      victim.y = FLOOR_Y;
      victim.state = 'ON_FLOOR';

      engine.state.rope.state = 'HELD';
      engine.state.rope.heldByPlayerId = holder.id;

      // Throw at victim
      const aim = Math.atan2(victim.y - holder.y, victim.x - holder.x);
      const throwInput = createDefaultInput();
      throwInput.attack = true;
      throwInput.aimAngle = aim;
      engine.handleInput(holder.id, throwInput);

      assert.equal(engine.state.rope.state, 'THROWN');

      // Rope reaches victim
      engine.state.rope.x = victim.x - 5;
      engine.state.rope.y = victim.y - 15;
      engine.state.rope.vx = 0;
      engine.state.rope.vy = 0;
      engine.update();

      assert.equal(engine.state.rope.state, 'ATTACHED');
      assert.equal(engine.state.rope.attachedPlayerId, victim.id);

      // Pull victim
      const pullInput = createDefaultInput();
      pullInput.pull = true;
      engine.handleInput(holder.id, pullInput);

      assert.equal(engine.state.rope.pulling, true);
      assert.ok(victim.vx < 0, 'Victim should be dragged leftward toward holder');

      // Release with E
      const releaseInput = createDefaultInput();
      releaseInput.interact = true;
      engine.handleInput(holder.id, releaseInput);

      assert.equal(engine.state.rope.state, 'ON_FLOOR');
      assert.equal(engine.state.rope.attachedPlayerId, null);
    });

    it('should enforce tether distance constraint so victim cannot exceed max rope length', () => {
      const holder = engine.addHumanPlayer('p_holder', 'Holder')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      holder.x = 200;
      holder.y = FLOOR_Y;
      victim.x = 200 + 400; // Beyond 280 max tether distance
      victim.y = FLOOR_Y;

      engine.state.rope.state = 'ATTACHED';
      engine.state.rope.heldByPlayerId = holder.id;
      engine.state.rope.attachedPlayerId = victim.id;

      engine.update();

      const dist = Math.hypot(victim.x - holder.x, victim.y - holder.y);
      assert.ok(dist <= 281, `Tether constraint failed: distance ${dist} exceeded 280`);
    });

    it('should drop rope when projectile hits moving security barrier', () => {
      const thrower = engine.addHumanPlayer('p_thrower', 'Thrower')!;
      thrower.x = 650;
      thrower.y = FLOOR_Y;

      const barrier = engine.state.obstacles.find(o => o.type === 'MOVING_BARRIER')!;
      barrier.y = 520;

      engine.state.rope.state = 'THROWN';
      engine.state.rope.heldByPlayerId = thrower.id;
      engine.state.rope.x = barrier.x + 2;
      engine.state.rope.y = barrier.y + 10;

      engine.update();

      assert.equal(engine.state.rope.state, 'ON_FLOOR', 'Rope hitting barrier must drop to floor');
    });
  });

  // ========================================================
  // 5. AUTHORITATIVE DAMAGE & DEATH TRANSITIONS
  // ========================================================
  describe('Authoritative Damage & Death Transitions', () => {
    it('should eliminate player and reset rope across all damage sources', () => {
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;

      engine.state.rope.state = 'HELD';
      engine.state.rope.heldByPlayerId = victim.id;

      // 1. Rock damage (20 HP)
      engine.damagePlayer(victim, 20, attacker);
      assert.equal(victim.health, 80);
      assert.equal(victim.state, 'ON_FLOOR');

      // 2. Tackle damage (15 HP)
      engine.damagePlayer(victim, 15, attacker);
      assert.equal(victim.health, 65);

      // 3. Lethal damage (65 HP -> 0 HP)
      engine.damagePlayer(victim, 65, attacker);
      assert.equal(victim.health, 0);
      assert.equal(victim.state, 'DEAD');
      assert.equal(attacker.sabotages, 1, 'Killer should be credited with sabotage');
      assert.equal(engine.state.rope.state, 'ON_FLOOR', 'Rope dropped when holder dies');
      assert.equal(engine.state.rope.heldByPlayerId, null);
    });

    it('disabled controls for dead players', () => {
      const p = engine.addHumanPlayer('p_dead', 'Dead Player')!;
      engine.damagePlayer(p, 100);
      assert.equal(p.state, 'DEAD');

      const input = createDefaultInput();
      input.left = true;
      input.jump = true;
      engine.handleInput(p.id, input);

      assert.equal(p.vx, 0);
      assert.equal(p.state, 'DEAD');
    });
  });

  // ========================================================
  // 6. DETERMINISTIC ESCAPE QUOTA RESOLUTION & SIMULTANEOUS ENTRIES
  // ========================================================
  describe('Deterministic Escape Quota Enforcement', () => {
    it('should resolve simultaneous escape attempts deterministically by position', () => {
      engine.state.phase = 'SIGNAL_ACTIVE';
      engine.state.signalQuota = 1;
      engine.state.signalEscapedCount = 0;

      // P1 is deeper in the hatch duct (x = 80)
      const p1 = engine.addHumanPlayer('p_deep', 'Deep Player')!;
      p1.x = 80;
      p1.y = H_PIPE_Y + 15;
      p1.state = 'HANGING_H_PIPE';

      // P2 is closer to threshold (x = 110)
      const p2 = engine.addHumanPlayer('p_close', 'Close Player')!;
      p2.x = 110;
      p2.y = H_PIPE_Y + 15;
      p2.state = 'HANGING_H_PIPE';

      // Authoritative tick resolution
      engine.resolveEscapeAttempts();

      // P1 (deeper) should escape
      assert.equal(p1.hasEscaped, true, 'Deeper player must be granted the 1 escape slot');
      assert.equal(p1.state, 'ESCAPED');
      assert.equal(engine.state.signalEscapedCount, 1);

      // P2 (second entrant beyond quota) must be sniped deterministically!
      assert.equal(p2.hasEscaped, false);
      assert.equal(p2.state, 'DEAD', 'Excess simultaneous entrant must be sniped by Overseer');
      assert.equal(p2.health, 0);
    });

    it('should deterministically tie-break simultaneous entrants at the exact same coordinate', () => {
      engine.state.phase = 'SIGNAL_ACTIVE';
      engine.state.signalQuota = 1;
      engine.state.signalEscapedCount = 0;

      // Both players at exact same position x = 100
      const pA = engine.addHumanPlayer('p_aaa', 'Player A')!;
      pA.x = 100;
      pA.y = H_PIPE_Y + 15;
      pA.state = 'HANGING_H_PIPE';

      const pB = engine.addHumanPlayer('p_bbb', 'Player B')!;
      pB.x = 100;
      pB.y = H_PIPE_Y + 15;
      pB.state = 'HANGING_H_PIPE';

      engine.resolveEscapeAttempts();

      // Exactly 1 escapes, exactly 1 is sniped (never both escaping or double quota)
      assert.equal(engine.state.signalEscapedCount, 1, 'Quota must strictly equal 1');
      const escapedCount = [pA, pB].filter(p => p.hasEscaped).length;
      const deadCount = [pA, pB].filter(p => p.state === 'DEAD').length;
      assert.equal(escapedCount, 1);
      assert.equal(deadCount, 1);
    });

    it('should snipe any player attempting escape when quota is exhausted', () => {
      engine.state.phase = 'SIGNAL_ACTIVE';
      engine.state.signalQuota = 1;
      engine.state.signalEscapedCount = 1; // Exhausted

      const late = engine.addHumanPlayer('p_late', 'Late Player')!;
      late.x = 100;
      late.y = H_PIPE_Y + 15;
      late.state = 'HANGING_H_PIPE';

      engine.resolveEscapeAttempts();

      assert.equal(late.state, 'DEAD');
      assert.equal(late.health, 0);
      assert.equal(late.hasEscaped, false);
    });

    it('should not harm traversers who have not entered the exit threshold', () => {
      engine.state.phase = 'SIGNAL_ACTIVE';
      engine.state.signalQuota = 1;
      engine.state.signalEscapedCount = 0;

      const escaper = engine.addHumanPlayer('p_esc', 'Escaper')!;
      escaper.x = 100; // <= H_PIPE_EXIT_X (130)
      escaper.y = H_PIPE_Y + 15;
      escaper.state = 'HANGING_H_PIPE';

      const bystander = engine.addHumanPlayer('p_bystander', 'Bystander')!;
      bystander.x = 180; // Not at exit (> 130)
      bystander.y = H_PIPE_Y + 15;
      bystander.state = 'HANGING_H_PIPE';
      bystander.health = 100;

      engine.resolveEscapeAttempts();

      assert.equal(escaper.hasEscaped, true);
      assert.equal(bystander.hasEscaped, false);
      assert.equal(bystander.health, 100, 'Bystander must not take damage');
      assert.equal(bystander.state, 'HANGING_H_PIPE');
    });
  });

  // ========================================================
  // 7. LOBBY LIFECYCLE
  // ========================================================
  describe('Lobby Lifecycle & Match Start Policy', () => {
    it('should remain in lobby waiting for prisoners when 0 or 1 player joins', () => {
      const lobbyEngine = new GameEngine();
      assert.equal(lobbyEngine.state.phase, 'LOBBY');

      lobbyEngine.update();
      assert.equal(lobbyEngine.state.phase, 'LOBBY');

      lobbyEngine.addHumanPlayer('p_solo', 'Solo Player');
      lobbyEngine.update();
      assert.equal(lobbyEngine.state.phase, 'LOBBY', 'Single player should stay in lobby without abrupt start');
    });

    it('should begin countdown and start match when 2 or more players join lobby', () => {
      const lobbyEngine = new GameEngine();
      lobbyEngine.addHumanPlayer('p_1', 'Player 1');
      lobbyEngine.addHumanPlayer('p_2', 'Player 2');

      lobbyEngine.update();
      assert.equal(lobbyEngine.state.phase, 'LOBBY');
      assert.ok(lobbyEngine.state.lobbyCountdown > 0, 'Countdown should be active');

      // Force countdown to finish
      for (let i = 0; i < 30 * 16; i++) {
        lobbyEngine.update();
        if (lobbyEngine.state.phase !== 'LOBBY') break;
      }

      assert.equal(lobbyEngine.state.phase, 'WAITING_SIGNAL', 'Match should transition to WAITING_SIGNAL');
    });
  });

  // ========================================================
  // 8. ENVIRONMENTAL HAZARDS & OBSTACLES
  // ========================================================
  describe('Environmental Hazards & Obstacles', () => {
    it('should land falling player on maze platform and drop player when walking off edge', () => {
      const player = engine.addHumanPlayer('p_catwalk', 'Catwalker')!;

      // Position player falling above dormitory ledge platform (DORM_LEDGE_Y = 360)
      player.x = 800;
      player.y = 300;
      player.vy = 200;
      player.state = 'FALLING';

      // Simulate physics ticks until landing
      for (let i = 0; i < 15; i++) {
        engine.update();
        if (player.state === 'ON_FLOOR') break;
      }

      assert.equal(player.state, 'ON_FLOOR', 'Player must land on elevated platform');
      assert.equal(player.y, 360, 'Player Y must align with platform surface');
      assert.equal(player.isGrounded, true);

      // Walk off right edge of dorm ledge (DORM_RIGHT_X = 1100)
      player.x = 1150;
      engine.update();

      assert.equal(player.state, 'FALLING', 'Walking off platform edge must trigger falling');
      assert.equal(player.isGrounded, false);
    });

    it('should oscillate moving security barrier and block horizontal movement', () => {
      const barrier = engine.state.obstacles.find(o => o.type === 'MOVING_BARRIER')!;
      const initialY = barrier.y;

      // Update engine for multiple ticks to verify oscillation
      for (let i = 0; i < 30; i++) {
        engine.update();
      }
      assert.notEqual(barrier.y, initialY, 'Security barrier must move/oscillate');

      // Test solid blocking of player moving right towards barrier
      const runner = engine.addHumanPlayer('p_runner', 'Runner')!;
      runner.x = barrier.x - 10;
      runner.y = barrier.y + 20;
      runner.vx = 200;

      engine.update();

      assert.ok(runner.x <= barrier.x - 15, 'Barrier must physically block player horizontal passage');
      assert.equal(runner.vx, 0, 'Horizontal velocity must be stopped by barrier');
    });

    it('should generate ceiling warning, drop falling rock, and damage/stun player on impact', () => {
      const victim = engine.addHumanPlayer('p_rock_victim', 'RockVictim')!;
      victim.x = 450;
      victim.y = FLOOR_Y;
      victim.state = 'ON_FLOOR';
      const startHealth = victim.health;

      // Inject a falling rock right above victim
      engine.state.fallingRocks.push({
        id: 'test_rock_1',
        x: victim.x,
        y: FLOOR_Y - 40,
        vy: 300,
        radius: 14,
        state: 'FALLING',
        timer: 1.0,
        active: true
      });

      engine.update();

      assert.ok(victim.health < startHealth, 'Falling rock impact must inflict damage');
      assert.ok(victim.stunnedTimer > 0, 'Falling rock impact must stun player');
    });
  });

  // ========================================================
  // 9. CLIMBING COMBAT: KICK, GRAB & PULL-DOWN
  // ========================================================
  describe('Climbing Combat: Kick, Grab & Pull-Down', () => {
    it('should allow a climbing player to kick downward, detaching victim below with knockback and damage', () => {
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 250;
      attacker.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      victim.y = 290; // Strictly beneath attacker (dy = 40 <= 65)
      victim.state = 'CLIMBING_V_PIPE';
      const initialHealth = victim.health;

      const kickInput = createDefaultInput();
      kickInput.tackle = true;
      kickInput.climbKick = true;
      engine.handleInput(attacker.id, kickInput);

      assert.equal(victim.state, 'FALLING', 'Kicked victim must detach from pipe into falling state');
      assert.ok(victim.vy > 0, 'Victim should receive downward knockback');
      assert.ok(victim.vx < 0, 'Victim should be knocked away from wall pipe');
      assert.ok(victim.health < initialHealth, 'Kick must inflict damage');
      assert.ok(victim.stunnedTimer > 0, 'Kick must apply stun');
      assert.ok(attacker.climbAttackCooldown > 0, 'Attacker must enter recovery cooldown');
    });

    it('should NOT hit players positioned above or too far away', () => {
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;
      const abovePlayer = engine.addHumanPlayer('p_above', 'AbovePlayer')!;
      const farPlayer = engine.addHumanPlayer('p_far', 'FarPlayer')!;

      attacker.x = V_PIPE_X;
      attacker.y = 350;
      attacker.state = 'CLIMBING_V_PIPE';

      abovePlayer.x = V_PIPE_X;
      abovePlayer.y = 300; // Positioned ABOVE attacker
      abovePlayer.state = 'CLIMBING_V_PIPE';

      farPlayer.x = V_PIPE_X;
      farPlayer.y = 480; // Positioned too far below (> 65px)
      farPlayer.state = 'CLIMBING_V_PIPE';

      const kickInput = createDefaultInput();
      kickInput.tackle = true;
      kickInput.climbKick = true;
      engine.handleInput(attacker.id, kickInput);

      assert.equal(abovePlayer.state, 'CLIMBING_V_PIPE', 'Player above must not be hit');
      assert.equal(abovePlayer.health, 100);
      assert.equal(farPlayer.state, 'CLIMBING_V_PIPE', 'Player too far below must not be hit');
      assert.equal(farPlayer.health, 100);
    });

    it('should enforce attack cooldown and recovery preventing kick spamming', () => {
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 250;
      attacker.state = 'CLIMBING_V_PIPE';
      attacker.climbAttackCooldown = 0.6; // In active cooldown

      victim.x = V_PIPE_X;
      victim.y = 290;
      victim.state = 'CLIMBING_V_PIPE';

      const kickInput = createDefaultInput();
      kickInput.tackle = true;
      kickInput.climbKick = true;
      engine.handleInput(attacker.id, kickInput);

      assert.equal(victim.state, 'CLIMBING_V_PIPE', 'Attack in cooldown must not execute kick');
      assert.equal(victim.health, 100);
    });

    it('should grab nearby player beneath attacker when kick misses and grab input is held', () => {
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 250;
      attacker.state = 'CLIMBING_V_PIPE';

      // Position victim within grab range (dy = 68 <= 70)
      victim.x = V_PIPE_X;
      victim.y = 318;
      victim.state = 'CLIMBING_V_PIPE';

      const grabInput = createDefaultInput();
      grabInput.tackle = true;
      grabInput.climbGrab = true;
      engine.handleInput(attacker.id, grabInput);

      assert.equal(attacker.climbGrabbingId, victim.id, 'Attacker should lock grab on victim');
      assert.equal(victim.grabbedByPlayerId, attacker.id, 'Victim should be marked as grabbed');
    });

    it('should fail grab cleanly without affecting attacker if no valid victim is in range', () => {
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;
      attacker.x = V_PIPE_X;
      attacker.y = 250;
      attacker.state = 'CLIMBING_V_PIPE';

      const grabInput = createDefaultInput();
      grabInput.tackle = true;
      grabInput.climbGrab = true;
      engine.handleInput(attacker.id, grabInput);

      assert.equal(attacker.climbGrabbingId, null, 'Grab must fail when no victim is near');
      assert.equal(attacker.state, 'CLIMBING_V_PIPE');
    });

    it('should hold and drag grabbed victim downward along the pipe', () => {
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 200;
      attacker.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      victim.y = 242;
      victim.state = 'CLIMBING_V_PIPE';

      attacker.climbGrabbingId = victim.id;
      victim.grabbedByPlayerId = attacker.id;

      // Attacker holds grab and presses DOWN
      const dragInput = createDefaultInput();
      dragInput.climbGrab = true;
      dragInput.down = true;
      engine.handleInput(attacker.id, dragInput);

      // Simulate physics ticks
      for (let i = 0; i < 5; i++) {
        engine.update();
      }

      assert.ok(attacker.y > 200, 'Attacker should move downward while dragging');
      assert.equal(victim.y, attacker.y + 42, 'Victim must remain attached directly beneath attacker');
    });

    it('should allow victim to struggle, build struggle meter, and break free with counter-stun', () => {
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 250;
      attacker.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      victim.y = 292;
      victim.state = 'CLIMBING_V_PIPE';

      attacker.climbGrabbingId = victim.id;
      victim.grabbedByPlayerId = attacker.id;
      victim.struggleMeter = 0;

      // Victim struggles repeatedly
      const struggleInput = createDefaultInput();
      struggleInput.struggle = true;

      for (let i = 0; i < 4; i++) {
        engine.handleInput(victim.id, struggleInput);
      }

      assert.equal(victim.grabbedByPlayerId, null, 'Victim should break free when meter fills');
      assert.equal(attacker.climbGrabbingId, null, 'Attacker should drop grab');
      assert.ok(attacker.stunnedTimer > 0, 'Attacker must be counter-stunned on break-free');
    });

    it('should drop victim into falling state when attacker releases grab input', () => {
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 250;
      attacker.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      victim.y = 292;
      victim.state = 'CLIMBING_V_PIPE';

      attacker.climbGrabbingId = victim.id;
      victim.grabbedByPlayerId = attacker.id;

      // Attacker releases grab
      const releaseInput = createDefaultInput();
      releaseInput.climbGrab = false;
      releaseInput.tackle = false;
      engine.handleInput(attacker.id, releaseInput);

      assert.equal(attacker.climbGrabbingId, null);
      assert.equal(victim.grabbedByPlayerId, null);
      assert.equal(victim.state, 'FALLING', 'Victim must fall when grab is released');
    });

    it('should immediately break grab when attacker takes damage', () => {
      const attacker = engine.addHumanPlayer('p_attacker', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 250;
      attacker.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      victim.y = 292;
      victim.state = 'CLIMBING_V_PIPE';

      attacker.climbGrabbingId = victim.id;
      victim.grabbedByPlayerId = attacker.id;

      // Attacker takes damage
      engine.damagePlayer(attacker, 20);

      assert.equal(attacker.climbGrabbingId, null, 'Grab must be broken when attacker takes damage');
      assert.equal(victim.grabbedByPlayerId, null);
      assert.equal(victim.state, 'FALLING');
    });

    it('should prevent multiple players from grabbing the same victim or a grabbed victim from grabbing', () => {
      const attacker1 = engine.addHumanPlayer('p_att1', 'Attacker 1')!;
      const victim = engine.addHumanPlayer('p_victim', 'Victim')!;
      const attacker2 = engine.addHumanPlayer('p_att2', 'Attacker 2')!;
      const thirdPlayer = engine.addHumanPlayer('p_third', 'Third Player')!;

      attacker1.x = V_PIPE_X;
      attacker1.y = 200;
      attacker1.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      victim.y = 250;
      victim.state = 'CLIMBING_V_PIPE';

      attacker2.x = V_PIPE_X;
      attacker2.y = 210;
      attacker2.state = 'CLIMBING_V_PIPE';

      thirdPlayer.x = V_PIPE_X;
      thirdPlayer.y = 300;
      thirdPlayer.state = 'CLIMBING_V_PIPE';

      // Attacker 1 grabs victim
      attacker1.climbGrabbingId = victim.id;
      victim.grabbedByPlayerId = attacker1.id;

      // Attacker 2 tries to grab the same victim
      const grabInput = createDefaultInput();
      grabInput.tackle = true;
      grabInput.climbGrab = true;
      engine.handleInput(attacker2.id, grabInput);

      assert.equal(attacker2.climbGrabbingId, null, 'Second attacker must not be able to grab already grabbed victim');

      // Grabbed victim tries to grab third player below
      engine.handleInput(victim.id, grabInput);
      assert.equal(victim.climbGrabbingId, null, 'Grabbed victim must not be able to grab others');
    });
  });

  // ========================================================
  // 10. PHYSICAL LADDER SYSTEM
  // ========================================================
  describe('Physical Ladder System', () => {
    it('should pick up nearby ladder with E key', () => {
      const p = engine.addHumanPlayer('p_ladder_user', 'Climber')!;
      const ladder = engine.state.ladders[0]; // ladder_maint at x=160, y=FLOOR_Y - 90
      p.x = ladder.x;
      p.y = FLOOR_Y;
      p.state = 'ON_FLOOR';

      const input = createDefaultInput();
      input.interact = true;
      engine.handleInput(p.id, input);

      assert.equal(ladder.state, 'CARRIED');
      assert.equal(ladder.carriedByPlayerId, p.id);
      assert.equal(p.carryingLadderId, ladder.id);
    });

    it('should reject pickup if player is too far from ladder', () => {
      const p = engine.addHumanPlayer('p_far_user', 'FarClimber')!;
      const ladder = engine.state.ladders[0];
      p.x = ladder.x + 300;
      p.y = FLOOR_Y;
      p.state = 'ON_FLOOR';

      const input = createDefaultInput();
      input.interact = true;
      engine.handleInput(p.id, input);

      assert.equal(ladder.state, 'PLACED');
      assert.equal(p.carryingLadderId, null);
    });

    it('should carry ladder with player position updates', () => {
      const p = engine.addHumanPlayer('p_carrier', 'Carrier')!;
      const ladder = engine.state.ladders[0];
      p.x = ladder.x;
      p.y = FLOOR_Y;

      engine.tryPickupLadder(p);
      assert.equal(p.carryingLadderId, ladder.id);

      // Move player
      p.x = 900;
      p.y = FLOOR_Y;
      engine.update();

      assert.equal(ladder.x, 900);
      assert.equal(ladder.y, FLOOR_Y - ladder.height);
    });

    it('should drop ladder on E key and validate placement', () => {
      const p = engine.addHumanPlayer('p_dropper', 'Dropper')!;
      const ladder = engine.state.ladders[0];
      p.x = ladder.x;
      p.y = FLOOR_Y;

      engine.tryPickupLadder(p);
      assert.equal(ladder.state, 'CARRIED');

      // Walk to new position and drop with E
      p.x = 750;
      p.y = FLOOR_Y;
      const dropInput = createDefaultInput();
      dropInput.interact = true;
      engine.handleInput(p.id, dropInput);

      assert.equal(ladder.state, 'PLACED');
      assert.equal(ladder.carriedByPlayerId, null);
      assert.equal(p.carryingLadderId, null);
      assert.equal(ladder.x, 750);
      assert.equal(ladder.isPlaced, true, 'Placement near floor must be valid');
    });

    it('should allow climbing a validly placed ladder with UP key', () => {
      const p = engine.addHumanPlayer('p_climber', 'Climber')!;
      const ladder = engine.state.ladders[0];
      ladder.x = 500;
      ladder.y = FLOOR_Y - ladder.height;
      ladder.state = 'PLACED';
      ladder.isPlaced = true;

      p.x = 500;
      p.y = FLOOR_Y;
      p.state = 'ON_FLOOR';

      const upInput = createDefaultInput();
      upInput.up = true;
      engine.handleInput(p.id, upInput);

      assert.equal(p.state, 'CLIMBING_LADDER');
      assert.equal(p.x, ladder.x);

      // Climbing up decreases Y
      engine.handleInput(p.id, upInput);
      assert.ok(p.vy < 0, 'Climbing ladder should move player upward');
    });

    it('should dismount ladder into falling when pressing left or right', () => {
      const p = engine.addHumanPlayer('p_dismount', 'Dismounter')!;
      const ladder = engine.state.ladders[0];
      ladder.x = 500;
      ladder.y = FLOOR_Y - ladder.height;
      ladder.state = 'PLACED';
      ladder.isPlaced = true;

      p.x = 500;
      p.y = FLOOR_Y - 40;
      p.state = 'CLIMBING_LADDER';

      const leftInput = createDefaultInput();
      leftInput.left = true;
      engine.handleInput(p.id, leftInput);

      assert.equal(p.state, 'FALLING');
      assert.ok(p.vx < 0);
    });

    it('should drop carried ladder when player dies', () => {
      const p = engine.addHumanPlayer('p_dying', 'Victim')!;
      const ladder = engine.state.ladders[0];
      p.x = ladder.x;
      p.y = FLOOR_Y;

      engine.tryPickupLadder(p);
      assert.equal(ladder.state, 'CARRIED');

      engine.damagePlayer(p, 100);
      assert.equal(p.state, 'DEAD');
      assert.equal(p.carryingLadderId, null);
      assert.equal(ladder.state, 'PLACED');
    });

    it('should drop carried ladder when player disconnects', () => {
      const p = engine.addHumanPlayer('p_disconnect', 'Quitter')!;
      const ladder = engine.state.ladders[0];
      p.x = ladder.x;
      p.y = FLOOR_Y;

      engine.tryPickupLadder(p);
      assert.equal(ladder.state, 'CARRIED');

      engine.removePlayer(p.id);
      assert.equal(ladder.state, 'PLACED');
      assert.equal(ladder.carriedByPlayerId, null);
    });
  });
});

