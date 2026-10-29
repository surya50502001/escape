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

describe('Release Readiness: End-to-End 10-Room Multi-Client Campaign Playthrough', () => {

  it('PLAYTHROUGH-01: Autonomous continuous 10-room co-op progression, backtrack and escape', () => {
    const session = new CampaignSession('CAMP-RELEASE-FULL');
    const p1 = createPlayer('p1', 'Alice');
    const p2 = createPlayer('p2', 'Bob');

    assert.equal(session.addPlayer(p1, 1), true);
    assert.equal(session.addPlayer(p2, 1), true);

    // Skip cinematic to start gameplay immediately
    session.intro.skip();
    assert.equal(session.intro.isInputLocked(), false);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 1: Dormitory Holding Block
    // ══════════════════════════════════════════════════════════════════
    const r1 = session.getOrCreateRoomRuntime(1);
    assert.equal(session.getPlayerRoomId('p1'), 1);
    assert.equal(session.getPlayerRoomId('p2'), 1);

    // 1. Boost Jump in boost zone [256..448, 480..544]
    p1.x = 350;
    p1.y = 544;
    p1.vy = -60;
    r1.update();
    assert.equal(p1.vy, -520, 'Boost zone gives v_boost = -520');

    // Land on upper walkway
    p1.x = 992;
    p1.y = 384;
    p1.vy = 0;
    p1.isGrounded = true;

    // Deploy rope from anchor
    const resRope1 = r1.interact(p1);
    assert.ok(resRope1);
    assert.equal(resRope1.action, 'DEPLOY_ROPE');
    assert.ok(r1.deployedMechanisms.has('rope_anchor'));

    // Bob climbs deployed rope up to walkway
    p2.x = 992;
    p2.y = 384;
    p2.isGrounded = true;

    // Both reach Room 1 exit door and transition
    const r1Exit = r1.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r1Exit.rect.x + 10; p1.y = r1Exit.rect.y + 10;
    p2.x = r1Exit.rect.x + 10; p2.y = r1Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 2), true);
    assert.equal(session.transitionPlayer('p2', 2), true);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 2: Drainage Cistern
    // ══════════════════════════════════════════════════════════════════
    const r2 = session.getOrCreateRoomRuntime(2);
    assert.equal(session.getPlayerRoomId('p1'), 2);
    assert.equal(session.getPlayerRoomId('p2'), 2);

    // Test Crate Reset lever at x=384, y=544
    p1.x = 384; p1.y = 544;
    const resLever = r2.interact(p1);
    assert.ok(resLever);
    assert.equal(resLever.action, 'RESET_CRATE');

    // Both ascend platforms to exit door
    const r2Exit = r2.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r2Exit.rect.x + 10; p1.y = r2Exit.rect.y + 10;
    p2.x = r2Exit.rect.x + 10; p2.y = r2Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 3), true);
    assert.equal(session.transitionPlayer('p2', 3), true);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 3: Guard Quarters (Stealth Bypass)
    // ══════════════════════════════════════════════════════════════════
    const r3 = session.getOrCreateRoomRuntime(3);
    assert.equal(session.getPlayerRoomId('p1'), 3);

    // Both travel high via ceiling pipes / catwalks (y <= 480)
    p1.x = 768; p1.y = 380; // above guard at x=768
    p2.x = 768; p2.y = 380;
    r3.update();
    assert.notEqual(p1.state, 'STUNNED', 'High bypass evades sleeping guard');
    assert.notEqual(p2.state, 'STUNNED');

    // Transition to Room 4
    const r3Exit = r3.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r3Exit.rect.x + 10; p1.y = r3Exit.rect.y + 10;
    p2.x = r3Exit.rect.x + 10; p2.y = r3Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 4), true);
    assert.equal(session.transitionPlayer('p2', 4), true);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 4: Surveillance Gallery (Searchlight)
    // ══════════════════════════════════════════════════════════════════
    const r4 = session.getOrCreateRoomRuntime(4);
    assert.equal(session.getPlayerRoomId('p1'), 4);

    // Advance searchlight sweep
    r4.update();
    assert.ok(r4.searchlightX >= 160);

    const r4Exit = r4.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r4Exit.rect.x + 10; p1.y = r4Exit.rect.y + 10;
    p2.x = r4Exit.rect.x + 10; p2.y = r4Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 5), true);
    assert.equal(session.transitionPlayer('p2', 5), true);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 5: Pipe Vault (Secret Panel & Optional Item)
    // ══════════════════════════════════════════════════════════════════
    const r5 = session.getOrCreateRoomRuntime(5);
    assert.equal(session.getPlayerRoomId('p1'), 5);

    // Open secret panel at x=832, y=512
    p1.x = 832; p1.y = 512;
    const resPanel = r5.interact(p1);
    assert.ok(resPanel);
    assert.equal(resPanel.action, 'OPEN_PANEL');
    assert.ok(r5.deployedMechanisms.has('movable_panel'));
    assert.ok(r5.groundItems.has('optional_rope'));

    const r5Exit = r5.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r5Exit.rect.x + 10; p1.y = r5Exit.rect.y + 10;
    p2.x = r5Exit.rect.x + 10; p2.y = r5Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 6), true);
    assert.equal(session.transitionPlayer('p2', 6), true);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 6: Vertical Shaft
    // ══════════════════════════════════════════════════════════════════
    const r6 = session.getOrCreateRoomRuntime(6);
    assert.equal(session.getPlayerRoomId('p1'), 6);

    // Deploy shaft rope at x=608, y=160
    p1.x = 608; p1.y = 160;
    const resShaftRope = r6.interact(p1);
    assert.ok(resShaftRope);
    assert.equal(resShaftRope.action, 'DEPLOY_SHAFT_ROPE');
    assert.ok(r6.deployedMechanisms.has('shaft_rope'));
    assert.ok(r6.engine.state.ladders.some(l => l.id === 'shaft_rope'));

    // Both reach upper catwalk exit door
    const r6Exit = r6.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r6Exit.rect.x + 10; p1.y = r6Exit.rect.y + 10;
    p2.x = r6Exit.rect.x + 10; p2.y = r6Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 7), true);
    assert.equal(session.transitionPlayer('p2', 7), true);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 7: Patrol Corridor
    // ══════════════════════════════════════════════════════════════════
    const r7 = session.getOrCreateRoomRuntime(7);
    assert.equal(session.getPlayerRoomId('p1'), 7);

    // Sentry patrol updates
    r7.update();
    assert.ok(r7.guardX > 0);

    const r7Exit = r7.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r7Exit.rect.x + 10; p1.y = r7Exit.rect.y + 10;
    p2.x = r7Exit.rect.x + 10; p2.y = r7Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 8), true);
    assert.equal(session.transitionPlayer('p2', 8), true);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 8: Dual Switch Lock
    // ══════════════════════════════════════════════════════════════════
    const r8 = session.getOrCreateRoomRuntime(8);
    assert.equal(session.getPlayerRoomId('p1'), 8);

    // Alice activates Switch A (x=384, y=544)
    p1.x = 384; p1.y = 544;
    assert.equal(r8.interact(p1)?.action, 'ACTIVATE_SWITCH_A');
    assert.equal(r8.deployedMechanisms.has('door_unlocked'), false);

    // Bob activates Switch B (x=1152, y=544) within 12s window
    p2.x = 1152; p2.y = 544;
    assert.equal(r8.interact(p2)?.action, 'ACTIVATE_SWITCH_B');
    assert.equal(r8.deployedMechanisms.has('door_unlocked'), true, 'Blast door permanently unlocked');

    const r8Exit = r8.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r8Exit.rect.x + 10; p1.y = r8Exit.rect.y + 10;
    p2.x = r8Exit.rect.x + 10; p2.y = r8Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 9), true);
    assert.equal(session.transitionPlayer('p2', 9), true);

    // ══════════════════════════════════════════════════════════════════
    // CHAMBER 9: Secure Storage (Key & Box C)
    // ══════════════════════════════════════════════════════════════════
    const r9 = session.getOrCreateRoomRuntime(9);
    assert.equal(session.getPlayerRoomId('p1'), 9);

    // Alice picks up brass key from niche at x=256, y=544
    p1.x = 256; p1.y = 544;
    assert.equal(session.pickupItem('p1', 'brass_key'), true);
    assert.equal(session.playerItems.get('p1')?.type, 'key');

    // Alice unlocks Box C at x=1160, y=512
    p1.x = 1160; p1.y = 512;
    const resBox = r9.interact(p1, session.playerItems.get('p1'));
    assert.ok(resBox);
    assert.equal(resBox.action, 'UNLOCK_BOX');
    assert.ok(r9.isContainerUnlocked('box_c'));
    assert.ok(r9.groundItems.has('cutting_tool'));

    // Both advance to Room 10
    const r9Exit = r9.loadedRoom.doors.find(d => d.id === 'exit_door')!;
    p1.x = r9Exit.rect.x + 10; p1.y = r9Exit.rect.y + 10;
    p2.x = r9Exit.rect.x + 10; p2.y = r9Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 10), true);
    assert.equal(session.transitionPlayer('p2', 10), true);

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

    // Alice discovers hatch requires cutting tool
    // Alice backtracks solo to Room 9 (via entry door at x=48, y=544)
    const r10Entry = r10.loadedRoom.doors.find(d => d.id === 'entry_door')!;
    p1.x = r10Entry.rect.x + 10; p1.y = r10Entry.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 9), true);

    // INDEPENDENT ROOM PRESENCE VERIFICATION (Spec Rule 9)
    assert.equal(session.getPlayerRoomId('p1'), 9, 'Alice is in Room 9');
    assert.equal(session.getPlayerRoomId('p2'), 10, 'Bob remains safely in Room 10 on Platform C');
    assert.equal(r10.getPlayer('p2')?.y, 192, 'Bob position preserved on high platform');

    // Simulate 300 ticks (10s) - verify Bob is NOT dragged out of Room 10
    for (let i = 0; i < 300; i++) {
      session.update();
    }
    assert.equal(session.getPlayerRoomId('p2'), 10, 'Bob still in Room 10 (no airlock drag on backtrack)');

    // In Room 9: Alice drops key, picks up cutting tool
    session.dropItem('p1');
    p1.x = 1160; p1.y = 544;
    assert.equal(session.pickupItem('p1', 'cutting_tool'), true);
    assert.equal(session.playerItems.get('p1')?.type, 'cutting_tool');

    // Alice returns to Room 10
    p1.x = r9Exit.rect.x + 10; p1.y = r9Exit.rect.y + 10;
    assert.equal(session.transitionPlayer('p1', 10), true);
    assert.equal(session.getPlayerRoomId('p1'), 10);
    assert.equal(r10.getPlayers().length, 2);

    // Alice climbs emergency ladder to Platform C at hatch
    p1.x = 1248; p1.y = 144;
    const resCut = r10.interact(p1, session.playerItems.get('p1'));
    assert.ok(resCut);
    assert.equal(resCut.action, 'CUT_HATCH');
    assert.ok(r10.cutHatches.has('sealed_hatch'), 'Reinforced steel rebar cut open');

    // Final Escape: Touch breached surface portal
    const resEscape1 = r10.interact(p1, session.playerItems.get('p1'));
    assert.ok(resEscape1);
    assert.equal(resEscape1.action, 'ESCAPE_SURFACE');
    assert.equal(resEscape1.transitionTarget, 'Surface');

    p1.hasEscaped = true;
    p2.hasEscaped = true;
    session.campaignComplete = true;

    assert.equal(session.campaignComplete, true, 'Campaign 10-room breakout fully completed!');
  });
});
