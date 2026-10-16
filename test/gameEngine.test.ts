import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../server/gameEngine.js';
import { sanitizeInput } from '../server/server.js';
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

describe('The Pit - Game Engine Audit & Unit Tests', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = new GameEngine();
    engine.ensureTenPlayers();
    engine.startNewMatch();
    engine.update(); // Flush initial CLANG sound event from match startup
  });

  // ========================================================
  // 1. PLAYER CAPACITY & BOT REPLACEMENT POLICY
  // ========================================================
  describe('Player Capacity & Bot Replacement Policy', () => {
    it('should never exceed MAX_PLAYERS (10)', () => {
      assert.equal(engine.state.players.length, MAX_PLAYERS);
    });

    it('should replace an existing bot when a human joins at capacity', () => {
      const initialBotCount = engine.state.players.filter(p => p.isBot).length;
      assert.equal(initialBotCount, 10);

      const human = engine.addHumanPlayer('human_1', 'Player 1');
      assert.ok(human);
      assert.equal(engine.state.players.length, MAX_PLAYERS);
      assert.equal(engine.state.players.filter(p => !p.isBot).length, 1);
      assert.equal(engine.state.players.filter(p => p.isBot).length, 9);
    });

    it('should allow up to 10 humans and reject the 11th human', () => {
      for (let i = 1; i <= 10; i++) {
        const h = engine.addHumanPlayer(`human_${i}`, `Player ${i}`);
        assert.ok(h, `Human ${i} should be accepted`);
      }
      assert.equal(engine.state.players.length, MAX_PLAYERS);
      assert.equal(engine.state.players.filter(p => !p.isBot).length, 10);

      // 11th human must be rejected
      const excess = engine.addHumanPlayer('human_11', 'Excess Player');
      assert.equal(excess, null, '11th player must be rejected when room is full of humans');
      assert.equal(engine.state.players.length, MAX_PLAYERS);
    });

    it('should safely reconnect existing player without consuming an extra slot', () => {
      const p1 = engine.addHumanPlayer('human_1', 'Player 1');
      assert.ok(p1);
      const reconnected = engine.addHumanPlayer('human_1', 'Player 1 New Name');
      assert.equal(reconnected?.id, p1?.id);
      assert.equal(reconnected?.name, 'Player 1 New Name');
      assert.equal(engine.state.players.length, MAX_PLAYERS);
    });
  });

  // ========================================================
  // 2. SOUND EVENT DELIVERY
  // ========================================================
  describe('Sound Event Delivery', () => {
    it('should retain sound events emitted between ticks for client broadcast', () => {
      // Emit sound asynchronously
      engine.emitSound({ type: 'TACKLE', x: 200, y: FLOOR_Y });
      engine.emitSound({ type: 'GUNSHOT', x: 100, y: 100 });

      // Run game tick
      engine.update();

      // Events must be present in state.soundEvents
      assert.equal(engine.state.soundEvents.length, 2);
      assert.equal(engine.state.soundEvents[0].type, 'TACKLE');
      assert.equal(engine.state.soundEvents[1].type, 'GUNSHOT');

      // Next tick without new events should clear state.soundEvents so sounds do not loop
      engine.update();
      assert.equal(engine.state.soundEvents.length, 0);
    });
  });

  // ========================================================
  // 3. ROPE STATE MACHINE
  // ========================================================
  describe('Rope Mechanics & State Transitions', () => {
    it('should start on the floor and allow pickup within range', () => {
      const p1 = engine.addHumanPlayer('human_1', 'Player 1')!;
      engine.state.rope.x = 450;
      engine.state.rope.y = FLOOR_Y;
      engine.state.rope.state = 'ON_FLOOR';

      // Move player near rope
      p1.x = 460;
      p1.y = FLOOR_Y;
      p1.state = 'ON_FLOOR';

      const input = createDefaultInput();
      input.interact = true;
      engine.handleInput(p1.id, input);

      assert.equal(engine.state.rope.state, 'HELD');
      assert.equal(engine.state.rope.heldByPlayerId, p1.id);
    });

    it('should throw rope and attach to victim without auto-pulling', () => {
      const p1 = engine.addHumanPlayer('human_1', 'Thrower')!;
      const victim = engine.state.players.find(p => p.id !== p1.id)!;

      // Position victim climbing the vertical pipe
      victim.x = V_PIPE_X;
      victim.y = 300;
      victim.state = 'CLIMBING_V_PIPE';

      // P1 holds rope and throws it
      p1.x = 800;
      p1.y = FLOOR_Y;
      p1.state = 'ON_FLOOR';
      engine.state.rope.state = 'HELD';
      engine.state.rope.heldByPlayerId = p1.id;

      // Aim angle toward victim
      const aim = Math.atan2(victim.y - p1.y, victim.x - p1.x);
      const throwInput = createDefaultInput();
      throwInput.attack = true;
      throwInput.aimAngle = aim;
      engine.handleInput(p1.id, throwInput);

      assert.equal(engine.state.rope.state, 'THROWN');

      // Position rope right next to victim to simulate flight hit
      engine.state.rope.x = victim.x - 5;
      engine.state.rope.y = victim.y;
      engine.update();

      assert.equal(engine.state.rope.state, 'ATTACHED');
      assert.equal(engine.state.rope.attachedPlayerId, victim.id);

      // Verify that victim is NOT automatically pulled just by existing
      engine.update();
      assert.equal(victim.state, 'CLIMBING_V_PIPE', 'Target should NOT be auto-pulled without input');

      // Now thrower sends explicit pull (tackle key)
      const pullInput = createDefaultInput();
      pullInput.tackle = true;
      engine.handleInput(p1.id, pullInput);

      // Victim should now be yanked off pipe to FALLING with stun
      assert.equal(victim.state, 'FALLING');
      assert.ok(victim.stunnedTimer > 0);
      assert.equal(engine.state.rope.state, 'ON_FLOOR', 'Rope should return to floor after pull');
    });

    it('should cleanly drop rope if holder dies', () => {
      const p1 = engine.addHumanPlayer('human_1', 'Holder')!;
      engine.state.rope.state = 'HELD';
      engine.state.rope.heldByPlayerId = p1.id;

      // Deal lethal damage to holder
      engine.damagePlayer(p1, 100);

      assert.equal(p1.state, 'DEAD');
      assert.equal(engine.state.rope.state, 'ON_FLOOR');
      assert.equal(engine.state.rope.heldByPlayerId, null);
    });
  });

  // ========================================================
  // 4. HEALTH & DEATH TRANSITIONS
  // ========================================================
  describe('Authoritative Health & Death Handling', () => {
    it('should transition player to DEAD at 0 health and disable inputs', () => {
      const p1 = engine.addHumanPlayer('human_1', 'Target')!;
      p1.health = 25;
      p1.state = 'ON_FLOOR';

      engine.damagePlayer(p1, 25);

      assert.equal(p1.health, 0);
      assert.equal(p1.state, 'DEAD');

      // Dead player cannot move
      const moveInput = createDefaultInput();
      moveInput.right = true;
      moveInput.jump = true;
      engine.handleInput(p1.id, moveInput);

      assert.equal(p1.vx, 0);
      assert.equal(p1.state, 'DEAD');
    });
  });

  // ========================================================
  // 5. ESCAPE QUOTA ENFORCEMENT WITHOUT FALSE POSITIVES
  // ========================================================
  describe('Escape Quota Enforcement', () => {
    it('should allow player at exit to escape without punishing nearby traversers', () => {
      engine.state.phase = 'SIGNAL_ACTIVE';
      engine.state.signalQuota = 1;
      engine.state.signalEscapedCount = 0;

      const escaper = engine.addHumanPlayer('human_1', 'Escaper')!;
      const bystander = engine.state.players.find(p => p.id !== escaper.id)!;

      // Bystander is traversing at x = 160 (nearby on pipe, but NOT in hatch threshold)
      bystander.x = 160;
      bystander.y = H_PIPE_Y + 15;
      bystander.state = 'HANGING_H_PIPE';
      bystander.health = 100;

      // Escaper reaches exact exit threshold at x = 120 (<= H_PIPE_EXIT_X)
      escaper.x = 120;
      escaper.y = H_PIPE_Y + 15;
      escaper.state = 'HANGING_H_PIPE';

      const escaperInput = createDefaultInput();
      escaperInput.left = true;
      engine.handleInput(escaper.id, escaperInput);

      // Escaper must escape safely
      assert.equal(escaper.hasEscaped, true);
      assert.equal(escaper.state, 'ESCAPED');
      assert.equal(engine.state.signalEscapedCount, 1);

      // Bystander must NOT be sniped or harmed!
      assert.equal(bystander.state, 'HANGING_H_PIPE');
      assert.equal(bystander.health, 100);
      assert.equal(bystander.hasEscaped, false);
    });

    it('should snipe a player who attempts escape when quota is exhausted', () => {
      engine.state.phase = 'SIGNAL_ACTIVE';
      engine.state.signalQuota = 1;
      engine.state.signalEscapedCount = 1; // Quota already filled

      const latePlayer = engine.addHumanPlayer('human_late', 'Late')!;
      latePlayer.x = 120; // At exit threshold
      latePlayer.y = H_PIPE_Y + 15;
      latePlayer.state = 'HANGING_H_PIPE';

      const input = createDefaultInput();
      input.left = true;
      engine.handleInput(latePlayer.id, input);

      assert.equal(latePlayer.state, 'DEAD');
      assert.equal(latePlayer.health, 0);
      assert.equal(latePlayer.hasEscaped, false);
    });
  });

  // ========================================================
  // 6. WEBSOCKET INPUT SANITIZATION
  // ========================================================
  describe('Input Sanitization & Validation', () => {
    it('should sanitize malformed and non-finite inputs safely', () => {
      assert.equal(sanitizeInput(null), null);
      assert.equal(sanitizeInput('invalid'), null);

      const sanitizedNaN = sanitizeInput({
        left: true,
        aimAngle: NaN
      });
      assert.ok(sanitizedNaN);
      assert.equal(sanitizedNaN.left, true);
      assert.equal(sanitizedNaN.aimAngle, 0, 'NaN aimAngle must default to 0');

      const sanitizedInfinity = sanitizeInput({
        right: 'truthy_value',
        aimAngle: Infinity
      });
      assert.ok(sanitizedInfinity);
      assert.equal(sanitizedInfinity.right, true);
      assert.equal(sanitizedInfinity.aimAngle, 0, 'Infinity aimAngle must default to 0');

      const clampedAngle = sanitizeInput({
        aimAngle: 100 // Exceeds 2*PI
      });
      assert.ok(clampedAngle);
      assert.ok(clampedAngle.aimAngle <= Math.PI * 2);
    });
  });
});
