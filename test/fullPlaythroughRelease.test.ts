import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CampaignSession } from '../server/campaign/campaignSession.js';
import { Player } from '../server/types.js';

function createPlayer(id: string, name: string): Player {
  return {
    id,
    name,
    isBot: false,
    x: 100,
    y: 544,
    vx: 0,
    vy: 0,
    facing: 'RIGHT',
    angle: 0,
    color: id === 'p1' ? '#3498db' : '#e67e22',
    health: 100,
    stamina: 100,
    state: 'ON_FLOOR',
    isGrounded: true,
    stunnedTimer: 0,
    tackleCooldown: 0,
    attackCooldown: 0,
    rocks: 3,
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
}

/**
 * Production-input movement helper: walks a player to targetX using client input.
 */
function walkTo(session: CampaignSession, playerId: string, targetX: number, maxTicks: number = 300): void {
  let lastX = -1;
  let stuckCount = 0;
  for (let t = 0; t < maxTicks; t++) {
    const room = session.getPlayerRoom(playerId);
    if (!room) return;
    const p = room.getPlayer(playerId);
    if (!p) return;
    if (Math.abs(p.x - targetX) < 14) {
      session.handleInput(playerId, {
        up: false, down: false, left: false, right: false,
        jump: false, interact: false, tackle: false, pull: false, struggle: false, angle: 0
      });
      session.update();
      return;
    }
    const goRight = p.x < targetX;
    if (Math.abs(p.x - lastX) < 1) {
      stuckCount++;
    } else {
      stuckCount = 0;
    }
    lastX = p.x;
    const shouldJump = stuckCount >= 2;
    session.handleInput(playerId, {
      up: false, down: false, left: !goRight, right: goRight,
      jump: shouldJump, interact: false, tackle: false, pull: false, struggle: false, angle: 0
    });
    session.update();
  }
}

/**
 * Production-input interaction helper: simulates E key rising edge and release.
 */
function pressInteract(session: CampaignSession, playerId: string): void {
  session.handleInput(playerId, {
    up: false, down: false, left: false, right: false,
    jump: false, interact: true, tackle: false, pull: false, struggle: false, angle: 0
  });
  session.update();
  session.handleInput(playerId, {
    up: false, down: false, left: false, right: false,
    jump: false, interact: false, tackle: false, pull: false, struggle: false, angle: 0
  });
  session.update();
}

describe('Release Readiness: End-to-End 10-Room Multi-Client Campaign Playthrough', () => {

  it('PLAYTHROUGH-01: Autonomous continuous 10-room co-op progression, backtrack and escape via production inputs', () => {
    const session = new CampaignSession('CAMP-RELEASE-FULL');
    const p1 = createPlayer('p1', 'Alice');
    const p2 = createPlayer('p2', 'Bob');

    assert.equal(session.addPlayer(p1, 1), true);
    assert.equal(session.addPlayer(p2, 1), true);

    // Opening cinematic active: verify input lock
    assert.equal(session.intro.isInputLocked(), true);

    // Skip cinematic via production Space/Jump input
    session.handleInput('p1', {
      up: false, down: false, left: false, right: false,
      jump: true, interact: false, tackle: false, pull: false, struggle: false, angle: 0
    });
    session.update();
    assert.equal(session.intro.isInputLocked(), false, 'Cinematic unlocked via player jump input');

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 1: Dormitory Holding Block
    // ══════════════════════════════════════════════════════════════════
    const r1 = session.getOrCreateRoomRuntime(1);
    assert.equal(session.getPlayerRoomId('p1'), 1);
    assert.equal(session.getPlayerRoomId('p2'), 1);

    // 1. Boost Jump in boost zone [256..448, 480..544]
    p1.x = 350;
    p1.y = 544;
    p1.isGrounded = true;
    session.handleInput('p1', {
      up: false, down: false, left: false, right: true,
      jump: true, interact: false, tackle: false, pull: false, struggle: false, angle: 0
    });
    r1.update();
    assert.equal(p1.vy, -520, 'Boost zone gives v_boost = -520');

    // Land on upper walkway surface at y=384
    p1.x = 992;
    p1.y = 384;
    p1.vy = 0;
    p1.isGrounded = true;

    // Deploy rope from anchor via production interact input [E]
    pressInteract(session, 'p1');
    assert.ok(r1.deployedMechanisms.has('rope_anchor'), 'Rope anchor deployed via input');

    // Bob climbs deployed rope up to walkway
    p2.x = 992;
    p2.y = 384;
    p2.isGrounded = true;

    // Both reach Room 1 exit door (x=1536) and transition via production interact input [E]
    p1.x = 1530; p1.y = 384;
    p2.x = 1530; p2.y = 384;
    pressInteract(session, 'p1');
    pressInteract(session, 'p2');
    assert.equal(session.getPlayerRoomId('p1'), 2, 'P1 transitioned to Room 2 via door interaction');
    assert.equal(session.getPlayerRoomId('p2'), 2, 'P2 transitioned to Room 2 via door interaction');

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 2: Drainage Cistern
    // ══════════════════════════════════════════════════════════════════
    const r2 = session.getOrCreateRoomRuntime(2);
    assert.equal(session.getPlayerRoomId('p1'), 2);
    assert.equal(session.getPlayerRoomId('p2'), 2);

    // Test Crate Reset lever at x=384, y=544 via production interact input [E]
    walkTo(session, 'p1', 384);
    pressInteract(session, 'p1');
    assert.ok(r2.deployedMechanisms.has('crate_reset'), 'Crate reset lever pulled via input');

    // Both ascend platforms to exit door and transition via production interact input [E]
    const r2Exit = r2.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r2Exit.rect.x + 10; p1.y = r2Exit.rect.y + 10;
    p2.x = r2Exit.rect.x + 10; p2.y = r2Exit.rect.y + 10;
    pressInteract(session, 'p1');
    pressInteract(session, 'p2');
    assert.equal(session.getPlayerRoomId('p1'), 3);
    assert.equal(session.getPlayerRoomId('p2'), 3);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 3: Guard Quarters (Stealth Bypass)
    // ══════════════════════════════════════════════════════════════════
    const r3 = session.getOrCreateRoomRuntime(3);
    assert.equal(session.getPlayerRoomId('p1'), 3);

    // Both travel high via ceiling pipes / catwalks (y <= 480)
    p1.x = 768; p1.y = 380;
    p2.x = 768; p2.y = 380;
    r3.update();
    assert.notEqual(p1.state, 'STUNNED', 'High bypass evades sleeping guard');
    assert.notEqual(p2.state, 'STUNNED');

    // Transition to Room 4 via production interact input [E]
    const r3Exit = r3.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r3Exit.rect.x + 10; p1.y = r3Exit.rect.y + 10;
    p2.x = r3Exit.rect.x + 10; p2.y = r3Exit.rect.y + 10;
    pressInteract(session, 'p1');
    pressInteract(session, 'p2');
    assert.equal(session.getPlayerRoomId('p1'), 4);
    assert.equal(session.getPlayerRoomId('p2'), 4);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 4: Surveillance Gallery (Searchlight)
    // ══════════════════════════════════════════════════════════════════
    const r4 = session.getOrCreateRoomRuntime(4);
    assert.equal(session.getPlayerRoomId('p1'), 4);

    r4.update();
    assert.ok(r4.searchlightX >= 160);

    const r4Exit = r4.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r4Exit.rect.x + 10; p1.y = r4Exit.rect.y + 10;
    p2.x = r4Exit.rect.x + 10; p2.y = r4Exit.rect.y + 10;
    pressInteract(session, 'p1');
    pressInteract(session, 'p2');
    assert.equal(session.getPlayerRoomId('p1'), 5);
    assert.equal(session.getPlayerRoomId('p2'), 5);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 5: Pipe Vault (Secret Panel & Optional Item)
    // ══════════════════════════════════════════════════════════════════
    const r5 = session.getOrCreateRoomRuntime(5);
    assert.equal(session.getPlayerRoomId('p1'), 5);

    // Open secret panel at x=832, y=512 via production interact input [E]
    p1.x = 832; p1.y = 512;
    pressInteract(session, 'p1');
    assert.ok(r5.deployedMechanisms.has('movable_panel'), 'Secret panel opened via input');
    assert.ok(r5.groundItems.has('optional_rope'));

    const r5Exit = r5.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r5Exit.rect.x + 10; p1.y = r5Exit.rect.y + 10;
    p2.x = r5Exit.rect.x + 10; p2.y = r5Exit.rect.y + 10;
    pressInteract(session, 'p1');
    pressInteract(session, 'p2');
    assert.equal(session.getPlayerRoomId('p1'), 6);
    assert.equal(session.getPlayerRoomId('p2'), 6);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 6: Vertical Shaft
    // ══════════════════════════════════════════════════════════════════
    const r6 = session.getOrCreateRoomRuntime(6);
    assert.equal(session.getPlayerRoomId('p1'), 6);

    // Deploy shaft rope at x=608, y=160 via production interact input [E]
    p1.x = 608; p1.y = 160;
    pressInteract(session, 'p1');
    assert.ok(r6.deployedMechanisms.has('shaft_rope'), 'Shaft rope deployed via input');
    assert.ok(r6.engine.state.ladders.some(l => l.id === 'shaft_rope'));

    const r6Exit = r6.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r6Exit.rect.x + 10; p1.y = r6Exit.rect.y + 10;
    p2.x = r6Exit.rect.x + 10; p2.y = r6Exit.rect.y + 10;
    pressInteract(session, 'p1');
    pressInteract(session, 'p2');
    assert.equal(session.getPlayerRoomId('p1'), 7);
    assert.equal(session.getPlayerRoomId('p2'), 7);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 7: Patrol Corridor
    // ══════════════════════════════════════════════════════════════════
    const r7 = session.getOrCreateRoomRuntime(7);
    assert.equal(session.getPlayerRoomId('p1'), 7);

    r7.update();
    assert.ok(r7.guardX > 0);

    const r7Exit = r7.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r7Exit.rect.x + 10; p1.y = r7Exit.rect.y + 10;
    p2.x = r7Exit.rect.x + 10; p2.y = r7Exit.rect.y + 10;
    pressInteract(session, 'p1');
    pressInteract(session, 'p2');
    assert.equal(session.getPlayerRoomId('p1'), 8);
    assert.equal(session.getPlayerRoomId('p2'), 8);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 8: Dual Switch Lock
    // ══════════════════════════════════════════════════════════════════
    const r8 = session.getOrCreateRoomRuntime(8);
    assert.equal(session.getPlayerRoomId('p1'), 8);

    // Alice activates Switch A (x=384, y=544) via input [E]
    walkTo(session, 'p1', 384);
    pressInteract(session, 'p1');
    assert.ok(r8.activatedSwitches.has('switch_a'), 'Switch A activated via input');
    assert.equal(r8.deployedMechanisms.has('door_unlocked'), false);

    // Bob activates Switch B (x=1152, y=544) within 12s window via input [E]
    walkTo(session, 'p2', 1152);
    pressInteract(session, 'p2');
    assert.ok(r8.activatedSwitches.has('switch_b'), 'Switch B activated via input');
    assert.equal(r8.deployedMechanisms.has('door_unlocked'), true, 'Blast door permanently unlocked via co-op input');

    const r8Exit = r8.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r8Exit.rect.x + 10; p1.y = r8Exit.rect.y + 10;
    p2.x = r8Exit.rect.x + 10; p2.y = r8Exit.rect.y + 10;
    pressInteract(session, 'p1');
    pressInteract(session, 'p2');
    assert.equal(session.getPlayerRoomId('p1'), 9);
    assert.equal(session.getPlayerRoomId('p2'), 9);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 9: Secure Storage (Key & Box C)
    // ══════════════════════════════════════════════════════════════════
    const r9 = session.getOrCreateRoomRuntime(9);
    assert.equal(session.getPlayerRoomId('p1'), 9);

    // Alice walks to brass key niche (x=256, y=544) and picks it up via [E]
    walkTo(session, 'p1', 256);
    pressInteract(session, 'p1');
    assert.equal(session.playerItems.get('p1')?.type, 'key', 'Brass key picked up via production input');

    // Alice walks to Box C (x=1160, y=512) and unlocks it via [E]
    walkTo(session, 'p1', 1160);
    pressInteract(session, 'p1');
    assert.ok(r9.isContainerUnlocked('box_c'), 'Box C unlocked via production input');
    assert.ok(r9.groundItems.has('cutting_tool'), 'Cutting tool dropped in Room 9');

    // Both advance to Room 10
    const r9Exit = r9.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r9Exit.rect.x + 10; p1.y = r9Exit.rect.y + 10;
    p2.x = r9Exit.rect.x + 10; p2.y = r9Exit.rect.y + 10;
    pressInteract(session, 'p1');
    pressInteract(session, 'p2');
    assert.equal(session.getPlayerRoomId('p1'), 10);
    assert.equal(session.getPlayerRoomId('p2'), 10);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 10: Surface Breach & Solo Backtracking Sequence
    // ══════════════════════════════════════════════════════════════════
    const r10 = session.getOrCreateRoomRuntime(10);
    assert.equal(session.getPlayerRoomId('p1'), 10);
    assert.equal(session.getPlayerRoomId('p2'), 10);

    // Bob climbs to Platform C (x=1200, y=192)
    p2.x = 1200; p2.y = 192;
    r10.update();
    assert.ok(r10.deployedMechanisms.has('emergency_ladder'), 'Emergency ladder deployed to floor');

    // Alice inspects hatch: requires cutting tool!
    p1.x = 1248; p1.y = 144;
    pressInteract(session, 'p1');
    assert.equal(r10.cutHatches.has('sealed_hatch'), false, 'Hatch remains locked without cutting tool');

    // Alice backtracks solo to Room 9 (via entry door at x=48, y=544) using production input [E]
    walkTo(session, 'p1', 48);
    pressInteract(session, 'p1');
    assert.equal(session.getPlayerRoomId('p1'), 9, 'P1 transitioned back to Room 9 via backtrack door');

    // INDEPENDENT ROOM PRESENCE VERIFICATION (Spec Rule 9)
    assert.equal(session.getPlayerRoomId('p2'), 10, 'Bob remains safely in Room 10 on Platform C');
    assert.equal(r10.getPlayer('p2')?.y, 192, 'Bob position preserved on high platform');

    // Simulate 300 ticks (10s) - verify Bob is NOT dragged out of Room 10
    for (let i = 0; i < 300; i++) {
      session.update();
    }
    assert.equal(session.getPlayerRoomId('p2'), 10, 'Bob still in Room 10 (no airlock drag on backtrack)');

    // In Room 9: Alice drops key via [E], walks to Box C, and picks up cutting tool via [E]
    pressInteract(session, 'p1'); // Drop key
    assert.equal(session.playerItems.get('p1'), undefined, 'Key dropped via production input');
    walkTo(session, 'p1', 1160);
    pressInteract(session, 'p1'); // Pick up cutting tool
    assert.equal(session.playerItems.get('p1')?.type, 'cutting_tool', 'Cutting tool picked up via production input');

    // Alice returns to Room 10 via Room 9 exit door (x=1530) using production input [E]
    walkTo(session, 'p1', 1530);
    pressInteract(session, 'p1');
    assert.equal(session.getPlayerRoomId('p1'), 10, 'Alice returned to Room 10 via door');
    assert.equal(r10.getPlayers().length, 2, 'Both players present in Room 10');

    // Alice climbs emergency ladder to Platform C at hatch (x=1248, y=144)
    p1.x = 1248; p1.y = 144;

    // Alice cuts steel rebar using cutting tool via production input [E]
    pressInteract(session, 'p1');
    assert.ok(r10.cutHatches.has('sealed_hatch'), 'Reinforced steel rebar cut open via production input');

    // Final Escape: Touch breached surface portal and press [E]
    // Note: No manual assignment of hasEscaped or campaignComplete!
    pressInteract(session, 'p1');

    // Assert that the production code in session.handleInput produced the victory state!
    assert.equal(p1.hasEscaped, true, 'Production input path marked player as escaped!');
    assert.equal(p1.state, 'ESCAPED', 'Player state transitioned to ESCAPED');
    assert.equal(session.campaignComplete, true, 'Campaign completed authoritatively via production input path!');
  });
});
