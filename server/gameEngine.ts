import { 
  GameState, GamePhase, Player, Projectile, SniperShot, SoundEvent, ClientInput, Rope, HatchZone,
  Obstacle, FallingRock, Ladder, WallRect, MAZE_WALLS,
  MAX_PLAYERS, WORLD_WIDTH, WORLD_HEIGHT, FLOOR_Y, LOWER_FLOOR_Y,
  V_PIPE_X, V_PIPE_TOP_Y, H_PIPE_Y, H_PIPE_EXIT_X,
  DORM_LEDGE_Y, DORM_LEFT_X, DORM_RIGHT_X,
  MAINT_ROOM_LEFT_X, SPAWN_LEFT_X, SPAWN_RIGHT_X,
  SHAFT_LEFT_X, SHAFT_RIGHT_X, BASEMENT_ENTRY_X,
  MAINT_UPPER_LEDGE_Y, MAINT_UPPER_LEDGE_X, MAINT_UPPER_LEDGE_W
} from './types.js';

export type { WallRect };
export { MAZE_WALLS };

export const HATCH_ZONE: HatchZone = { x: 40, y: 40, width: 90, height: 90 };


/**
 * Ladder spawn positions — initial world positions for the two ladders.
 * One is in the maintenance room, one is in storage area right of main floor.
 */
export const INITIAL_LADDER_POSITIONS: Array<{ id: string; x: number; y: number; height: number }> = [
  // Route A: maintenance room ladder — base on main floor, top reaches MAINT_UPPER_LEDGE_Y
  { id: 'ladder_maint',   x: 200,  y: MAINT_UPPER_LEDGE_Y, height: FLOOR_Y - MAINT_UPPER_LEDGE_Y },
  // General-use ladder in storage area right of main floor — base on main floor, top reaches service corridor at Y=500
  { id: 'ladder_storage', x: 1320, y: FLOOR_Y - 120, height: 120 },
];

/**
 * Platform-type obstacles that still appear in the world.
 * (SPIKES and STEAM_VENT removed — not exploration-meaningful)
 */
export const INITIAL_OBSTACLES: Obstacle[] = [
  {
    id: 'moving_barrier',
    type: 'MOVING_BARRIER',
    x: 1250,
    y: 516,
    width: 18,
    height: 80,
    state: 'ACTIVE',
    timer: 0,
    minY: 516,
    maxY: 600,
    vy: 38
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

/** Floor Y below the player's position */
function getNearestFloorY(px: number, py: number): number {
  // If player is below the main floor level (in the basement passages)
  if (py > FLOOR_Y + 30) {
    return LOWER_FLOOR_Y;
  }
  // Shaft gap: players fall through to basement
  if (px >= SHAFT_LEFT_X && px <= SHAFT_RIGHT_X) {
    return LOWER_FLOOR_Y;
  }
  return FLOOR_Y;
}

/** Check if player is standing on any maze platform surface */
function getPlayerLandingY(
  px: number, py: number, vy: number,
  walls: WallRect[], obstacles: Obstacle[], ladders: Ladder[]
): number | null {
  if (vy <= 0) return null; // Only land when falling down

  const playerRadius = 12;
  let bestY: number | null = null;

  // Check maze walls (platforms and solid tops)
  for (const w of walls) {
    if (w.x > 0 && w.y === 0 && w.width === WORLD_WIDTH) continue; // Skip ceiling for landing
    const surfaceY = w.y;
    // Player center is 15px above feet, check if px is over platform
    if (px >= w.x - playerRadius && px <= w.x + w.width + playerRadius) {
      if (py <= surfaceY + 12 && py >= surfaceY - 60) {
        if (bestY === null || surfaceY < bestY) {
          bestY = surfaceY;
        }
      }
    }
  }

  // Check obstacles (PLATFORM type)
  for (const obs of obstacles) {
    if (obs.type === 'PLATFORM') {
      if (px >= obs.x - playerRadius && px <= obs.x + obs.width + playerRadius) {
        if (py <= obs.y + 12 && py >= obs.y - 60) {
          if (bestY === null || obs.y < bestY) {
            bestY = obs.y;
          }
        }
      }
    }
  }

  // Check placed ladders (can stand on top)
  for (const ladder of ladders) {
    if (ladder.state !== 'PLACED' || !ladder.isPlaced) continue;
    const lTop = ladder.y;
    if (px >= ladder.x - 16 && px <= ladder.x + ladder.width + 16) {
      if (py <= lTop + 12 && py >= lTop - 40) {
        if (bestY === null || lTop < bestY) {
          bestY = lTop;
        }
      }
    }
  }

  return bestY;
}

/** Check horizontal wall collision */
function resolveHorizontalWallCollision(
  px: number, py: number, playerHalfW: number,
  walls: WallRect[]
): number {
  let rx = px;
  for (const w of walls) {
    if (!w.solid && !w.isPlatform) continue;
    if (w.solid === false && w.isPlatform !== true) continue;
    // Only solid vertical walls block horizontally (skip wide horizontal floor/ceiling slabs)
    if (!w.solid || w.width > 120) continue;
    // If player's feet are at or above the top surface (+6px tolerance for standing on it),
    // they are walking on top of it, not colliding with its vertical side.
    if (py <= w.y + 6) continue;
    if (py - 45 > w.y + w.height) continue;
    // Check overlap
    const pLeft = rx - playerHalfW;
    const pRight = rx + playerHalfW;
    const wLeft = w.x;
    const wRight = w.x + w.width;
    if (pRight > wLeft && pLeft < wRight) {
      const overlapL = pRight - wLeft;
      const overlapR = wRight - pLeft;
      if (overlapL < overlapR) {
        rx = wLeft - playerHalfW;
      } else {
        rx = wRight + playerHalfW;
      }
    }
  }
  return rx;
}

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
      soundEvents: [],
      ladders: this.createInitialLadders()
    };
  }

  private createInitialLadders(): Ladder[] {
    return INITIAL_LADDER_POSITIONS.map(pos => ({
      id: pos.id,
      x: pos.x,
      y: pos.y,
      width: 20,
      height: pos.height,
      state: 'PLACED' as const,
      carriedByPlayerId: null,
      isPlaced: true,
      leanAngle: 0
    }));
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

    // Reset rope onto main floor
    this.dropRope(700, FLOOR_Y);

    // Reset obstacles & hazards
    this.state.obstacles = INITIAL_OBSTACLES.map(o => ({ ...o }));
    this.state.fallingRocks = [];
    this.ceilingRockTimer = 10 + Math.random() * 6;

    // Reset ladders to initial positions
    this.state.ladders = this.createInitialLadders();

    this.nextSignalTimer = 14 + Math.random() * 8;
    this.state.announcementText = 'ANONYMOUS GUARDS THE UPPER HATCH. SURVIVE 10 MINUTES OR ESCAPE THE PIT.';
    this.emitSound({ type: 'CLANG' });

    // Spawn connected human players along the main floor
    this.state.players.forEach((p, idx) => {
      p.x = SPAWN_LEFT_X + idx * 65;
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
      p.carryingLadderId = null;
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
      x: SPAWN_LEFT_X + (this.state.players.length * 65) % 800,
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
      hazardCooldown: 0,
      carryingLadderId: null
    };

    this.state.players.push(p);
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
    if (p.state !== 'CLIMBING_V_PIPE' && p.state !== 'HANGING_H_PIPE' && p.state !== 'CLIMBING_LADDER') {
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
        p.struggleMeter = Math.min(100, p.struggleMeter + (p.stamina > 0 ? 30 : 16));
        this.emitSound({ type: 'CLIMB_STRUGGLE', x: p.x, y: p.y });

        if (p.struggleMeter >= 100) {
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
      return true;
    }

    // 2. ATTACKER HOLDING & DRAGGING VICTIM
    if (p.climbGrabbingId) {
      const isHolding = Boolean(input.climbGrab);
      if (!isHolding) {
        this.releaseClimbGrab(p, true);
        return false;
      }
      if (input.down) {
        p.vy = p.state === 'CLIMBING_V_PIPE' ? 75 : 40;
      } else {
        p.vy = 0;
      }
      p.vx = 0;
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

        let hitTarget: Player | undefined;
        if (p.state === 'CLIMBING_V_PIPE') {
          hitTarget = this.state.players.find(target => {
            if (target.id === p.id || target.state === 'DEAD' || target.hasEscaped) return false;
            const dy = target.y - p.y;
            const dx = Math.abs(target.x - p.x);
            return dy > 10 && dy <= 65 && dx <= 30;
          });
        } else if (p.state === 'HANGING_H_PIPE') {
          hitTarget = this.state.players.find(target => {
            if (target.id === p.id || target.state === 'DEAD' || target.hasEscaped) return false;
            const dy = target.y - p.y;
            const fwdX = p.facing === 'LEFT' ? (p.x - target.x) : (target.x - p.x);
            return dy >= -10 && dy <= 65 && fwdX >= 0 && fwdX <= 55;
          });
        } else if (p.state === 'CLIMBING_LADDER') {
          hitTarget = this.state.players.find(target => {
            if (target.id === p.id || target.state === 'DEAD' || target.hasEscaped) return false;
            const dy = target.y - p.y;
            const dx = Math.abs(target.x - p.x);
            return dy > 10 && dy <= 65 && dx <= 35;
          });
        }

        if (hitTarget) {
          hitTarget.state = 'FALLING';
          hitTarget.isGrounded = false;
          hitTarget.stunnedTimer = 0.8;
          hitTarget.vx = p.state === 'CLIMBING_V_PIPE' ? -160 : (p.facing === 'LEFT' ? -160 : 160);
          hitTarget.vy = 220;
          this.damagePlayer(hitTarget, 18, p);
          this.emitSound({ type: 'TACKLE', x: hitTarget.x, y: hitTarget.y });
          this.emitSound({ type: 'FALL_IMPACT', x: hitTarget.x, y: hitTarget.y });
        } else if (input.climbGrab) {
          this.attemptClimbGrab(p);
        }
      } else if (input.climbGrab) {
        this.attemptClimbGrab(p);
      }
    }

    return false;
  }

  public attemptClimbGrab(p: Player): boolean {
    if (p.climbGrabbingId || p.grabbedByPlayerId) return false;
    let grabTarget: Player | undefined;
    if (p.state === 'CLIMBING_V_PIPE' || p.state === 'CLIMBING_LADDER') {
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

    // Drop any carried ladder
    if (player.carryingLadderId) {
      this.dropLadder(player);
    }

    // Clean up rope interactions
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
      player.vx = 0;
      player.vy = 0;
    }
  }

  public ensureTenPlayers(): void {
    // Pure human multiplayer: No NPCs or bots
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LADDER MECHANICS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Attempt to pick up a nearby placed ladder.
   * Only one ladder can be carried at a time.
   * Server-authoritative: first player to interact wins.
   */
  public tryPickupLadder(p: Player): boolean {
    if (p.carryingLadderId) return false; // Already carrying one
    if (p.state === 'DEAD' || p.hasEscaped) return false;

    const PICKUP_RANGE = 55;
    for (const ladder of this.state.ladders) {
      if (ladder.state === 'CARRIED') continue; // Already carried
      const dist = Math.hypot(p.x - ladder.x, p.y - (ladder.y + ladder.height));
      if (dist < PICKUP_RANGE) {
        ladder.state = 'CARRIED';
        ladder.carriedByPlayerId = p.id;
        ladder.isPlaced = false;
        p.carryingLadderId = ladder.id;
        this.emitSound({ type: 'PICKUP', x: ladder.x, y: ladder.y });
        return true;
      }
    }
    return false;
  }

  /**
   * Drop the carried ladder at the player's current position.
   * Validates placement and sets isPlaced accordingly.
   */
  public dropLadder(p: Player): void {
    if (!p.carryingLadderId) return;
    const ladder = this.state.ladders.find(l => l.id === p.carryingLadderId);
    if (!ladder) {
      p.carryingLadderId = null;
      return;
    }

    // Place ladder at player position
    ladder.x = p.x;
    ladder.y = p.y - ladder.height; // Top of ladder at shoulder height
    ladder.state = 'PLACED';
    ladder.carriedByPlayerId = null;
    ladder.isPlaced = this.validateLadderPlacement(ladder);
    ladder.leanAngle = 0;

    p.carryingLadderId = null;
    this.emitSound({ type: 'DROP', x: ladder.x, y: ladder.y });
  }

  /**
   * Validate that a ladder is placed against a valid surface.
   * - Base must rest on a real floor or platform.
   * - Ladder must not penetrate solid geometry.
   * - Top must reach a usable destination (elevated ledge, platform, or escape pipe).
   */
  public validateLadderPlacement(ladder: Ladder): boolean {
    const baseY = ladder.y + ladder.height;
    const topY = ladder.y;
    const lx = ladder.x;

    // 1. Base must rest on a real floor or platform
    let baseValid = false;
    const floorSurfaces = [FLOOR_Y, LOWER_FLOOR_Y];
    for (const fy of floorSurfaces) {
      if (Math.abs(baseY - fy) <= 12) {
        if (fy === FLOOR_Y && ((lx >= 30 && lx <= 2100) || (lx >= 2280 && lx <= WORLD_WIDTH - 30))) {
          baseValid = true;
          break;
        } else if (fy === LOWER_FLOOR_Y && (lx >= BASEMENT_ENTRY_X && lx <= WORLD_WIDTH - 30)) {
          baseValid = true;
          break;
        }
      }
    }
    if (!baseValid) {
      for (const wall of MAZE_WALLS) {
        if (!wall.isPlatform && !wall.solid) continue;
        if (Math.abs(baseY - wall.y) <= 14 &&
            lx >= wall.x - 10 && lx <= wall.x + wall.width + 10) {
          baseValid = true;
          break;
        }
      }
    }
    if (!baseValid) return false;

    // 2. Ladder must not be placed inside solid geometry (skip world boundary slabs)
    for (const wall of MAZE_WALLS) {
      if (!wall.solid) continue;
      if (wall.width >= WORLD_WIDTH - 10 || wall.height >= WORLD_HEIGHT - 10) continue;
      if (wall.width <= 30 && wall.x <= 30) continue; // left boundary
      if (wall.width <= 30 && wall.x >= WORLD_WIDTH - 60) continue; // right boundary
      if (wall.y >= FLOOR_Y && wall.height >= 30) continue; // main floor slab
      if (wall.y >= LOWER_FLOOR_Y && wall.height >= 30) continue; // basement floor slab

      const overlapX = lx + 8 > wall.x && lx - 8 < wall.x + wall.width;
      const overlapY = topY < wall.y + wall.height && baseY > wall.y + 4;
      if (overlapX && overlapY) return false;
    }

    // 3. Top must connect to a usable destination
    let reachesDestination = false;

    // A) Elevated platform or catwalk above base
    for (const wall of MAZE_WALLS) {
      if (!wall.isPlatform && !wall.solid) continue;
      if (wall.y < baseY - 30) {
        const topNearWall = Math.abs(topY - wall.y) <= 35;
        const ladderSpansWall = topY <= wall.y + 10 && baseY >= wall.y + 30;
        if ((topNearWall || ladderSpansWall) &&
            lx >= wall.x - 30 && lx <= wall.x + wall.width + 30) {
          reachesDestination = true;
          break;
        }
      }
    }

    // B) Reaches main floor from basement return
    if (!reachesDestination && baseY > FLOOR_Y + 40 && Math.abs(topY - FLOOR_Y) <= 30) {
      if ((lx >= 30 && lx <= 2100) || (lx >= 2280 && lx <= WORLD_WIDTH - 30)) {
        reachesDestination = true;
      }
    }

    // C) Ceiling escape pipe or vertical pipe
    if (!reachesDestination) {
      if (topY <= H_PIPE_Y + 30 && lx >= 40 && lx <= V_PIPE_X + 40) {
        reachesDestination = true;
      } else if (Math.abs(lx - V_PIPE_X) <= 35 && topY < baseY - 30) {
        reachesDestination = true;
      }
    }

    return reachesDestination;
  }

  /**
   * Check if a player can start climbing a nearby placed ladder.
   */
  public tryClimbLadder(p: Player): string | null {
    if (p.state === 'DEAD' || p.hasEscaped || p.carryingLadderId) return null;
    const CLIMB_RANGE = 40;
    for (const ladder of this.state.ladders) {
      if (!ladder.isPlaced || ladder.state !== 'PLACED') continue;
      const dist = Math.abs(p.x - ladder.x);
      const inYRange = p.y >= ladder.y - 10 && p.y <= ladder.y + ladder.height + 10;
      if (dist < CLIMB_RANGE && inYRange) {
        return ladder.id;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INPUT HANDLING
  // ─────────────────────────────────────────────────────────────────────────

  public handleInput(playerId: string, input: ClientInput): void {
    const p = this.state.players.find(x => x.id === playerId);
    if (!p || p.state === 'DEAD' || p.hasEscaped) return;

    p.angle = input.aimAngle;
    if (p.stunnedTimer > 0) return;

    const alreadyHoldingRope = this.state.rope.heldByPlayerId === p.id;

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

      // Grab main vertical pipe (now at V_PIPE_X = 1480)
      if (Math.abs(p.x - V_PIPE_X) < 35 && (input.up || input.right)) {
        p.state = 'CLIMBING_V_PIPE';
        p.x = V_PIPE_X;
        p.vx = 0;
        p.vy = 0;
        p.isGrounded = false;
      }

      // Try climbing a ladder (W/Up near a placed ladder)
      if (input.up && !p.isGrounded === false) {
        const ladderId = this.tryClimbLadder(p);
        if (ladderId) {
          const ladder = this.state.ladders.find(l => l.id === ladderId)!;
          p.state = 'CLIMBING_LADDER';
          p.x = ladder.x; // Snap to ladder x
          p.vx = 0;
          p.vy = 0;
          p.isGrounded = false;
        }
      }

      // E: Interact — drop carried ladder, or pick up rope, or pick up ladder
      if (input.interact) {
        if (p.carryingLadderId) {
          this.dropLadder(p);
        } else if (this.state.rope.state === 'ON_FLOOR' && Math.hypot(p.x - this.state.rope.x, p.y - this.state.rope.y) < 50) {
          this.state.rope.state = 'HELD';
          this.state.rope.heldByPlayerId = p.id;
          this.state.rope.attachedPlayerId = null;
        } else {
          this.tryPickupLadder(p);
        }
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

    } else if (p.state === 'CLIMBING_V_PIPE') {
      p.x = V_PIPE_X;
      p.vx = 0;

      const combatOverrode = this.handleClimbingCombat(p, input);
      if (combatOverrode) return;

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

      // Touch floor
      if (p.y >= FLOOR_Y) {
        p.y = FLOOR_Y;
        p.state = 'ON_FLOOR';
        p.isGrounded = true;
      }

    } else if (p.state === 'HANGING_H_PIPE') {
      p.y = H_PIPE_Y + 15;
      p.vy = 0;

      const combatOverrode = this.handleClimbingCombat(p, input);
      if (combatOverrode) return;

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

      if (input.down) {
        p.state = 'FALLING';
        p.vy = 50;
      }

      // Reached escape opening at upper-left
      if (p.x < 40) {
        p.x = 40;
      }

    } else if (p.state === 'CLIMBING_LADDER') {
      // Find which ladder we're on
      const ladder = p.carryingLadderId
        ? null
        : this.state.ladders.find(l =>
            l.state === 'PLACED' && l.isPlaced &&
            Math.abs(p.x - l.x) < 40 &&
            p.y >= l.y - 10 && p.y <= l.y + l.height + 10
          );

      if (!ladder) {
        // Lost ladder — fall
        p.state = 'FALLING';
        return;
      }

      const combatOverrode = this.handleClimbingCombat(p, input);
      if (combatOverrode) return;

      const climbSpeed = 100;
      p.x = ladder.x; // Stay aligned with ladder

      if (input.up) {
        p.vy = -climbSpeed;
        p.facing = 'RIGHT';
      } else if (input.down) {
        p.vy = climbSpeed;
      } else {
        p.vy = 0;
      }

      // Dismount left or right
      if (input.left || input.right) {
        p.facing = input.left ? 'LEFT' : 'RIGHT';
        p.vx = input.left ? -80 : 80;
        p.state = 'FALLING';
        return;
      }

      // Reached top of ladder while climbing up — step off onto ledge
      if (p.vy < 0 && p.y <= ladder.y + 5) {
        p.y = ladder.y;
        p.vy = 0;
        p.state = 'ON_FLOOR';
        p.isGrounded = true;
      }

      // Reached bottom of ladder while climbing down — step onto floor
      if (p.vy > 0 && p.y >= ladder.y + ladder.height - 5) {
        p.y = ladder.y + ladder.height;
        p.vy = 0;
        p.state = 'ON_FLOOR';
        p.isGrounded = true;
      }

      // E: drop ladder if somehow carrying while climbing (edge case)
      if (input.interact) {
        p.state = 'FALLING';
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

      // Grab a ladder in mid-air (if falling past it)
      if (input.interact || input.up) {
        const ladderId = this.tryClimbLadder(p);
        if (ladderId) {
          const ladder = this.state.ladders.find(l => l.id === ladderId)!;
          p.state = 'CLIMBING_LADDER';
          p.x = ladder.x;
          p.vx = 0;
          p.vy = 0;
        }
      }

      // Interact: drop ladder while falling
      if (input.interact && p.carryingLadderId) {
        this.dropLadder(p);
      }
    }

    // ROPE ACTIONS
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
        if (input.pull || (input.tackle && p.state === 'ON_FLOOR')) {
          this.pullRopeTarget(p);
        } else if (input.interact) {
          this.dropRope();
        }
      }
    } else if (!p.carryingLadderId) {
      // Throw rock if not holding rope or ladder
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

    if (player.climbGrabbingId) {
      this.releaseClimbGrab(player, true);
    }
    if (player.grabbedByPlayerId) {
      this.breakGrabOnVictim(player);
    }

    if (player.health <= 0) {
      player.health = 0;
      player.state = 'DEAD';
      player.vy = 300;
      this.emitSound({ type: 'FALL_IMPACT', x: player.x, y: player.y });

      // Drop carried ladder on death
      if (player.carryingLadderId) {
        this.dropLadder(player);
      }

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

    this.updateObstacles();
    this.updateFallingRocks();
    this.updateRopePhysics();
    this.updateProjectiles();
    this.updatePlayersPhysics();
    this.updateCarriedLadders();
    this.resolveEscapeAttempts();

    this.flushSoundEvents();
  }

  /** Update positions of carried ladders to follow carriers */
  private updateCarriedLadders(): void {
    for (const ladder of this.state.ladders) {
      if (ladder.state !== 'CARRIED' || !ladder.carriedByPlayerId) continue;
      const carrier = this.state.players.find(p => p.id === ladder.carriedByPlayerId);
      if (!carrier || carrier.state === 'DEAD' || carrier.hasEscaped) {
        // Auto-drop on death/escape
        ladder.state = 'PLACED';
        ladder.carriedByPlayerId = null;
        ladder.isPlaced = this.validateLadderPlacement(ladder);
        if (carrier) carrier.carryingLadderId = null;
        continue;
      }
      ladder.x = carrier.x;
      ladder.y = carrier.y - ladder.height;
    }
  }

  public updateObstacles(): void {
    for (const obs of this.state.obstacles) {
      if (obs.type === 'MOVING_BARRIER') {
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
      // Rocks fall in the main area (not too far right in unexplored zones)
      const rockX = 300 + Math.random() * 1200;
      this.state.fallingRocks.push({
        id: `rock_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        x: rockX,
        y: 35,
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

        if (rock.y >= FLOOR_Y - 8) {
          rock.active = false;
          this.emitSound({ type: 'ROCK_FALL', x: rock.x, y: FLOOR_Y });
        }
      }
    }

    this.state.fallingRocks = this.state.fallingRocks.filter(r => r.active);
  }

  private flushSoundEvents(): void {
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
    const candidates = this.state.players.filter(p =>
      !p.hasEscaped &&
      p.state === 'HANGING_H_PIPE' &&
      p.x <= H_PIPE_EXIT_X &&
      p.health > 0
    );

    if (candidates.length === 0) return;

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
        player.hasEscaped = true;
        player.state = 'ESCAPED';
        const mins = Math.floor((600 - this.matchTimer) / 60);
        const secs = Math.floor((600 - this.matchTimer) % 60);
        player.escapeTime = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

        this.state.signalEscapedCount++;
        this.state.totalEscapedCount++;
        availableSlots--;

        this.emitSound({ type: 'ESCAPE', x: player.x, y: player.y });

        if (player.carryingLadderId) this.dropLadder(player);
        if (this.state.rope.heldByPlayerId === player.id || this.state.rope.attachedPlayerId === player.id) {
          this.dropRope();
        }
      } else {
        this.snipePlayer(player, 'QUOTA_VIOLATED');
      }
    }

    if (this.state.phase === 'SIGNAL_ACTIVE' && this.state.signalEscapedCount >= this.state.signalQuota) {
      this.closeHatch('QUOTA_FILLED');
    }
  }

  public attemptEscape(_player?: Player): void {
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
      rope.vy += 280 * DT;

      if (rope.startX !== undefined && rope.startY !== undefined) {
        const traveled = Math.hypot(rope.x - rope.startX, rope.y - rope.startY);
        if (traveled > (rope.maxDistance || 500)) {
          this.dropRope(rope.x, this.getNearestFloorBelow(rope.x, rope.y));
          return;
        }
      }

      // World bounds
      if (rope.y >= LOWER_FLOOR_Y || rope.x < 30 || rope.x > WORLD_WIDTH - 30 || rope.y < 30) {
        this.dropRope(
          Math.max(100, Math.min(WORLD_WIDTH - 100, rope.x)),
          this.getNearestFloorBelow(rope.x, rope.y)
        );
        return;
      }

      // Check collision with solid maze walls
      for (const wall of MAZE_WALLS) {
        if (!wall.solid) continue;
        if (segmentIntersectsRect(prevX, prevY, rope.x, rope.y, wall.x, wall.y, wall.width, wall.height)) {
          this.dropRope(rope.x, this.getNearestFloorBelow(rope.x, rope.y));
          return;
        }
      }

      // Check collision with moving barrier
      const barrier = this.state.obstacles.find(o => o.type === 'MOVING_BARRIER');
      if (barrier && segmentIntersectsRect(prevX, prevY, rope.x, rope.y, barrier.x, barrier.y, barrier.width, barrier.height)) {
        this.dropRope(rope.x, this.getNearestFloorBelow(rope.x, rope.y));
        return;
      }

      // Check player collision for attachment
      for (const p of this.state.players) {
        if (p.id === rope.heldByPlayerId || p.state === 'DEAD' || p.hasEscaped) continue;
        const dist = Math.hypot(p.x - rope.x, (p.y - 15) - rope.y);
        if (dist < 36) {
          // Line-of-sight check through barriers
          if (barrier && segmentIntersectsRect(
            rope.startX || rope.x, rope.startY || rope.y,
            p.x, p.y - 15,
            barrier.x, barrier.y, barrier.width, barrier.height
          )) {
            continue;
          }
          rope.state = 'ATTACHED';
          rope.attachedPlayerId = p.id;
          rope.x = p.x;
          rope.y = p.y - 15;
          rope.pullDamageCooldown = 0;
          this.emitSound({ type: 'ROPE_ATTACH', x: p.x, y: p.y });
          return;
        }
      }

      // Main floor / platform landing
      if (rope.y >= FLOOR_Y) {
        this.dropRope(Math.max(100, Math.min(WORLD_WIDTH - 100, rope.x)), FLOOR_Y);
        return;
      }
    } else if (rope.state === 'ATTACHED') {
      const holder = this.state.players.find(p => p.id === rope.heldByPlayerId);
      const target = this.state.players.find(p => p.id === rope.attachedPlayerId);

      if (!holder || !target || holder.state === 'DEAD' || target.state === 'DEAD' || target.hasEscaped) {
        this.dropRope();
      } else {
        rope.x = holder.x;
        rope.y = holder.y - 15;

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

  /** Find the nearest floor surface below a given world coordinate */
  private getNearestFloorBelow(worldX: number, worldY: number): number {
    if (worldX >= SHAFT_LEFT_X && worldX <= SHAFT_RIGHT_X) return LOWER_FLOOR_Y;
    let nearestY = FLOOR_Y;
    for (const wall of MAZE_WALLS) {
      if (!wall.isPlatform && !wall.solid) continue;
      if (worldX >= wall.x && worldX <= wall.x + wall.width) {
        if (wall.y > worldY && wall.y < nearestY) {
          nearestY = wall.y;
        }
      }
    }
    return nearestY;
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

    if (target.state === 'CLIMBING_V_PIPE' || target.state === 'HANGING_H_PIPE' || target.state === 'CLIMBING_LADDER') {
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
      const dragSpeed = 240;
      target.vx = Math.max(-280, Math.min(280, nx * dragSpeed));
      target.vy = Math.max(-180, Math.min(180, ny * 120 - 30));

      if (!rope.pullDamageCooldown || rope.pullDamageCooldown <= 0) {
        rope.pullDamageCooldown = 1.0;
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
    rope.x = x !== undefined ? Math.max(100, Math.min(WORLD_WIDTH - 100, x)) : Math.max(100, Math.min(WORLD_WIDTH - 100, rope.x));
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
          if (p.state === 'CLIMBING_V_PIPE' || p.state === 'HANGING_H_PIPE' || p.state === 'CLIMBING_LADDER') {
            p.state = 'FALLING';
            p.vy = 180;
          }
          p.stunnedTimer = 1.5;
          this.damagePlayer(p, 25, thrower);
          this.emitSound({ type: 'ROCK_HIT', x: p.x, y: p.y });
          break;
        }
      }

      // Check wall collision for projectiles
      for (const wall of MAZE_WALLS) {
        if (!wall.solid) continue;
        if (proj.x >= wall.x && proj.x <= wall.x + wall.width &&
            proj.y >= wall.y && proj.y <= wall.y + wall.height) {
          hit = true;
          break;
        }
      }

      if (hit || proj.lifetime <= 0 || proj.y >= LOWER_FLOOR_Y || proj.x < 30 || proj.x > WORLD_WIDTH - 30) {
        this.state.projectiles.splice(i, 1);
      }
    }
  }

  private updatePlayersPhysics(): void {
    const barrier = this.state.obstacles.find(o => o.type === 'MOVING_BARRIER');

    for (const p of this.state.players) {
      if (p.state === 'DEAD' || p.hasEscaped) continue;

      if (p.stamina < 100 && !p.climbGrabbingId) p.stamina = Math.min(100, p.stamina + 20 * DT);
      if (p.tackleCooldown > 0) p.tackleCooldown -= DT;
      if (p.attackCooldown > 0) p.attackCooldown -= DT;
      if (p.climbAttackCooldown > 0) p.climbAttackCooldown -= DT;
      if (p.climbKickTimer > 0) p.climbKickTimer -= DT;
      if (p.hazardCooldown > 0) p.hazardCooldown -= DT;

      // Climbing grab maintenance
      if (p.climbGrabbingId) {
        const victim = this.state.players.find(x => x.id === p.climbGrabbingId);
        if (!victim || victim.state === 'DEAD' || victim.hasEscaped || p.stunnedTimer > 0 ||
            (p.state !== 'CLIMBING_V_PIPE' && p.state !== 'HANGING_H_PIPE' && p.state !== 'CLIMBING_LADDER')) {
          this.releaseClimbGrab(p, true);
        } else {
          p.stamina = Math.max(0, p.stamina - 14 * DT);
          if (p.stamina <= 0) {
            this.releaseClimbGrab(p, true);
            p.climbAttackCooldown = 1.0;
          } else {
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

      // ── FALLING PHYSICS ─────────────────────────────────────────────────
      if (p.state === 'FALLING') {
        p.vy += GRAVITY * DT;
        p.x += p.vx * DT;
        p.y += p.vy * DT;

        // Check landing on maze platforms/walls
        const landingY = getPlayerLandingY(p.x, p.y, p.vy, MAZE_WALLS, this.state.obstacles, this.state.ladders);
        if (landingY !== null && p.vy > 0) {
          p.y = landingY;
          p.vy = 0;
          p.vx = 0;
          p.isGrounded = true;
          p.state = p.stunnedTimer > 0 ? 'STUNNED' : 'ON_FLOOR';
          this.emitSound({ type: 'FALL_IMPACT', x: p.x, y: p.y });
        }

        // Main floor collision
        const floorY = getNearestFloorY(p.x, p.y);
        if (p.y >= floorY && p.vy > 0) {
          p.y = floorY;
          p.vy = 0;
          p.vx = 0;
          p.isGrounded = true;
          p.state = p.stunnedTimer > 0 ? 'STUNNED' : 'ON_FLOOR';
          this.emitSound({ type: 'FALL_IMPACT', x: p.x, y: p.y });
        }

        // Lower basement floor — only accessible in basement x range
        if (p.y >= LOWER_FLOOR_Y && p.x >= BASEMENT_ENTRY_X) {
          p.y = LOWER_FLOOR_Y;
          p.vy = 0;
          p.vx = 0;
          p.isGrounded = true;
          p.state = p.stunnedTimer > 0 ? 'STUNNED' : 'ON_FLOOR';
          this.emitSound({ type: 'FALL_IMPACT', x: p.x, y: p.y });
        }

      } else if (p.state === 'ON_FLOOR') {
        p.x += p.vx * DT;

        // Check if player walked off a platform
        let onSurface = false;

        // Check main floor
        const floorY = getNearestFloorY(p.x, p.y);
        if (Math.abs(p.y - floorY) < 8) {
          onSurface = true;
          p.y = floorY;
        }

        // Check platforms
        for (const wall of MAZE_WALLS) {
          if (!wall.isPlatform && !wall.solid) continue;
          if (Math.abs(p.y - wall.y) < 8) {
            if (p.x >= wall.x - 8 && p.x <= wall.x + wall.width + 8) {
              onSurface = true;
              break;
            }
          }
        }
        // Check PLATFORM obstacles
        for (const obs of this.state.obstacles) {
          if (obs.type === 'PLATFORM' && Math.abs(p.y - obs.y) < 8) {
            if (p.x >= obs.x - 8 && p.x <= obs.x + obs.width + 8) {
              onSurface = true;
              break;
            }
          }
        }
        // Check lower basement floor
        if (Math.abs(p.y - LOWER_FLOOR_Y) < 8) {
          onSurface = true;
          p.y = LOWER_FLOOR_Y;
        }

        if (!onSurface) {
          p.isGrounded = false;
          p.state = 'FALLING';
        }

      } else if (p.state === 'CLIMBING_V_PIPE') {
        p.y += p.vy * DT;
        p.x = V_PIPE_X;
        if (p.y <= V_PIPE_TOP_Y + 15) {
          p.state = 'HANGING_H_PIPE';
          p.y = H_PIPE_Y + 15;
          p.vy = 0;
        } else if (p.y >= FLOOR_Y) {
          p.y = FLOOR_Y;
          p.state = 'ON_FLOOR';
          p.isGrounded = true;
          p.vy = 0;
        }
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

      } else if (p.state === 'CLIMBING_LADDER') {
        p.y += p.vy * DT;
        const ladder = this.state.ladders.find(l =>
          l.state === 'PLACED' && l.isPlaced &&
          Math.abs(p.x - l.x) < 40 &&
          p.y >= l.y - 15 && p.y <= l.y + l.height + 15
        );
        if (ladder) {
          p.x = ladder.x;
          // Check if climbing player reached an elevated platform along the ladder
          let reachedPlatformY: number | null = null;
          for (const wall of MAZE_WALLS) {
            if (!wall.isPlatform && !wall.solid) continue;
            if (wall.y < ladder.y + ladder.height - 20 && wall.y >= ladder.y - 10) {
              if (Math.abs(p.y - wall.y) <= 8 &&
                  ladder.x >= wall.x - 30 && ladder.x <= wall.x + wall.width + 30) {
                reachedPlatformY = wall.y;
                break;
              }
            }
          }
          if (reachedPlatformY !== null && p.vy < 0) {
            p.y = reachedPlatformY;
            p.vy = 0;
            p.state = 'ON_FLOOR';
            p.isGrounded = true;
          } else if (p.vy < 0 && p.y <= ladder.y + 5) {
            p.y = ladder.y;
            p.vy = 0;
            p.state = 'ON_FLOOR';
            p.isGrounded = true;
          } else if (p.vy > 0 && p.y >= ladder.y + ladder.height - 5) {
            p.y = ladder.y + ladder.height;
            p.vy = 0;
            p.state = 'ON_FLOOR';
            p.isGrounded = true;
          }
        }
        if (p.climbGrabbingId) {
          const victim = this.state.players.find(x => x.id === p.climbGrabbingId);
          if (victim) {
            victim.x = p.x;
            victim.y = p.y + 42;
          }
        }
      }

      // ── MOVING BARRIER COLLISION ─────────────────────────────────────────
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

      // ── SOLID WALL HORIZONTAL COLLISION ──────────────────────────────────
      if (p.state === 'ON_FLOOR' || p.state === 'FALLING' || p.state === 'STUNNED') {
        p.x = resolveHorizontalWallCollision(p.x, p.y, 14, MAZE_WALLS);
      }

      // ── WORLD BOUNDS ─────────────────────────────────────────────────────
      p.x = Math.max(35, Math.min(WORLD_WIDTH - 35, p.x));
      p.y = Math.max(35, Math.min(LOWER_FLOOR_Y + 10, p.y));

      // ── MELEE TACKLE COLLISION ───────────────────────────────────────────
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
    player.vy = 400;

    if (player.carryingLadderId) {
      this.dropLadder(player);
    }
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
