import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GameEngine, HATCH_ZONE } from '../server/gameEngine.js';

describe('Overseer Lifecycle, Sniper Execution & Terminal States', () => {

  it('should announce match guidelines at match start and overseer quote at signal active', () => {
    const engine = new GameEngine();
    engine.addHumanPlayer('p1', 'Alice');
    engine.addHumanPlayer('p2', 'Bob');

    engine.startNewMatch();
    assert.strictEqual(engine.state.phase, 'WAITING_SIGNAL');
    assert.match(engine.state.announcementText, /ANONYMOUS GUARDS THE UPPER HATCH/);

    // Transition to SIGNAL_ACTIVE via authoritative triggerSignalActive
    engine.triggerSignalActive(1);
    engine.update();

    assert.strictEqual(engine.state.phase, 'SIGNAL_ACTIVE');
    assert.match(engine.state.announcementText, /ANONYMOUS: "I WILL TAKE 1 PRISONER/);
  });

  it('should snipe player attempting escape before the hatch is open', () => {
    const engine = new GameEngine();
    const p1 = engine.addHumanPlayer('p1', 'Alice')!;
    engine.startNewMatch();

    assert.strictEqual(engine.state.phase, 'WAITING_SIGNAL');

    // Alice reaches the hatch opening while phase is WAITING_SIGNAL (hatch sealed)
    p1.state = 'HANGING_H_PIPE';
    p1.x = 40;
    p1.y = 105;

    engine.update();

    // Alice should be sniped
    assert.strictEqual(p1.state, 'DEAD', 'Premature escape attempt must be sniped by Overseer');
    assert.strictEqual(p1.health, 0, 'Health must be reduced to 0');
    assert.strictEqual(p1.hasEscaped, false, 'Player must not escape through closed hatch');

    // Check shot recorded from overseer muzzle
    assert.ok(engine.state.recentShots.length > 0, 'Sniper shot must be registered in recentShots');
    const shot = engine.state.recentShots[0];
    assert.strictEqual(shot.targetId, p1.id);
    assert.strictEqual(shot.fromX, HATCH_ZONE.x + 73, 'Shot must originate from Overseer rifle muzzle X');
    assert.strictEqual(shot.fromY, HATCH_ZONE.y + 59, 'Shot must originate from Overseer rifle muzzle Y');
  });

  it('should allow valid escape during SIGNAL_ACTIVE, fill quota, and snipe subsequent entrants', () => {
    const engine = new GameEngine();
    const p1 = engine.addHumanPlayer('p1', 'Alice')!;
    const p2 = engine.addHumanPlayer('p2', 'Bob')!;
    engine.startNewMatch();

    // Transition to SIGNAL_ACTIVE
    engine.triggerSignalActive(1);
    engine.update();
    assert.strictEqual(engine.state.phase, 'SIGNAL_ACTIVE');

    // Alice reaches the hatch first
    p1.state = 'HANGING_H_PIPE';
    p1.x = 40;
    p1.y = 105;

    engine.update();

    assert.strictEqual(p1.hasEscaped, true, 'First player should escape during SIGNAL_ACTIVE');
    assert.strictEqual(p1.state, 'ESCAPED');
    assert.strictEqual(engine.state.totalEscapedCount, 1, 'Total escaped count should be 1');

    // Bob reaches the hatch after quota is filled
    p2.state = 'HANGING_H_PIPE';
    p2.x = 40;
    p2.y = 105;

    engine.update();

    assert.strictEqual(p2.hasEscaped, false, 'Second player must not escape');
    assert.strictEqual(p2.state, 'DEAD', 'Second player must be sniped due to quota violation');
    assert.strictEqual(p2.health, 0);
  });

  it('should apply gravity to sniped airborne corpses until they land on the floor/platform', () => {
    const engine = new GameEngine();
    const p1 = engine.addHumanPlayer('p1', 'Alice')!;
    engine.startNewMatch();

    // Player sniped while hanging on ceiling pipe at Y = 105
    p1.x = 400;
    p1.y = 105;
    p1.state = 'HANGING_H_PIPE';

    engine.snipePlayer(p1, 'QUOTA_VIOLATED');

    assert.strictEqual(p1.state, 'DEAD');
    assert.strictEqual(p1.isGrounded, false);
    assert.ok(p1.vy > 0, 'Corpse must have downward velocity');

    // Advance engine physics ticks
    const initialY = p1.y;
    for (let i = 0; i < 30; i++) {
      engine.update();
      if (p1.isGrounded) break;
    }

    assert.ok(p1.y > initialY, 'Corpse must fall downward');
    assert.strictEqual(p1.isGrounded, true, 'Corpse must eventually land and become grounded');
    assert.strictEqual(p1.vy, 0, 'Vertical velocity must be stopped on landing');
  });

  it('should trigger final purge at match timer expiry, eliminating all trapped prisoners', () => {
    const engine = new GameEngine();
    const p1 = engine.addHumanPlayer('p1', 'Alice')!;
    const p2 = engine.addHumanPlayer('p2', 'Bob')!;
    engine.addHumanPlayer('p3', 'Charlie')!;

    engine.startNewMatch();

    // Alice escaped earlier
    p1.hasEscaped = true;
    p1.state = 'ESCAPED';

    // Bob and Charlie remain trapped in the pit
    assert.strictEqual(p2.state, 'ON_FLOOR');

    // Match timer hits 0
    engine.setMatchTimer(0.01);
    engine.update();

    assert.strictEqual(engine.state.phase, 'PURGE');
    assert.strictEqual(p2.state, 'DEAD', 'Bob must be eliminated in final purge');
    assert.strictEqual(p2.health, 0);
    assert.strictEqual(p1.state, 'ESCAPED', 'Escaped player remains unharmed');

    // After purge duration (5.0s), transitions to MATCH_OVER
    for (let i = 0; i < 165; i++) {
      engine.update();
    }

    assert.strictEqual(engine.state.phase, 'MATCH_OVER');
  });

  it('should never snipe innocent players who are traversing away from the hatch threshold', () => {
    const engine = new GameEngine();
    const p1 = engine.addHumanPlayer('p1', 'Alice')!;
    engine.startNewMatch();

    // Alice is in the dormitory or maintenance room (far away from HATCH_ZONE X=40..130)
    p1.x = 800;
    p1.y = 300;

    for (let i = 0; i < 10; i++) {
      engine.update();
    }

    assert.strictEqual(p1.state !== 'DEAD', true, 'Alice should remain alive');
    assert.strictEqual(p1.health, 100);
    assert.strictEqual(engine.state.recentShots.length, 0);
  });
});
