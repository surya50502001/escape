import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntroSequence } from '../server/campaign/introSequence.js';
import { CampaignSession } from '../server/campaign/campaignSession.js';
import { Player } from '../server/types.js';

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
});
