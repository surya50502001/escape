import { 
  GameState, GamePhase, Player, Projectile, SniperShot, SoundEvent, ClientInput, Rope, HatchZone,
  Obstacle, FallingRock,
  MAX_PLAYERS, CHAMBER_WIDTH, CHAMBER_HEIGHT, FLOOR_Y, V_PIPE_X, V_PIPE_TOP_Y, H_PIPE_Y, H_PIPE_EXIT_X 
} from './types.js';

export const HATCH_ZONE: HatchZone = { x: 40, y: 40, width: 90, height: 90 };

export const INITIAL_OBSTACLES: Obstacle[] = [
  // 1. Spiked Floor Section
  {
    id: 'spikes_floor',
    type: 'SPIKES',
    x: 520,
    y: FLOOR_Y - 14,
    width: 100,
    height: 14,
    state: 'ACTIVE',
    timer: 0
  },
  // 2. Rusted Elevated Catwalk Platform
  {
    id: 'catwalk_platform',
    type: 'PLATFORM',
    x: 380,
    y: 440,
    width: 160,
    height: 14,
    state: 'ACTIVE',
    timer: 0
  },
  // 3. High-Pressure Steam Pipe Vent
  {
    id: 'steam_vent',
    type: 'STEAM_VENT',
    x: 260,
    y: FLOOR_Y - 16,
    width: 36,
    height: 120,
    state: 'IDLE',
    timer: 4.0
  },
  // 4. Moving Industrial Security Barrier Grate
  {
    id: 'moving_barrier',
    type: 'MOVING_BARRIER',
    x: 720,
    y: 490,
    width: 18,
    height: 125,
    state: 'ACTIVE',
    timer: 0,
    minY: 480,
    maxY: 590,
    vy: 45
  }
];

const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const GRAVITY = 750;

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function checkAABB(a: RectBounds, b: RectBounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function lineSegmentsIntersect(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number
): boolean {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function segmentIntersectsRect(
  x1: number, y1: number, x2: number, y2: number,
  rx: number, ry: number, rw: number, rh: number
): boolean {
  if (x1 >= rx && x1 <= rx + rw && y1 >= ry && y1 <= ry + rh) return true;
  if (x2 >= rx && x2 <= rx + rw && y2 >= ry && y2 <= ry + rh) return true;

  if (lineSegmentsIntersect(x1, y1, x2, y2, rx, ry, rx, ry + rh)) return true;
  if (lineSegmentsIntersect(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh)) return true;
  if (lineSegmentsIntersect(x1, y1, x2, y2, rx, ry, rx + rw, ry)) return true;
  if (lineSegmentsIntersect(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh)) return true;

  return false;
}

const HUMAN_COLORS = [
  '#22d3ee', '#f97316', '#a855f7', '#22c55e', '#eab308', 
  '#ec4899', '#3b82f6', '#14b8a6', '#f43f5e', '#84cc16'
];

export class GameEngine {
  public state: GameState;
  private pendingSoundEvents: SoundEvent[] = [];
  private matchTimer: number = 600; // 10 minutes
  private nextSignalTimer: number = 14;
  private signalWindowTimer: number = 0;
  private finalSilenceActive: boolean = false;
  private lobbyTimer: number = 15;
  private ceilingRockTimer: number = 10;

  constructor() {
    this.state = {
      phase: 'LOBBY',
      matchTimer: 600,
      lobbyCountdown: 0,
      maxPlayers: MAX_PLAYERS,
      signalQuota: 0,
      signalEscapedCount: 0,
      totalEscapedCount: 0,
      signalWindowRemaining: 0,
      nextSignalIn: 14,
      announcementText: 'WAITING FOR PRISONERS TO JOIN VIA LINK...',
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
        length: 220,
        pulling: false,
        maxDistance: 280
      },
      players: [],
      obstacles: INITIAL_OBSTACLES.map(o => ({ ...o })),
      fallingRocks: [],
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

    // Reset obstacles & hazards
    this.state.obstacles = INITIAL_OBSTACLES.map(o => ({ ...o }));
    this.state.fallingRocks = [];
    this.ceilingRockTimer = 10 + Math.random() * 6;

    this.nextSignalTimer = 14 + Math.random() * 8;
    this.state.announcementText = 'ANONYMOUS GUARDS THE UPPER HATCH. SURVIVE 10 MINUTES IN THE CELL.';
    this.emitSound({ type: 'CLANG' });

    // Spawn connected human players along the floor
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
      p.climbKickTimer = 0;
      p.climbAttackCooldown = 0;
      p.climbGrabbingId = null;
      p.grabbedByPlayerId = null;
      p.struggleMeter = 0;
      p.hazardCooldown = 0;
    });
  }

  /**
   * Only human players who open the link join the chamber.
   * No NPCs / bots are created.
   */
  public addHumanPlayer(id: string, name: string): Player | null {
    // 1. Reconnect check
    const existing = this.state.players.find(x => x.id === id);
    if (existing) {
      if (name) existing.name = name;
      return existing;
    }

    if (this.state.players.length >= MAX_PLAYERS) {
      return null;
    }

    const color = HUMAN_COLORS[this.state.players.length % HUMAN_COLORS.length];
    const p: Player = {
      id,
      name: name || `Prisoner ${this.state.players.length + 1}`,
      isBot: false,
      x: 180 + (this.state.players.length * 65) % 650,
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
      sabotages: 0,
      climbKickTimer: 0,
      climbAttackCooldown: 0,
      climbGrabbingId: null,
      grabbedByPlayerId: null,
      struggleMeter: 0,
      hazardCooldown: 0
    };

    this.state.players.push(p);

    // If joining during an active match or lobby, they enter safely without corrupting match state
    return p;
  }

  public releaseClimbGrab(grabber: Player, dropVictim: boolean = true): void {
    if (!grabber.climbGrabbingId) return;
    const victim = this.state.players.find(p => p.id === grabber.climbGrabbingId);
    grabber.climbGrabbingId = null;
    if (victim) {
      victim.grabbedByPlayerId = null;
      victim.struggleMeter = 0;
      if (dropVictim && victim.state !== 'DEAD' && !victim.hasEscaped) {
        victim.state = 'FALLING';
        victim.isGrounded = false;
        victim.vy = 90;
      }
    }
  }

  public breakGrabOnVictim(victim: Player): void {
    if (!victim.grabbedByPlayerId) return;
    const grabber = this.state.players.find(p => p.id === victim.grabbedByPlayerId);
    victim.grabbedByPlayerId = null;
    victim.struggleMeter = 0;
    if (grabber) {
      grabber.climbGrabbingId = null;
    }
  }

  public handleClimbingCombat(p: Player, input: ClientInput): boolean {
    if (p.state !== 'CLIMBING_V_PIPE' && p.state !== 'HANGING_H_PIPE') {
      if (p.climbGrabbingId) this.releaseClimbGrab(p, true);
      if (p.grabbedByPlayerId) this.breakGrabOnVictim(p);
      return false;
    }

    // 1. VICTIM STRUGGLE COUNTERPLAY
    if (p.grabbedByPlayerId) {
      const strugglePressed = Boolean(input.struggle || input.tackle || input.jump || input.up);
      if (strugglePressed) {
        const staminaCost = 10;
        p.stamina = Math.max(0, p.stamina - staminaCost);
        // Gain struggle escape progress (full speed if has stamina, half if exhausted)
        p.struggleMeter = Math.min(100, p.struggleMeter + (p.stamina > 0 ? 30 : 16));
        this.emitSound({ type: 'CLIMB_STRUGGLE', x: p.x, y: p.y });

        if (p.struggleMeter >= 100) {
          // Break free! Stunning the attacker briefly
          const grabber = this.state.players.find(x => x.id === p.grabbedByPlayerId);
          if (grabber) {
            grabber.climbGrabbingId = null;
            grabber.stunnedTimer = 0.6;
            grabber.climbAttackCooldown = 1.0;
            if (grabber.state === 'CLIMBING_V_PIPE') {
              grabber.vx = -60;
            }
          }
          p.grabbedByPlayerId = null;
          p.struggleMeter = 0;
          this.emitSound({ type: 'TACKLE', x: p.x, y: p.y });
        }
      }
      p.vx = 0;
      p.vy = 0;
      return true; // Grabbed victim cannot climb or traverse while held
    }

    // 2. ATTACKER HOLDING & DRAGGING VICTIM
    if (p.climbGrabbingId) {
      const isHolding = Boolean(input.climbGrab);
      if (!isHolding) {
        // Grab released by attacker
        this.releaseClimbGrab(p, true);
        return false;
      }

      // Drag downward
      if (input.down) {
        p.vy = p.state === 'CLIMBING_V_PIPE' ? 75 : 40;
      } else {
        p.vy = 0;
      }
      p.vx = 0;

      // Check if dragged to floor
      if (p.y >= FLOOR_Y) {
        this.releaseClimbGrab(p, false);
        p.y = FLOOR_Y;
        p.state = 'ON_FLOOR';
        p.isGrounded = true;
      }
      return true;
    }

    // 3. KICK OR GRAB INITIATION
    if (p.climbAttackCooldown <= 0) {
      if (input.climbKick) {
        p.climbKickTimer = 0.22;
        p.climbAttackCooldown = 0.75;
        this.emitSound({ type: 'CLIMB_KICK', x: p.x, y: p.y });

        // Directional hit-scan: strictly beneath/forward from attacking player
        let hitTarget: Player | undefined;
        if (p.state === 'CLIMBING_V_PIPE') {
          hitTarget = this.state.players.find(target => {
            if (target.id === p.id || target.state === 'DEAD' || target.hasEscaped) return false;
            const dy = target.y - p.y;
            const dx = Math.abs(target.x - p.x);
            // Target must be strictly beneath attacker (dy > 10) and within 65px
            return dy > 10 && dy <= 65 && dx <= 30;
          });
        } else if (p.state === 'HANGING_H_PIPE') {
          hitTarget = this.state.players.find(target => {
            if (target.id === p.id || target.state === 'DEAD' || target.hasEscaped) return false;
            const dy = target.y - p.y;
            const fwdX = p.facing === 'LEFT' ? (p.x - target.x) : (target.x - p.x);
            return dy >= -10 && dy <= 65 && fwdX >= 0 && fwdX <= 55;
          });
        }

        if (hitTarget) {
          // Kick connects! Detach target from pipe with knockback impulse & stun
          hitTarget.state = 'FALLING';
          hitTarget.isGrounded = false;
          hitTarget.stunnedTimer = 0.8;
          if (p.state === 'CLIMBING_V_PIPE') {
            hitTarget.vx = -160;
            hitTarget.vy = 220;
          } else {
            hitTarget.vx = (p.facing === 'LEFT' ? -180 : 180);
            hitTarget.vy = 200;
          }
          this.damagePlayer(hitTarget, 18, p);
          this.emitSound({ type: 'TACKLE', x: hitTarget.x, y: hitTarget.y });
          this.emitSound({ type: 'FALL_IMPACT', x: hitTarget.x, y: hitTarget.y });
        } else if (input.climbGrab) {
          // Kick missed: check if grab input is held
          this.attemptClimbGrab(p);
        }
      } else if (input.climbGrab) {
        // Grab held directly
        this.attemptClimbGrab(p);
      }
    }

    return false;
  }

  public attemptClimbGrab(p: Player): boolean {
    if (p.climbGrabbingId || p.grabbedByPlayerId) return false;
    let grabTarget: Player | undefined;
    if (p.state === 'CLIMBING_V_PIPE') {
      grabTarget = this.state.players.find(target => {
        if (target.id === p.id || target.state === 'DEAD' || target.hasEscaped) return false;
        if (target.grabbedByPlayerId || target.climbGrabbingId) return false;
        const dy = target.y - p.y;
        const dx = Math.abs(target.x - p.x);
        return dy > 10 && dy <= 70 && dx <= 32;
      });
    } else if (p.state === 'HANGING_H_PIPE') {
      grabTarget = this.state.players.find(target => {
        if (target.id === p.id || target.state === 'DEAD' || target.hasEscaped) return false;
        if (target.grabbedByPlayerId || target.climbGrabbingId) return false;
        const dy = target.y - p.y;
        const fwdX = p.facing === 'LEFT' ? (p.x - target.x) : (target.x - p.x);
        return dy >= -10 && dy <= 70 && fwdX >= 0 && fwdX <= 60;
      });
    }

    if (grabTarget) {
      p.climbGrabbingId = grabTarget.id;
      grabTarget.grabbedByPlayerId = p.id;
      grabTarget.struggleMeter = 0;
      grabTarget.vx = 0;
      grabTarget.vy = 0;
      this.emitSound({ type: 'CLIMB_GRAB', x: grabTarget.x, y: grabTarget.y });
      return true;
    }
    return false;
  }

  public removePlayer(id: string, permanent: boolean = false): void {
    const player = this.state.players.find(p => p.id === id);
    if (!player) return;

    // Immediately clear rope and climbing combat interactions so other players aren't stuck
    if (this.state.rope.heldByPlayerId === id || this.state.rope.attachedPlayerId === id) {
      this.dropRope();
    }
    if (player.climbGrabbingId) {
      this.releaseClimbGrab(player, true);
    }
    if (player.grabbedByPlayerId) {
      this.breakGrabOnVictim(player);
    }

    if (this.state.phase === 'LOBBY' || this.state.phase === 'MATCH_OVER' || permanent) {
      this.state.players = this.state.players.filter(p => p.id !== id);
      if (this.state.players.length === 0) {
        this.state.phase = 'LOBBY';
        this.lobbyTimer = 15;
        this.state.lobbyCountdown = 0;
        this.state.announcementText = 'WAITING FOR PRISONERS TO JOIN VIA LINK...';
      }
    } else {
      // Temporary disconnect during active match: halt physics velocity but retain slot for reconnect
      player.vx = 0;
      player.vy = 0;
    }
  }

  public ensureTenPlayers(): void {
    // Pure human multiplayer: No NPCs or bots
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

      const combatOverrode = this.handleClimbingCombat(p, input);
      if (combatOverrode) {
        return;
      }

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

      const combatOverrode = this.handleClimbingCombat(p, input);
      if (combatOverrode) {
        return;
      }

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

      // Reached escape opening at upper-left: clamp coordinate
      if (p.x < 40) {
        p.x = 40;
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
          p.attackCooldown = 0.8;
          this.state.rope.state = 'THROWN';
          this.state.rope.x = p.x;
          this.state.rope.y = p.y - 18;
          this.state.rope.startX = p.x;
          this.state.rope.startY = p.y - 18;
          this.state.rope.maxDistance = 500;
          const throwSpeed = 520;
          this.state.rope.vx = Math.cos(p.angle) * throwSpeed;
          this.state.rope.vy = Math.sin(p.angle) * throwSpeed;
        }

        if (input.interact) {
          this.dropRope(p.x, p.y);
        }
      } else if (this.state.rope.state === 'ATTACHED') {
        // Explicit pull action: input.pull or floor tackle key
        if (input.pull || (input.tackle && p.state === 'ON_FLOOR')) {
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

    // Taking damage interrupts climbing grabs
    if (player.climbGrabbingId) {
      this.releaseClimbGrab(player, true);
    }
    if (player.grabbedByPlayerId) {
      this.breakGrabOnVictim(player);
    }

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
      const playerCount = this.state.players.length;
      if (playerCount >= 2) {
        this.lobbyTimer -= DT;
        this.state.lobbyCountdown = Math.max(0, Math.ceil(this.lobbyTimer));
        this.state.announcementText = `LOBBY: ${playerCount}/${MAX_PLAYERS} PRISONERS. MATCH STARTING IN ${this.state.lobbyCountdown}s...`;
        if (this.lobbyTimer <= 0) {
          this.startNewMatch();
        }
      } else if (playerCount === 1) {
        this.lobbyTimer = 15;
        this.state.lobbyCountdown = 15;
        this.state.announcementText = `LOBBY: 1/${MAX_PLAYERS} PRISONER READY. WAITING FOR OTHERS TO JOIN VIA LINK...`;
      } else {
        this.lobbyTimer = 15;
        this.state.lobbyCountdown = 0;
        this.state.announcementText = 'WAITING FOR PRISONERS TO JOIN VIA LINK...';
      }
      this.updatePlayersPhysics();
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

    // Physics & Hazard updates
    this.updateObstacles();
    this.updateFallingRocks();
    this.updateRopePhysics();
    this.updateProjectiles();
    this.updatePlayersPhysics();
    this.resolveEscapeAttempts();

    this.flushSoundEvents();
  }

  public updateObstacles(): void {
    for (const obs of this.state.obstacles) {
      if (obs.type === 'STEAM_VENT') {
        obs.timer -= DT;
        if (obs.state === 'IDLE') {
          if (obs.timer <= 0) {
            obs.state = 'WARNING';
            obs.timer = 1.5;
            this.emitSound({ type: 'STEAM_HISS', x: obs.x, y: obs.y });
          }
        } else if (obs.state === 'WARNING') {
          if (obs.timer <= 0) {
            obs.state = 'ACTIVE';
            obs.timer = 2.5;
            this.emitSound({ type: 'STEAM_BURST', x: obs.x, y: obs.y });
          }
        } else if (obs.state === 'ACTIVE') {
          // Check collision with players in vertical steam column
          for (const p of this.state.players) {
            if (p.state === 'DEAD' || p.hasEscaped) continue;
            if (p.x >= obs.x - 14 && p.x <= obs.x + obs.width + 14 && p.y >= obs.y - obs.height && p.y <= FLOOR_Y + 10) {
              if (p.hazardCooldown <= 0) {
                p.hazardCooldown = 0.5;
                this.damagePlayer(p, 15);
                p.vy = -240;
                p.vx = -120;
                p.isGrounded = false;
                p.state = 'FALLING';
                p.stunnedTimer = Math.max(p.stunnedTimer, 0.4);
              }
            }
          }
          if (obs.timer <= 0) {
            obs.state = 'IDLE';
            obs.timer = 4.0;
          }
        }
      } else if (obs.type === 'MOVING_BARRIER') {
        if (obs.vy !== undefined && obs.minY !== undefined && obs.maxY !== undefined) {
          obs.y += obs.vy * DT;
          if (obs.y >= obs.maxY) {
            obs.y = obs.maxY;
            obs.vy = -Math.abs(obs.vy);
          } else if (obs.y <= obs.minY) {
            obs.y = obs.minY;
            obs.vy = Math.abs(obs.vy);
          }
        }
      }
    }
  }

  public updateFallingRocks(): void {
    if (this.state.phase === 'LOBBY' || this.state.phase === 'MATCH_OVER') return;

    this.ceilingRockTimer -= DT;
    if (this.ceilingRockTimer <= 0) {
      this.ceilingRockTimer = 11 + Math.random() * 6;
      // Spawn a new rock with warning phase at random position along ceiling
      const rockX = 220 + Math.random() * 620;
      this.state.fallingRocks.push({
        id: `rock_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        x: rockX,
        y: 85,
        vy: 0,
        warningTimer: 1.2,
        active: true
      });
    }

    for (const rock of this.state.fallingRocks) {
      if (!rock.active) continue;

      if (rock.warningTimer > 0) {
        rock.warningTimer -= DT;
      } else {
        rock.vy += 620 * DT;
        rock.y += rock.vy * DT;

        // Player collision
        for (const p of this.state.players) {
          if (p.state === 'DEAD' || p.hasEscaped) continue;
          const dist = Math.hypot(p.x - rock.x, (p.y - 15) - rock.y);
          if (dist < 30) {
            this.damagePlayer(p, 25);
            p.stunnedTimer = 1.2;
            p.state = 'FALLING';
            p.vy = 220;
            rock.active = false;
            this.emitSound({ type: 'ROCK_HIT', x: p.x, y: p.y });
            break;
          }
        }

        // Floor impact
        if (rock.y >= FLOOR_Y - 8) {
          rock.active = false;
          this.emitSound({ type: 'ROCK_FALL', x: rock.x, y: FLOOR_Y });
        }
      }
    }

    this.state.fallingRocks = this.state.fallingRocks.filter(r => r.active);
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
    if (this.state.players.length > 0 && livingInPit.length === 0) {
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

  public resolveEscapeAttempts(): void {
    // Gather all living unescaped players currently at or past the exit threshold hanging on ceiling pipe
    const candidates = this.state.players.filter(p => 
      !p.hasEscaped && 
      p.state === 'HANGING_H_PIPE' && 
      p.x <= H_PIPE_EXIT_X && 
      p.health > 0
    );

    if (candidates.length === 0) return;

    // Strictly deterministic sort:
    // 1. Primary: x coordinate ascending (furthest into the hatch duct first)
    // 2. Secondary: id ascending (guaranteed deterministic tiebreaker across platforms)
    candidates.sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.id.localeCompare(b.id);
    });

    const quotaAllowed = this.state.phase === 'SIGNAL_ACTIVE'
      ? Math.max(0, this.state.signalQuota - this.state.signalEscapedCount)
      : 0;

    let availableSlots = quotaAllowed;

    for (const player of candidates) {
      if (availableSlots > 0 && this.state.signalEscapedCount < this.state.signalQuota) {
        // Escaped!
        player.hasEscaped = true;
        player.state = 'ESCAPED';
        const mins = Math.floor((600 - this.matchTimer) / 60);
        const secs = Math.floor((600 - this.matchTimer) % 60);
        player.escapeTime = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

        this.state.signalEscapedCount++;
        this.state.totalEscapedCount++;
        availableSlots--;

        this.emitSound({ type: 'ESCAPE', x: player.x, y: player.y });

        // Clean up rope if escaping player held or was attached to it
        if (this.state.rope.heldByPlayerId === player.id || this.state.rope.attachedPlayerId === player.id) {
          this.dropRope();
        }
      } else {
        // Quota exhausted or hatch not active -> Overseer snipes violator!
        this.snipePlayer(player, 'QUOTA_VIOLATED');
      }
    }

    if (this.state.phase === 'SIGNAL_ACTIVE' && this.state.signalEscapedCount >= this.state.signalQuota) {
      this.closeHatch('QUOTA_FILLED');
    }
  }

  public attemptEscape(player?: Player): void {
    this.resolveEscapeAttempts();
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
    rope.pulling = false;
    if (rope.pullDamageCooldown && rope.pullDamageCooldown > 0) {
      rope.pullDamageCooldown -= DT;
    }

    if (rope.state === 'HELD') {
      const holder = this.state.players.find(p => p.id === rope.heldByPlayerId);
      if (!holder || holder.state === 'DEAD' || holder.hasEscaped) {
        this.dropRope();
      } else {
        rope.x = holder.x;
        rope.y = holder.y - 15;
      }
    } else if (rope.state === 'THROWN') {
      const prevX = rope.x;
      const prevY = rope.y;
      rope.x += rope.vx * DT;
      rope.y += rope.vy * DT;
      rope.vy += 280 * DT; // Slight gravity on thrown rope

      // Check max travel range
      if (rope.startX !== undefined && rope.startY !== undefined) {
        const traveled = Math.hypot(rope.x - rope.startX, rope.y - rope.startY);
        if (traveled > (rope.maxDistance || 500)) {
          this.dropRope(rope.x, FLOOR_Y);
          return;
        }
      }

      // Chamber walls / floor collision
      if (rope.y >= FLOOR_Y || rope.x < 30 || rope.x > CHAMBER_WIDTH - 30 || rope.y < 30) {
        this.dropRope(Math.max(40, Math.min(CHAMBER_WIDTH - 40, rope.x)), FLOOR_Y);
        return;
      }

      // Check collision with solid moving barrier
      const barrier = this.state.obstacles.find(o => o.type === 'MOVING_BARRIER');
      if (barrier && segmentIntersectsRect(prevX, prevY, rope.x, rope.y, barrier.x, barrier.y, barrier.width, barrier.height)) {
        this.dropRope(rope.x, FLOOR_Y);
        return;
      }

      // Check collision with ALL other living players (standing, climbing, hanging, falling)
      for (const p of this.state.players) {
        if (p.id === rope.heldByPlayerId || p.state === 'DEAD' || p.hasEscaped) continue;
        const dist = Math.hypot(p.x - rope.x, (p.y - 15) - rope.y);
        if (dist < 36) {
          // Check line-of-sight: solid barrier cannot block rope attachment
          if (barrier && segmentIntersectsRect(rope.startX || rope.x, rope.startY || rope.y, p.x, p.y - 15, barrier.x, barrier.y, barrier.width, barrier.height)) {
            continue;
          }
          rope.state = 'ATTACHED';
          rope.attachedPlayerId = p.id;
          rope.x = p.x;
          rope.y = p.y - 15;
          rope.pullDamageCooldown = 0;
          this.emitSound({ type: 'ROPE_ATTACH', x: p.x, y: p.y });
          break;
        }
      }
    } else if (rope.state === 'ATTACHED') {
      const holder = this.state.players.find(p => p.id === rope.heldByPlayerId);
      const target = this.state.players.find(p => p.id === rope.attachedPlayerId);

      if (!holder || !target || holder.state === 'DEAD' || target.state === 'DEAD' || target.hasEscaped) {
        this.dropRope();
      } else {
        rope.x = holder.x;
        rope.y = holder.y - 15;

        // Tether constraint: prevent victim from running further than max rope length
        const dx = target.x - holder.x;
        const dy = target.y - holder.y;
        const dist = Math.hypot(dx, dy);
        const maxDist = rope.maxDistance || 280;
        if (dist > maxDist) {
          const excess = dist - maxDist;
          const nx = dx / dist;
          const ny = dy / dist;
          target.x -= nx * excess;
          target.y -= ny * excess;
          target.vx *= 0.3;
        }
      }
    }
  }

  public pullRopeTarget(holder: Player): void {
    const rope = this.state.rope;
    const target = this.state.players.find(p => p.id === rope.attachedPlayerId);
    if (!target) return;

    rope.pulling = true;
    const dx = holder.x - target.x;
    const dy = (holder.y - 15) - target.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    // Pull victim toward holder
    if (target.state === 'CLIMBING_V_PIPE' || target.state === 'HANGING_H_PIPE') {
      // Violent yank off pipe into falling freefall!
      target.state = 'FALLING';
      target.isGrounded = false;
      target.stunnedTimer = 0.8;
      target.vx = Math.max(-250, Math.min(250, nx * 220));
      target.vy = 120;
      this.damagePlayer(target, 15, holder);
      this.emitSound({ type: 'ROPE_PULL', x: target.x, y: target.y });
      this.emitSound({ type: 'FALL_IMPACT', x: target.x, y: target.y });
      this.dropRope();
    } else {
      // Continuous dragging toward holder with clamped velocities
      const dragSpeed = 240;
      target.vx = Math.max(-280, Math.min(280, nx * dragSpeed));
      target.vy = Math.max(-180, Math.min(180, ny * 120 - 30));

      // Separate continuous pulling movement from discrete damage events
      if (!rope.pullDamageCooldown || rope.pullDamageCooldown <= 0) {
        rope.pullDamageCooldown = 1.0; // 1-second cooldown between damage pulls
        this.damagePlayer(target, 10, holder);
        target.stunnedTimer = Math.max(target.stunnedTimer, 0.3);
        this.emitSound({ type: 'ROPE_PULL', x: target.x, y: target.y });
      }
    }
  }

  public dropRope(x?: number, y?: number): void {
    const rope = this.state.rope;
    rope.state = 'ON_FLOOR';
    rope.heldByPlayerId = null;
    rope.attachedPlayerId = null;
    rope.pulling = false;
    rope.pullDamageCooldown = 0;
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
    const catwalk = this.state.obstacles.find(o => o.type === 'PLATFORM');
    const barrier = this.state.obstacles.find(o => o.type === 'MOVING_BARRIER');
    const spikes = this.state.obstacles.find(o => o.type === 'SPIKES');

    for (const p of this.state.players) {
      if (p.state === 'DEAD' || p.hasEscaped) continue;

      if (p.stamina < 100 && !p.climbGrabbingId) p.stamina = Math.min(100, p.stamina + 20 * DT);
      if (p.tackleCooldown > 0) p.tackleCooldown -= DT;
      if (p.attackCooldown > 0) p.attackCooldown -= DT;
      if (p.climbAttackCooldown > 0) p.climbAttackCooldown -= DT;
      if (p.climbKickTimer > 0) p.climbKickTimer -= DT;
      if (p.hazardCooldown > 0) p.hazardCooldown -= DT;

      // Handle active climbing grab maintenance and stamina drain
      if (p.climbGrabbingId) {
        const victim = this.state.players.find(x => x.id === p.climbGrabbingId);
        if (!victim || victim.state === 'DEAD' || victim.hasEscaped || p.stunnedTimer > 0 || (p.state !== 'CLIMBING_V_PIPE' && p.state !== 'HANGING_H_PIPE')) {
          this.releaseClimbGrab(p, true);
        } else {
          // Attacker drains stamina while holding victim
          p.stamina = Math.max(0, p.stamina - 14 * DT);
          if (p.stamina <= 0) {
            this.releaseClimbGrab(p, true);
            p.climbAttackCooldown = 1.0;
          } else {
            // Keep victim attached beneath attacker
            victim.x = p.x;
            victim.y = p.y + 42;
            victim.vx = 0;
            victim.vy = 0;
            victim.isGrounded = false;
          }
        }
      }

      if (p.grabbedByPlayerId) {
        const grabber = this.state.players.find(x => x.id === p.grabbedByPlayerId);
        if (!grabber || grabber.state === 'DEAD' || grabber.hasEscaped || grabber.climbGrabbingId !== p.id) {
          p.grabbedByPlayerId = null;
        }
      }

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

        // Catwalk Platform Collision (landing on top surface)
        if (catwalk && p.vy > 0) {
          if (p.y >= catwalk.y - 8 && p.y <= catwalk.y + 16 && p.x >= catwalk.x - 10 && p.x <= catwalk.x + catwalk.width + 10) {
            p.y = catwalk.y;
            p.vy = 0;
            p.vx = 0;
            p.isGrounded = true;
            p.state = p.stunnedTimer > 0 ? 'STUNNED' : 'ON_FLOOR';
            this.emitSound({ type: 'FALL_IMPACT', x: p.x, y: p.y });
          }
        }

        // Concrete Floor Collision
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

        // Check if player walked off elevated catwalk
        if (catwalk && Math.abs(p.y - catwalk.y) < 5) {
          if (p.x < catwalk.x - 10 || p.x > catwalk.x + catwalk.width + 10) {
            p.isGrounded = false;
            p.state = 'FALLING';
          }
        } else {
          p.y = FLOOR_Y;
        }

        // Spiked floor hazard check (controlled damage interval and outward knockback)
        if (spikes && p.y >= FLOOR_Y - 4) {
          if (p.x >= spikes.x - 2 && p.x <= spikes.x + spikes.width + 2) {
            if (p.hazardCooldown <= 0) {
              p.hazardCooldown = 0.6;
              this.damagePlayer(p, 15);
              p.vy = -180;
              p.vx = p.x < (spikes.x + spikes.width / 2) ? -90 : 90;
              p.isGrounded = false;
              p.state = 'FALLING';
              this.emitSound({ type: 'SPIKE_HIT', x: p.x, y: p.y });
            }
          }
        }
      } else if (p.state === 'CLIMBING_V_PIPE') {
        p.y += p.vy * DT;
        p.x = V_PIPE_X;
        if (p.climbGrabbingId) {
          const victim = this.state.players.find(x => x.id === p.climbGrabbingId);
          if (victim) {
            victim.x = p.x;
            victim.y = p.y + 42;
          }
        }
      } else if (p.state === 'HANGING_H_PIPE') {
        p.x += p.vx * DT;
        p.y = H_PIPE_Y + 15;
        if (p.climbGrabbingId) {
          const victim = this.state.players.find(x => x.id === p.climbGrabbingId);
          if (victim) {
            victim.x = p.x;
            victim.y = p.y + 42;
          }
        }
      }

      // Moving Barrier Solid Obstacle Collision (prevent crossing through moving gate)
      if (barrier && p.y >= barrier.y - 10 && p.y <= barrier.y + barrier.height + 10) {
        if (p.x >= barrier.x - 18 && p.x <= barrier.x + barrier.width + 18) {
          const midBarrierX = barrier.x + barrier.width / 2;
          if (p.x < midBarrierX) {
            p.x = barrier.x - 18;
            if (p.vx > 0) p.vx = 0;
          } else {
            p.x = barrier.x + barrier.width + 18;
            if (p.vx < 0) p.vx = 0;
          }
        }
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
