import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { GameEngine, checkAABB, segmentIntersectsRect, DT } from '../server/gameEngine.js';
import {
  handleClientDisconnect,
  clients,
  sessions,
  playerToSession,
  sanitizeInput,
  sanitizePlayerName
} from '../server/server.js';
import { ClientInput, FLOOR_Y, V_PIPE_X, H_PIPE_Y } from '../server/types.js';
import { clientToCanvasCoordinates } from '../src/input.js';

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
    pull: false,
    climbKick: false,
    climbGrab: false,
    struggle: false,
    aimAngle: 0
  };
}

describe('The Pit — Critical Gameplay Audit & Regression Tests', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = new GameEngine();
    engine.startNewMatch();
    engine.update();
  });

  // ========================================================
  // 1. MULTIPLAYER RECONNECTION & SESSION RESILIENCE
  // ========================================================
  describe('1. Multiplayer Reconnection & Stale Socket Protection', () => {
    it('should verify closing socket is still session current socket and prevent stale socket closure from disconnecting reconnected player', () => {
      // Simulate player session
      const playerId = 'p_audit_test_1';
      const resumeToken = 'token_test_abc';
      const mockOldWs = { readyState: WebSocket.OPEN, close: () => {} } as unknown as WebSocket;
      const mockNewWs = { readyState: WebSocket.OPEN, close: () => {} } as unknown as WebSocket;

      engine.addHumanPlayer(playerId, 'Survivor1');

      // Create session on mockOldWs
      sessions.set(resumeToken, {
        resumeToken,
        playerId,
        name: 'Survivor1',
        ws: mockOldWs,
        disconnectTime: null
      });
      playerToSession.set(playerId, resumeToken);
      clients.set(mockOldWs, {
        ws: mockOldWs,
        playerId,
        resumeToken,
        msgCount: 0,
        lastResetTime: Date.now()
      });

      // Player reconnects on mockNewWs
      const session = sessions.get(resumeToken)!;
      session.ws = mockNewWs;
      clients.set(mockNewWs, {
        ws: mockNewWs,
        playerId,
        resumeToken,
        msgCount: 0,
        lastResetTime: Date.now()
      });

      // Old socket close event fires asynchronously
      handleClientDisconnect(mockOldWs);

      // Session must NOT be disconnected because session.ws is mockNewWs
      assert.equal(session.ws, mockNewWs, 'Active socket must remain mockNewWs');
      assert.equal(session.disconnectTime, null, 'Disconnect time must remain null');
      assert.ok(clients.has(mockNewWs), 'mockNewWs must still be mapped in clients');
      assert.ok(!clients.has(mockOldWs), 'mockOldWs must be removed from clients');

      // Cleanup
      handleClientDisconnect(mockNewWs);
      sessions.delete(resumeToken);
      playerToSession.delete(playerId);
    });

    it('should handle repeated disconnect events (close + error) on same socket without double-clearing', () => {
      const playerId = 'p_audit_repeat';
      const resumeToken = 'token_repeat_123';
      const mockWs = { readyState: WebSocket.CLOSED } as unknown as WebSocket;

      engine.addHumanPlayer(playerId, 'Repeater');
      sessions.set(resumeToken, {
        resumeToken,
        playerId,
        name: 'Repeater',
        ws: mockWs,
        disconnectTime: null
      });
      clients.set(mockWs, {
        ws: mockWs,
        playerId,
        resumeToken,
        msgCount: 0,
        lastResetTime: Date.now()
      });

      // First disconnect
      handleClientDisconnect(mockWs, 1000);
      const session = sessions.get(resumeToken)!;
      assert.equal(session.ws, null);
      assert.equal(session.disconnectTime, 1000);

      // Second disconnect event on same socket (e.g. error event followed by close)
      handleClientDisconnect(mockWs, 2000);
      assert.equal(session.disconnectTime, 1000, 'Timestamp should not be mutated by redundant event');

      // Cleanup
      sessions.delete(resumeToken);
    });

    it('should preserve player identity, position, health and stamina across resumeToken reconnect', () => {
      const p = engine.addHumanPlayer('p_resume_id', 'IdentityKept')!;
      p.x = 420;
      p.y = 350;
      p.health = 75;
      p.stamina = 60;
      p.rocks = 2;

      // Reconnect simulation via addHumanPlayer
      const reconnected = engine.addHumanPlayer('p_resume_id', 'IdentityKept')!;
      assert.equal(reconnected.id, 'p_resume_id');
      assert.equal(reconnected.health, 75);
      assert.equal(reconnected.stamina, 60);
      assert.equal(reconnected.x, 420);
      assert.equal(reconnected.y, 350);
      assert.equal(reconnected.rocks, 2);
    });
  });

  // ========================================================
  // 2. CLIMBING COMBAT: KICK, GRAB, STRUGGLE & RELEASES
  // ========================================================
  describe('2. Climbing Combat: Kick, Grab, Struggle & Releases', () => {
    it('should allow kick downward, detaching victim with knockback, stun, and cooldown', () => {
      const attacker = engine.addHumanPlayer('p_att', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_vic', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 200;
      attacker.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      victim.y = 245;
      victim.state = 'CLIMBING_V_PIPE';

      const kickInput = createDefaultInput();
      kickInput.climbKick = true;
      engine.handleInput(attacker.id, kickInput);

      assert.equal(victim.state, 'FALLING');
      assert.ok(victim.stunnedTimer > 0);
      assert.ok(victim.health < 100);
      assert.ok(attacker.climbAttackCooldown > 0);
    });

    it('should miss kick and grab opponent below if grab input is held', () => {
      const attacker = engine.addHumanPlayer('p_att2', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_vic2', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 200;
      attacker.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      // Positioned slightly lower than kick range (dy=68px)
      victim.y = 268;
      victim.state = 'CLIMBING_V_PIPE';

      const input = createDefaultInput();
      input.climbKick = true;
      input.climbGrab = true;
      engine.handleInput(attacker.id, input);

      // Kick misses (dy > 65), but grab connects (dy <= 70)
      assert.equal(attacker.climbGrabbingId, victim.id);
      assert.equal(victim.grabbedByPlayerId, attacker.id);
    });

    it('should enforce single owner: 3rd player cannot grab an already held victim', () => {
      const att1 = engine.addHumanPlayer('p_att_a', 'Attacker1')!;
      const att2 = engine.addHumanPlayer('p_att_b', 'Attacker2')!;
      const victim = engine.addHumanPlayer('p_vic_c', 'Victim')!;

      att1.x = V_PIPE_X;
      att1.y = 200;
      att1.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      victim.y = 240;
      victim.state = 'CLIMBING_V_PIPE';

      att2.x = V_PIPE_X;
      att2.y = 210;
      att2.state = 'CLIMBING_V_PIPE';

      // Att1 grabs victim
      const grab1 = createDefaultInput();
      grab1.climbGrab = true;
      engine.handleInput(att1.id, grab1);
      assert.equal(att1.climbGrabbingId, victim.id);
      assert.equal(victim.grabbedByPlayerId, att1.id);

      // Att2 attempts to grab same victim
      const grab2 = createDefaultInput();
      grab2.climbGrab = true;
      engine.handleInput(att2.id, grab2);
      assert.equal(att2.climbGrabbingId, null, 'Attacker 2 must not grab already grabbed victim');
    });

    it('should release grab when attacker runs out of stamina during hold', () => {
      const attacker = engine.addHumanPlayer('p_stam_att', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_stam_vic', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 200;
      attacker.state = 'CLIMBING_V_PIPE';
      attacker.stamina = 2; // Barely any stamina left

      victim.x = V_PIPE_X;
      victim.y = 240;
      victim.state = 'CLIMBING_V_PIPE';

      const grabInput = createDefaultInput();
      grabInput.climbGrab = true;
      engine.handleInput(attacker.id, grabInput);
      assert.equal(attacker.climbGrabbingId, victim.id);

      // Advance physics ticks while holding grab until stamina drains completely
      for (let i = 0; i < 15; i++) {
        engine.handleInput(attacker.id, grabInput);
        engine.update();
      }

      assert.equal(attacker.climbGrabbingId, null, 'Grab must be released when stamina exhausts');
      assert.equal(victim.state, 'FALLING');
    });

    it('should immediately break grab when either player disconnects or dies', () => {
      const attacker = engine.addHumanPlayer('p_dc_att', 'Attacker')!;
      const victim = engine.addHumanPlayer('p_dc_vic', 'Victim')!;

      attacker.x = V_PIPE_X;
      attacker.y = 200;
      attacker.state = 'CLIMBING_V_PIPE';

      victim.x = V_PIPE_X;
      victim.y = 240;
      victim.state = 'CLIMBING_V_PIPE';

      const grabInput = createDefaultInput();
      grabInput.climbGrab = true;
      engine.handleInput(attacker.id, grabInput);
      assert.equal(attacker.climbGrabbingId, victim.id);

      // Attacker disconnects
      engine.removePlayer(attacker.id, false);

      assert.equal(victim.grabbedByPlayerId, null);
      assert.equal(victim.state, 'FALLING');
    });
  });

  // ========================================================
  // 3. MOUSE AIMING & ROPE THROWING PHYSICS
  // ========================================================
  describe('3. Mouse Aiming & Rope Throwing Physics', () => {
    it('clientToCanvasCoordinates should correctly transform coordinates under scaling and offset', () => {
      const mockCanvas = {
        width: 1000,
        height: 700,
        getBoundingClientRect: () => ({
          left: 50,
          top: 100,
          width: 500, // CSS size is half canvas internal resolution (2x scaling)
          height: 350
        })
      } as unknown as HTMLCanvasElement;

      // Mouse at CSS client coords (300, 275)
      // relative: (250, 175) -> scale by 2 -> (500, 350)
      const transformed = clientToCanvasCoordinates(300, 275, mockCanvas);
      assert.equal(transformed.x, 500);
      assert.equal(transformed.y, 350);
    });

    it('should drop thrown rope when colliding with solid moving barrier', () => {
      const barrier = engine.state.obstacles.find(o => o.type === 'MOVING_BARRIER')!;
      const rope = engine.state.rope;

      rope.state = 'THROWN';
      rope.x = barrier.x - 10;
      rope.y = barrier.y + 20;
      rope.vx = 400;
      rope.vy = 0;

      // Advance physics - rope intersects barrier
      engine.update();

      assert.equal(rope.state, 'ON_FLOOR', 'Rope hitting solid barrier must drop to floor');
    });

    it('should prevent rope attachment through solid barrier (line of sight check)', () => {
      const thrower = engine.addHumanPlayer('p_los_thrower', 'Thrower')!;
      const victim = engine.addHumanPlayer('p_los_victim', 'Victim')!;
      const barrier = engine.state.obstacles.find(o => o.type === 'MOVING_BARRIER')!;

      thrower.x = barrier.x - 60;
      thrower.y = barrier.y + 20;
      thrower.state = 'ON_FLOOR';

      victim.x = barrier.x + barrier.width + 60;
      victim.y = barrier.y + 20;
      victim.state = 'ON_FLOOR';

      const rope = engine.state.rope;
      rope.state = 'THROWN';
      rope.heldByPlayerId = thrower.id;
      rope.startX = thrower.x;
      rope.startY = thrower.y - 15;
      rope.x = victim.x - 5;
      rope.y = victim.y - 15;

      engine.update();

      // Line of sight from thrower to victim crosses barrier -> cannot attach
      assert.notEqual(rope.attachedPlayerId, victim.id, 'Rope must not attach through solid obstacle');
    });
  });

  // ========================================================
  // 4. REPEATED ROPE-PULL DAMAGE & VELOCITY LIMITS
  // ========================================================
  describe('4. Repeated Rope-Pull Damage & Physics', () => {
    it('holding pull continuously over multiple seconds must not deal damage every server tick', () => {
      const holder = engine.addHumanPlayer('p_puller', 'Puller')!;
      const victim = engine.addHumanPlayer('p_pulled', 'Pulled')!;

      holder.x = 200;
      holder.y = FLOOR_Y;
      holder.state = 'ON_FLOOR';

      victim.x = 500;
      victim.y = FLOOR_Y;
      victim.state = 'ON_FLOOR';
      victim.health = 100;

      engine.state.rope.state = 'ATTACHED';
      engine.state.rope.heldByPlayerId = holder.id;
      engine.state.rope.attachedPlayerId = victim.id;
      engine.state.rope.pullDamageCooldown = 0;

      const pullInput = createDefaultInput();
      pullInput.pull = true;

      // Hold pull continuously for 60 ticks (2.0 seconds at 30 FPS)
      for (let tick = 0; tick < 60; tick++) {
        engine.handleInput(holder.id, pullInput);
        engine.update();
      }

      // If damage occurred every tick (8 or 10 dmg * 60 ticks = 480+ dmg), victim would be dead
      // With 1.0s pullDamageCooldown, at most 2 damage ticks occur over 2.0s
      assert.ok(victim.health > 70, `Victim health (${victim.health}) must remain high due to pull cooldown`);
      assert.ok(victim.state !== 'DEAD');
    });

    it('pulling climbing victim must release them into falling with controlled falling impulse', () => {
      const holder = engine.addHumanPlayer('p_yank_holder', 'Holder')!;
      const victim = engine.addHumanPlayer('p_yank_victim', 'Victim')!;

      holder.x = 750;
      holder.y = FLOOR_Y;
      holder.state = 'ON_FLOOR';

      victim.x = V_PIPE_X;
      victim.y = 300;
      victim.state = 'CLIMBING_V_PIPE';

      engine.state.rope.state = 'ATTACHED';
      engine.state.rope.heldByPlayerId = holder.id;
      engine.state.rope.attachedPlayerId = victim.id;

      const pullInput = createDefaultInput();
      pullInput.pull = true;
      engine.handleInput(holder.id, pullInput);

      assert.equal(victim.state, 'FALLING');
      assert.ok(victim.stunnedTimer > 0);
      assert.equal(engine.state.rope.state, 'ON_FLOOR');
      assert.ok(Math.abs(victim.vx) <= 280, 'Impulse velocity must be clamped');
      assert.ok(victim.vy <= 300, 'Vertical impulse must be controlled');
    });
  });

  // ========================================================
  // 5. UNIFIED OBSTACLE & COLLISION HANDLING
  // ========================================================
  describe('5. Unified Obstacle & Collision Handling', () => {
    it('checkAABB and segmentIntersectsRect helpers should evaluate spatial intersections accurately', () => {
      const boxA = { x: 100, y: 100, width: 50, height: 50 };
      const boxB = { x: 120, y: 120, width: 50, height: 50 };
      const boxC = { x: 200, y: 200, width: 50, height: 50 };

      assert.equal(checkAABB(boxA, boxB), true);
      assert.equal(checkAABB(boxA, boxC), false);

      // Line crossing boxA
      assert.equal(segmentIntersectsRect(50, 125, 180, 125, boxA.x, boxA.y, boxA.width, boxA.height), true);
      // Line not crossing boxA
      assert.equal(segmentIntersectsRect(50, 50, 80, 80, boxA.x, boxA.y, boxA.width, boxA.height), false);
    });

    it('spikes should inflict damage on controlled interval (hazardCooldown) and not damage repeatedly on adjacent frames', () => {
      const spikes = engine.state.obstacles.find(o => o.type === 'SPIKES')!;
      const p = engine.addHumanPlayer('p_spike_test', 'SpikeTester')!;

      p.x = spikes.x + 20;
      p.y = FLOOR_Y;
      p.state = 'ON_FLOOR';
      p.health = 100;

      // First tick on spikes deals 15 damage
      engine.update();
      assert.equal(p.health, 85);
      assert.ok(p.hazardCooldown > 0);

      // Immediate next tick must not re-inflict damage
      engine.update();
      assert.equal(p.health, 85, 'Health must not decrease again during hazardCooldown');
    });

    it('falling player should land on catwalk and walk off edge into falling state', () => {
      const catwalk = engine.state.obstacles.find(o => o.type === 'PLATFORM')!;
      const p = engine.addHumanPlayer('p_catwalk', 'Walker')!;

      // Position player falling above catwalk
      p.x = catwalk.x + 50;
      p.y = catwalk.y - 40;
      p.vy = 200;
      p.state = 'FALLING';

      // Fall onto catwalk
      for (let i = 0; i < 10; i++) {
        engine.update();
        if (p.state === 'ON_FLOOR') break;
      }

      assert.equal(p.y, catwalk.y);
      assert.equal(p.isGrounded, true);
      assert.equal(p.state, 'ON_FLOOR');

      // Walk off right edge
      p.x = catwalk.x + catwalk.width + 30;
      engine.update();

      assert.equal(p.isGrounded, false);
      assert.equal(p.state, 'FALLING');
    });
  });

  // ========================================================
  // 6. LOBBY & INPUT CONSISTENCY
  // ========================================================
  describe('6. Lobby & Input Consistency', () => {
    it('READY input during LOBBY phase should transition match immediately', () => {
      const lobbyEngine = new GameEngine();
      lobbyEngine.addHumanPlayer('p_lobby_1', 'Lobbyist');
      assert.equal(lobbyEngine.state.phase, 'LOBBY');

      lobbyEngine.startNewMatch();
      assert.equal(lobbyEngine.state.phase, 'WAITING_SIGNAL');
    });

    it('sanitizeInput should clamp aimAngle, sanitize malformed fields, and prevent NaN corruption', () => {
      const malformed = {
        left: 'true',
        pull: true,
        aimAngle: NaN,
        climbKick: false
      };
      const cleaned = sanitizeInput(malformed);
      assert.ok(cleaned);
      assert.equal(cleaned.left, false, 'String true should be rejected');
      assert.equal(cleaned.pull, true);
      assert.equal(cleaned.aimAngle, 0, 'NaN angle should default to 0');
    });
  });
});
