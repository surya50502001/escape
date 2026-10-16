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

      thrower.x = 800;
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
    it('should land falling player on catwalk platform and drop player when walking off edge', () => {
      const player = engine.addHumanPlayer('p_catwalk', 'Catwalker')!;
      const catwalk = engine.state.obstacles.find(o => o.type === 'PLATFORM')!;

      // Position player falling above catwalk
      player.x = catwalk.x + 30;
      player.y = catwalk.y - 40;
      player.vy = 200;
      player.state = 'FALLING';

      // Simulate physics ticks until landing
      for (let i = 0; i < 10; i++) {
        engine.update();
        if (player.state === 'ON_FLOOR') break;
      }

      assert.equal(player.state, 'ON_FLOOR', 'Player must land on elevated catwalk');
      assert.equal(player.y, catwalk.y, 'Player Y must align with catwalk surface');
      assert.equal(player.isGrounded, true);

      // Walk off right edge of catwalk
      player.x = catwalk.x + catwalk.width + 25;
      engine.update();

      assert.equal(player.state, 'FALLING', 'Walking off catwalk edge must trigger falling');
      assert.equal(player.isGrounded, false);
    });

    it('should inflict spike damage and knock upward when player steps into spiked floor', () => {
      const player = engine.addHumanPlayer('p_spiked', 'SpikeVictim')!;
      const spikes = engine.state.obstacles.find(o => o.type === 'SPIKES')!;

      player.x = spikes.x + 20;
      player.y = FLOOR_Y;
      player.state = 'ON_FLOOR';
      const initialHealth = player.health;

      engine.update();

      assert.ok(player.health < initialHealth, 'Spikes must inflict damage');
      assert.ok(player.vy < 0, 'Spikes must launch player upward');
      assert.equal(player.state, 'FALLING');
    });

    it('should cycle steam vent and damage/launch player upward when ACTIVE', () => {
      const player = engine.addHumanPlayer('p_steamed', 'SteamVictim')!;
      const vent = engine.state.obstacles.find(o => o.type === 'STEAM_VENT')!;

      // Force vent into ACTIVE state
      vent.state = 'ACTIVE';
      vent.timer = 2.5;

      player.x = vent.x + vent.width / 2;
      player.y = FLOOR_Y;
      player.state = 'ON_FLOOR';
      const initialHealth = player.health;

      engine.update();

      assert.ok(player.health < initialHealth, 'Active steam vent must deal damage');
      assert.ok(player.vy < 0, 'Active steam vent must blast player upward');
      assert.equal(player.state, 'FALLING');
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
});
