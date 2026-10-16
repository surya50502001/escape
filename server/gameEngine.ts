import { 
  GameState, GamePhase, Player, Projectile, SniperShot, SoundEvent, ClientInput, Rope, HatchZone,
  MAX_PLAYERS, CHAMBER_WIDTH, CHAMBER_HEIGHT, FLOOR_Y, V_PIPE_X, V_PIPE_TOP_Y, H_PIPE_Y, H_PIPE_EXIT_X 
} from './types.js';

export const HATCH_ZONE: HatchZone = { x: 40, y: 40, width: 90, height: 90 };

const TICK_RATE = 30;
const DT = 1 / TICK_RATE;
const GRAVITY = 750;

const BOT_NAMES = [
  'Rusty Pete', 'Shiv Miller', 'Big Knuckles', 'Rat-Bite Sal', 
  'Iron Jaw', 'Shadow Fox', 'One-Eye Jack', 'Snake Eyes', 'Mad Dog Boris'
];

const BOT_COLORS = [
  '#c26d2e', '#964338', '#634766', '#3b5a7a', 
  '#3f7065', '#997e36', '#854b24', '#3d6e52', '#7a3e5c'
];

export class GameEngine {
  public state: GameState;
  private pendingSoundEvents: SoundEvent[] = [];
  private matchTimer: number = 600; // 10 minutes
  private nextSignalTimer: number = 14;
  private signalWindowTimer: number = 0;
  private finalSilenceActive: boolean = false;

  constructor() {
    this.state = {
      phase: 'LOBBY',
      matchTimer: 600,
      signalQuota: 0,
      signalEscapedCount: 0,
      totalEscapedCount: 0,
      signalWindowRemaining: 0,
      nextSignalIn: 14,
      announcementText: '10 PRISONERS ENTERING THE PIT...',
      hatch: { ...HATCH_ZONE },
      rope: {
        id: 'main_rope',
        x: 450,
        y: FLOOR_Y,
        vx: 0,
        vy: 0,
        state: 'ON_FLOOR',
        heldByPlayerId: null,
        attachedPlayerId: null,
        length: 220
      },
      players: [],
      projectiles: [],
      recentShots: [],
      soundEvents: []
    };
  }

  public emitSound(event: SoundEvent): void {
    this.pendingSoundEvents.push(event);
  }

  public startNewMatch(): void {
    this.matchTimer = 600;
    this.finalSilenceActive = false;
    this.state.phase = 'WAITING_SIGNAL';
    this.state.totalEscapedCount = 0;
    this.state.signalQuota = 0;
    this.state.signalEscapedCount = 0;
    this.state.projectiles = [];
    this.state.recentShots = [];
    this.pendingSoundEvents = [];

    // Reset rope onto concrete floor
    this.dropRope(450, FLOOR_Y);

    this.nextSignalTimer = 14 + Math.random() * 8;
    this.state.announcementText = 'ANONYMOUS GUARDS THE UPPER HATCH. SURVIVE 10 MINUTES IN THE CELL.';
    this.emitSound({ type: 'CLANG' });

    // Spawn players along the floor
    this.state.players.forEach((p, idx) => {
      p.x = 180 + idx * 65;
      p.y = FLOOR_Y;
      p.vx = 0;
      p.vy = 0;
      p.facing = 'RIGHT';
      p.health = 100;
      p.stamina = 100;
      p.state = 'ON_FLOOR';
      p.isGrounded = true;
      p.stunnedTimer = 0;
      p.tackleCooldown = 0;
      p.attackCooldown = 0;
      p.hasEscaped = false;
      p.escapeTime = undefined;
      p.rocks = 1;
    });
  }

  /**
   * Safe join policy:
   * - Never exceeds MAX_PLAYERS (10).
   * - Reconnecting with existing ID returns current player.
   * - If room has bots, replace a bot.
   * - If room is full of 10 humans, reject join by returning null.
   */
  public addHumanPlayer(id: string, name: string): Player | null {
    // 1. Reconnect check
    const existing = this.state.players.find(x => x.id === id);
    if (existing) {
      if (name) existing.name = name;
      return existing;
    }

    const humanCount = this.state.players.filter(p => !p.isBot).length;
    if (humanCount >= MAX_PLAYERS) {
      // All 10 slots occupied by human players
      return null;
    }

    // 2. Bot replacement if room is at capacity
    if (this.state.players.length >= MAX_PLAYERS) {
      const botIndex = this.state.players.findIndex(p => p.isBot);
      if (botIndex !== -1) {
        const removedBot = this.state.players[botIndex];
        // Clean up any rope references to this bot
        if (this.state.rope.heldByPlayerId === removedBot.id || this.state.rope.attachedPlayerId === removedBot.id) {
          this.dropRope();
        }
        this.state.players.splice(botIndex, 1);
      } else {
        return null;
      }
    }

    // 3. Create human player
    const p: Player = {
      id,
      name: name || 'You',
      isBot: false,
      x: 350 + Math.random() * 200,
      y: FLOOR_Y,
      vx: 0,
      vy: 0,
      facing: 'RIGHT',
      angle: 0,
      color: '#22d3ee', // Cyan tint for human player
      health: 100,
      stamina: 100,
      state: 'ON_FLOOR',
      isGrounded: true,
      stunnedTimer: 0,
      tackleCooldown: 0,
      attackCooldown: 0,
      rocks: 1,
      hasEscaped: false,
      sabotages: 0
    };

    this.state.players.push(p);
    this.ensureTenPlayers();
    return p;
  }

  public removePlayer(id: string): void {
    const player = this.state.players.find(p => p.id === id);
    if (!player) return;

    if (this.state.rope.heldByPlayerId === id || this.state.rope.attachedPlayerId === id) {
      this.dropRope();
    }

    if (this.state.phase === 'LOBBY' || this.state.phase === 'MATCH_OVER') {
      this.state.players = this.state.players.filter(p => p.id !== id);
      this.ensureTenPlayers();
    } else {
      // During active match, mark player as dead so slots and rankings remain stable
      if (!player.hasEscaped && player.state !== 'DEAD') {
        player.state = 'DEAD';
        player.health = 0;
      }
    }
  }

  public ensureTenPlayers(): void {
    let botIdx = 0;
    while (this.state.players.length < MAX_PLAYERS) {
      const name = BOT_NAMES[botIdx % BOT_NAMES.length];
      const color = BOT_COLORS[botIdx % BOT_COLORS.length];
      this.state.players.push({
        id: `bot_${Date.now()}_${botIdx}`,
        name,
        isBot: true,
        x: 180 + this.state.players.length * 65,
        y: FLOOR_Y,
        vx: 0,
        vy: 0,
        facing: 'RIGHT',
        angle: 0,
        color,
        health: 100,
        stamina: 100,
        state: 'ON_FLOOR',
        isGrounded: true,
        stunnedTimer: 0,
        tackleCooldown: 0,
        attackCooldown: 0,
        rocks: 1,
        hasEscaped: false,
        sabotages: 0
      });
      botIdx++;
    }
  }

  public handleInput(playerId: string, input: ClientInput): void {
    const p = this.state.players.find(x => x.id === playerId);
    if (!p || p.state === 'DEAD' || p.hasEscaped) return;

    p.angle = input.aimAngle;
    if (p.stunnedTimer > 0) return;

    // Track whether player was ALREADY holding rope prior to any pickup in this tick
    const alreadyHoldingRope = this.state.rope.heldByPlayerId === p.id;

    // Movement logic depending on current physical state
    if (p.state === 'ON_FLOOR') {
      const runSpeed = 190;
      if (input.left) {
        p.vx = -runSpeed;
        p.facing = 'LEFT';
      } else if (input.right) {
        p.vx = runSpeed;
        p.facing = 'RIGHT';
      } else {
        p.vx = 0;
      }

      // Jump
      if (input.jump && p.isGrounded) {
        p.vy = -340;
        p.isGrounded = false;
        p.state = 'FALLING';
      }

      // Grab Vertical Wall Pipe on right
      if (Math.abs(p.x - V_PIPE_X) < 35 && (input.up || input.right)) {
        p.state = 'CLIMBING_V_PIPE';
        p.x = V_PIPE_X;
        p.vx = 0;
        p.vy = 0;
        p.isGrounded = false;
      }

      // Tackle lunge on floor
      if (input.tackle && p.tackleCooldown <= 0 && p.stamina >= 25) {
        p.stamina -= 25;
        p.tackleCooldown = 1.8;
        p.stunnedTimer = 0.3;
        const dir = p.facing === 'RIGHT' ? 1 : -1;
        p.vx = dir * 380;
        this.emitSound({ type: 'TACKLE', x: p.x, y: p.y });
      }

      // Pick up rope from floor
      if (input.interact && this.state.rope.state === 'ON_FLOOR') {
        const distToRope = Math.hypot(p.x - this.state.rope.x, p.y - this.state.rope.y);
        if (distToRope < 50) {
          this.state.rope.state = 'HELD';
          this.state.rope.heldByPlayerId = p.id;
          this.state.rope.attachedPlayerId = null;
        }
      }
    } else if (p.state === 'CLIMBING_V_PIPE') {
      p.x = V_PIPE_X;
      p.vx = 0;
      const climbSpeed = 115;

      if (input.up) {
        p.vy = -climbSpeed;
      } else if (input.down) {
        p.vy = climbSpeed;
      } else {
        p.vy = 0;
      }

      // Drop off vertical pipe
      if (input.left) {
        p.state = 'FALLING';
        p.vx = -120;
      }

      // Transition to ceiling horizontal pipe at top
      if (p.y <= V_PIPE_TOP_Y + 15) {
        p.state = 'HANGING_H_PIPE';
        p.y = H_PIPE_Y + 15;
        p.vy = 0;
      }

      // Touch floor again
      if (p.y >= FLOOR_Y) {
        p.y = FLOOR_Y;
        p.state = 'ON_FLOOR';
        p.isGrounded = true;
      }
    } else if (p.state === 'HANGING_H_PIPE') {
      p.y = H_PIPE_Y + 15;
      p.vy = 0;
      const traverseSpeed = 100;

      if (input.left) {
        p.vx = -traverseSpeed;
        p.facing = 'LEFT';
      } else if (input.right) {
        p.vx = traverseSpeed;
        p.facing = 'RIGHT';
      } else {
        p.vx = 0;
      }

      // Let go and drop down
      if (input.down) {
        p.state = 'FALLING';
        p.vy = 50;
      }

      // Reached escape opening at upper-left
      if (p.x <= H_PIPE_EXIT_X) {
        this.attemptEscape(p);
      }
    } else if (p.state === 'FALLING') {
      if (input.left) p.vx = Math.max(-120, p.vx - 10);
      if (input.right) p.vx = Math.min(120, p.vx + 10);

      // Grab vertical pipe in mid-air
      if (Math.abs(p.x - V_PIPE_X) < 25 && p.y < FLOOR_Y - 20) {
        p.state = 'CLIMBING_V_PIPE';
        p.x = V_PIPE_X;
        p.vx = 0;
        p.vy = 0;
      }
    }

    // ROPE ACTIONS: Throw rope, Pull attached rope, or Drop rope
    if (alreadyHoldingRope) {
      if (this.state.rope.state === 'HELD') {
        if (input.attack && p.attackCooldown <= 0) {
          p.attackCooldown = 1.0;
          this.state.rope.state = 'THROWN';
          this.state.rope.x = p.x;
          this.state.rope.y = p.y - 20;
          const throwSpeed = 460;
          this.state.rope.vx = Math.cos(p.angle) * throwSpeed;
          this.state.rope.vy = Math.sin(p.angle) * throwSpeed;
        }

        if (input.interact) {
          this.dropRope();
        }
      } else if (this.state.rope.state === 'ATTACHED') {
        // Explicit pull action
        if (input.tackle || input.attack) {
          this.pullRopeTarget(p);
        } else if (input.interact) {
          // Explicit release of attached victim
          this.dropRope();
        }
      }
    } else {
      // Throw basic rock if not holding rope
      if (input.attack && p.attackCooldown <= 0 && p.rocks > 0) {
        p.rocks--;
        p.attackCooldown = 0.8;
        const rockSpeed = 420;
        this.state.projectiles.push({
          id: `rock_${Date.now()}_${Math.random()}`,
          ownerId: p.id,
          x: p.x + (p.facing === 'RIGHT' ? 15 : -15),
          y: p.y - 18,
          vx: Math.cos(p.angle) * rockSpeed,
          vy: Math.sin(p.angle) * rockSpeed,
          type: 'rock',
          lifetime: 1.6
        });
      }
    }
  }

  public damagePlayer(player: Player, amount: number, source?: Player): void {
    if (player.state === 'DEAD' || player.hasEscaped) return;

    player.health = Math.max(0, player.health - amount);
    if (player.health <= 0) {
      player.health = 0;
      player.state = 'DEAD';
      player.vy = 300; // Drop to floor
      this.emitSound({ type: 'FALL_IMPACT', x: player.x, y: player.y });

      // Clean up rope if dead player was involved
      if (this.state.rope.heldByPlayerId === player.id || this.state.rope.attachedPlayerId === player.id) {
        this.dropRope();
      }

      if (source && source.id !== player.id) {
        source.sabotages++;
      }
    }
  }

  public update(): void {
    const now = Date.now();
    this.state.recentShots = this.state.recentShots.filter(s => now - s.timestamp < 1000);

    if (this.state.phase === 'LOBBY') {
      this.ensureTenPlayers();
      this.startNewMatch();
      this.flushSoundEvents();
      return;
    }

    // 10-Minute Match Clock
    if (this.state.phase !== 'MATCH_OVER' && this.state.phase !== 'PURGE') {
      this.matchTimer -= DT;
      this.state.matchTimer = Math.max(0, Math.ceil(this.matchTimer));
      if (this.matchTimer <= 0) {
        this.triggerFinalPurge();
        this.flushSoundEvents();
        return;
      }
    }

    // Phase management
    if (this.state.phase === 'WAITING_SIGNAL') {
      this.updateWaitingPhase();
    } else if (this.state.phase === 'SIGNAL_ACTIVE') {
      this.updateSignalActivePhase();
    } else if (this.state.phase === 'PURGE') {
      this.signalWindowTimer -= DT;
      if (this.signalWindowTimer <= 0) {
        this.state.phase = 'MATCH_OVER';
      }
    }

    // Physics updates
    this.updateRopePhysics();
    this.updateProjectiles();
    this.updatePlayersPhysics();

    this.flushSoundEvents();
  }

  private flushSoundEvents(): void {
    // Deliver all accumulated sound events to the broadcast state, then clear the buffer
    this.state.soundEvents = [...this.pendingSoundEvents];
    this.pendingSoundEvents = [];
  }

  private updateWaitingPhase(): void {
    this.nextSignalTimer -= DT;
    this.state.nextSignalIn = Math.max(0, Math.ceil(this.nextSignalTimer));

    const livingInPit = this.state.players.filter(p => !p.hasEscaped && p.state !== 'DEAD');
    if (livingInPit.length === 0) {
      this.state.phase = 'MATCH_OVER';
      this.state.announcementText = 'ALL PRISONERS HAVE EITHER ESCAPED OR PERISHED.';
      return;
    }

    if (this.nextSignalTimer <= 0) {
      if (this.matchTimer < 120 && Math.random() < 0.25) {
        this.finalSilenceActive = true;
        this.state.announcementText = 'ANONYMOUS IS GONE. THE HATCH REMAINS COLD AND SEALED...';
        this.nextSignalTimer = 999;
        return;
      }

      this.state.signalQuota = (livingInPit.length > 2 && Math.random() < 0.35) ? 2 : 1;
      this.state.signalEscapedCount = 0;
      this.signalWindowTimer = 18.0;
      this.state.signalWindowRemaining = 18;
      this.state.phase = 'SIGNAL_ACTIVE';

      this.state.announcementText = this.state.signalQuota === 1
        ? 'ANONYMOUS: "I WILL TAKE 1 PRISONER. IF TWO TOUCH THE HATCH, I FIRE."'
        : 'ANONYMOUS: "I PERMIT 2 PRISONERS. CLIMB THE PIPE AND ESCAPE."';

      this.emitSound({ type: 'ANNOUNCEMENT' });
      this.emitSound({ type: 'CLANG' });
    }
  }

  private updateSignalActivePhase(): void {
    this.signalWindowTimer -= DT;
    this.state.signalWindowRemaining = Math.max(0, Math.ceil(this.signalWindowTimer));

    if (this.signalWindowTimer <= 0) {
      this.closeHatch('WINDOW_EXPIRED');
    }
  }

  private attemptEscape(player: Player): void {
    if (player.hasEscaped || player.state === 'DEAD') return;

    // Strict boundary verification: player must actually be at the exit point
    if (player.x > H_PIPE_EXIT_X) {
      return;
    }

    // Quota Enforcement: if hatch is not active or quota exhausted, Overseer snipes violator
    if (this.state.phase !== 'SIGNAL_ACTIVE') {
      this.snipePlayer(player, 'QUOTA_VIOLATED');
      return;
    }

    const allowedRemaining = this.state.signalQuota - this.state.signalEscapedCount;
    if (allowedRemaining <= 0) {
      this.snipePlayer(player, 'QUOTA_VIOLATED');
      return;
    }

    // Check if other players simultaneously crossed the exact exit threshold (<= H_PIPE_EXIT_X)
    const simultaneousAtExit = this.state.players.filter(p => 
      p.id !== player.id && 
      p.state === 'HANGING_H_PIPE' && 
      p.x <= H_PIPE_EXIT_X && 
      !p.hasEscaped
    );

    if (allowedRemaining === 1 && simultaneousAtExit.length > 0) {
      // Multiple simultaneous entrants exceeding single quota slot -> snipe second entrant
      simultaneousAtExit.sort((a, b) => a.x - b.x);
      const violator = simultaneousAtExit[0];
      this.snipePlayer(violator, 'QUOTA_VIOLATED');
      if (violator.id === player.id) return;
    }

    // Success! Escape through hatch
    player.hasEscaped = true;
    player.state = 'ESCAPED';
    const mins = Math.floor((600 - this.matchTimer) / 60);
    const secs = Math.floor((600 - this.matchTimer) % 60);
    player.escapeTime = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    this.state.signalEscapedCount++;
    this.state.totalEscapedCount++;
    this.emitSound({ type: 'ESCAPE', x: player.x, y: player.y });

    // Clean up rope if escaping player held it
    if (this.state.rope.heldByPlayerId === player.id || this.state.rope.attachedPlayerId === player.id) {
      this.dropRope();
    }

    if (this.state.signalEscapedCount >= this.state.signalQuota) {
      this.closeHatch('QUOTA_FILLED');
    }
  }

  private closeHatch(reason: 'QUOTA_FILLED' | 'WINDOW_EXPIRED'): void {
    this.emitSound({ type: 'CLANG' });
    this.state.phase = 'WAITING_SIGNAL';
    this.nextSignalTimer = 18 + Math.random() * 16;

    const remaining = this.state.players.filter(p => !p.hasEscaped && p.state !== 'DEAD').length;
    if (reason === 'QUOTA_FILLED') {
      this.state.announcementText = `HATCH SLAMS SHUT! ${remaining} PRISONERS REMAIN TRAPPED IN THE PIT.`;
    } else {
      this.state.announcementText = `ANONYMOUS WITHDREW: "TOO SLOW." HATCH SEALED. (${remaining} LEFT)`;
    }
  }

  private updateRopePhysics(): void {
    const rope = this.state.rope;

    if (rope.state === 'HELD') {
      const holder = this.state.players.find(p => p.id === rope.heldByPlayerId);
      if (!holder || holder.state === 'DEAD' || holder.hasEscaped) {
        this.dropRope();
      } else {
        rope.x = holder.x;
        rope.y = holder.y - 15;
      }
    } else if (rope.state === 'THROWN') {
      rope.x += rope.vx * DT;
      rope.y += rope.vy * DT;
      rope.vy += 320 * DT; // Slight gravity on thrown rope

      // Check collision with hanging / climbing players
      for (const p of this.state.players) {
        if (p.id === rope.heldByPlayerId || p.state === 'DEAD' || p.hasEscaped) continue;
        const dist = Math.hypot(p.x - rope.x, p.y - rope.y);
        if (dist < 35 && (p.state === 'CLIMBING_V_PIPE' || p.state === 'HANGING_H_PIPE' || p.state === 'FALLING')) {
          rope.state = 'ATTACHED';
          rope.attachedPlayerId = p.id;
          rope.x = p.x;
          rope.y = p.y;
          this.emitSound({ type: 'ROPE_ATTACH', x: p.x, y: p.y });
          break;
        }
      }

      // Hit wall or floor without catching anyone
      if (rope.y >= FLOOR_Y || rope.x < 30 || rope.x > CHAMBER_WIDTH - 30) {
        this.dropRope(rope.x, FLOOR_Y);
      }
    } else if (rope.state === 'ATTACHED') {
      const holder = this.state.players.find(p => p.id === rope.heldByPlayerId);
      const target = this.state.players.find(p => p.id === rope.attachedPlayerId);

      if (!holder || !target || holder.state === 'DEAD' || target.state === 'DEAD' || target.hasEscaped) {
        this.dropRope();
      } else {
        rope.x = target.x;
        rope.y = target.y;
        // Notice: NO auto-pulling. Pulling is only triggered by explicit player input.
      }
    }
  }

  private pullRopeTarget(holder: Player): void {
    const rope = this.state.rope;
    const target = this.state.players.find(p => p.id === rope.attachedPlayerId);
    if (!target) return;

    // Pull victim off pipe violently down toward floor
    target.state = 'FALLING';
    target.stunnedTimer = 1.8;
    target.vy = 420; // Jerk downward
    target.vx = (holder.x - target.x) * 0.4;

    this.damagePlayer(target, 20, holder);
    this.emitSound({ type: 'ROPE_PULL', x: target.x, y: target.y });
    this.emitSound({ type: 'FALL_IMPACT', x: target.x, y: target.y });

    // Release rope back to floor at victim's landing spot
    this.dropRope(target.x, FLOOR_Y);
  }

  public dropRope(x?: number, y?: number): void {
    const rope = this.state.rope;
    rope.state = 'ON_FLOOR';
    rope.heldByPlayerId = null;
    rope.attachedPlayerId = null;
    rope.vx = 0;
    rope.vy = 0;
    rope.y = y !== undefined ? y : FLOOR_Y;
    rope.x = x !== undefined ? Math.max(100, Math.min(850, x)) : Math.max(100, Math.min(850, rope.x));
  }

  private updateProjectiles(): void {
    for (let i = this.state.projectiles.length - 1; i >= 0; i--) {
      const proj = this.state.projectiles[i];
      proj.x += proj.vx * DT;
      proj.y += proj.vy * DT;
      proj.vy += 300 * DT;
      proj.lifetime -= DT;

      let hit = false;
      for (const p of this.state.players) {
        if (p.id === proj.ownerId || p.state === 'DEAD' || p.hasEscaped) continue;
        const dist = Math.hypot(p.x - proj.x, p.y - proj.y);
        if (dist < 26) {
          hit = true;
          const thrower = this.state.players.find(x => x.id === proj.ownerId);

          if (p.state === 'CLIMBING_V_PIPE' || p.state === 'HANGING_H_PIPE') {
            p.state = 'FALLING';
            p.vy = 180;
          }
          p.stunnedTimer = 1.5;

          this.damagePlayer(p, 25, thrower);
          this.emitSound({ type: 'ROCK_HIT', x: p.x, y: p.y });
          break;
        }
      }

      if (hit || proj.lifetime <= 0 || proj.y >= FLOOR_Y || proj.x < 30 || proj.x > CHAMBER_WIDTH - 30) {
        this.state.projectiles.splice(i, 1);
      }
    }
  }

  private updatePlayersPhysics(): void {
    for (const p of this.state.players) {
      if (p.state === 'DEAD' || p.hasEscaped) continue;

      if (p.stamina < 100) p.stamina = Math.min(100, p.stamina + 20 * DT);
      if (p.tackleCooldown > 0) p.tackleCooldown -= DT;
      if (p.attackCooldown > 0) p.attackCooldown -= DT;

      if (p.stunnedTimer > 0) {
        p.stunnedTimer -= DT;
        if (p.stunnedTimer <= 0 && p.isGrounded) {
          p.state = 'ON_FLOOR';
        }
      }

      // Falling physics
      if (p.state === 'FALLING') {
        p.vy += GRAVITY * DT;
        p.x += p.vx * DT;
        p.y += p.vy * DT;

        // Ground collision
        if (p.y >= FLOOR_Y) {
          p.y = FLOOR_Y;
          p.vy = 0;
          p.vx = 0;
          p.isGrounded = true;
          p.state = p.stunnedTimer > 0 ? 'STUNNED' : 'ON_FLOOR';
          this.emitSound({ type: 'FALL_IMPACT', x: p.x, y: p.y });
        }
      } else if (p.state === 'ON_FLOOR') {
        p.x += p.vx * DT;
        p.y = FLOOR_Y;
      } else if (p.state === 'CLIMBING_V_PIPE') {
        p.y += p.vy * DT;
        p.x = V_PIPE_X;
      } else if (p.state === 'HANGING_H_PIPE') {
        p.x += p.vx * DT;
        p.y = H_PIPE_Y + 15;
      }

      // Chamber side bounds
      p.x = Math.max(50, Math.min(CHAMBER_WIDTH - 50, p.x));

      // Melee / Tackle collision between players on floor
      if (p.stunnedTimer > 0 && p.vx !== 0 && p.state === 'ON_FLOOR') {
        for (const other of this.state.players) {
          if (other.id === p.id || other.state === 'DEAD' || other.hasEscaped) continue;
          const dist = Math.hypot(other.x - p.x, other.y - p.y);
          if (dist < 32 && other.state === 'ON_FLOOR') {
            other.stunnedTimer = 1.2;
            other.state = 'STUNNED';
            other.vx = (p.facing === 'RIGHT' ? 1 : -1) * 220;
            this.damagePlayer(other, 20, p);
            this.emitSound({ type: 'TACKLE', x: other.x, y: other.y });
          }
        }
      }
    }
  }

  private triggerFinalPurge(): void {
    this.state.phase = 'PURGE';
    this.signalWindowTimer = 5.0;
    this.state.announcementText = 'OVERSEER: "10 MINUTES HAVE ELAPSED. PURGE THE PIT! NO SURVIVORS!"';
    this.emitSound({ type: 'CRASH' });

    for (const p of this.state.players) {
      if (!p.hasEscaped && p.state !== 'DEAD') {
        this.snipePlayer(p, 'CRASH_PURGE');
      }
    }
  }

  private snipePlayer(player: Player, reason: 'QUOTA_VIOLATED' | 'CRASH_PURGE'): void {
    if (player.state === 'DEAD' || player.hasEscaped) return;

    player.health = 0;
    player.state = 'DEAD';
    player.vy = 400; // Drop dead to floor

    if (this.state.rope.heldByPlayerId === player.id || this.state.rope.attachedPlayerId === player.id) {
      this.dropRope();
    }

    this.state.recentShots.push({
      id: `shot_${Date.now()}_${Math.random()}`,
      targetId: player.id,
      fromX: HATCH_ZONE.x + 30,
      fromY: HATCH_ZONE.y + 40,
      toX: player.x,
      toY: player.y,
      reason,
      timestamp: Date.now()
    });

    this.emitSound({ type: 'GUNSHOT', x: player.x, y: player.y });
  }
}
