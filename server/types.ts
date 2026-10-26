export type GamePhase = 'LOBBY' | 'WAITING_SIGNAL' | 'SIGNAL_ACTIVE' | 'PURGE' | 'MATCH_OVER';

export type PlayerState = 'ON_FLOOR' | 'CLIMBING_V_PIPE' | 'HANGING_H_PIPE' | 'CLIMBING_LADDER' | 'FALLING' | 'STUNNED' | 'ESCAPED' | 'DEAD';

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 'LEFT' | 'RIGHT';
  angle: number; // Aim angle for rope/rock throw
  color: string;
  health: number;
  stamina: number;
  state: PlayerState;
  isGrounded: boolean;
  stunnedTimer: number;
  tackleCooldown: number;
  attackCooldown: number;
  rocks: number;
  hasEscaped: boolean;
  escapeTime?: string;
  sabotages: number;
  climbKickTimer: number;
  climbAttackCooldown: number;
  climbGrabbingId: string | null;
  grabbedByPlayerId: string | null;
  struggleMeter: number;
  hazardCooldown: number;
  // Equipment
  carryingLadderId: string | null;
}

export interface Rope {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: 'ON_FLOOR' | 'HELD' | 'THROWN' | 'ATTACHED';
  heldByPlayerId: string | null;
  attachedPlayerId: string | null;
  length: number;
  pulling?: boolean;
  startX?: number;
  startY?: number;
  maxDistance?: number;
  pullDamageCooldown?: number;
}

/** A physical ladder that can be picked up, carried, placed, and climbed */
export interface Ladder {
  id: string;
  x: number;          // World x at the base center
  y: number;          // World y of the top (so base = y + height)
  width: number;      // Typically 20
  height: number;     // Typically 90
  state: 'PLACED' | 'CARRIED';
  carriedByPlayerId: string | null;
  /** True when validated against a wall/floor surface and climbable */
  isPlaced: boolean;
  /** Tile of surface it leans against (for visual tilt). 0 = vertical */
  leanAngle: number;
}

export type ObstacleType = 'PLATFORM' | 'MOVING_BARRIER';
export type ObstacleState = 'IDLE' | 'WARNING' | 'ACTIVE';

export interface Obstacle {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  width: number;
  height: number;
  state: ObstacleState;
  timer: number;
  minY?: number;
  maxY?: number;
  vy?: number;
}

export interface FallingRock {
  id: string;
  x: number;
  y: number;
  vy: number;
  warningTimer: number; // >0 means warning cracks at ceiling; <= 0 means actively falling
  active: boolean;
  radius?: number;
  state?: 'WARNING' | 'FALLING';
}

export interface Projectile {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: 'rock' | 'rope_hook';
  lifetime: number;
}

export interface SniperShot {
  id: string;
  targetId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  reason: 'QUOTA_VIOLATED' | 'CRASH_PURGE';
  timestamp: number;
}

export interface SoundEvent {
  type: 'ANNOUNCEMENT' | 'CLANG' | 'GUNSHOT' | 'TACKLE' | 'ROCK_HIT' | 'ROPE_ATTACH' | 'ROPE_PULL' | 'FALL_IMPACT' | 'ESCAPE' | 'CRASH' | 'STEAM_HISS' | 'STEAM_BURST' | 'ROCK_FALL' | 'SPIKE_HIT' | 'CLIMB_KICK' | 'CLIMB_GRAB' | 'CLIMB_STRUGGLE' | 'PICKUP' | 'DROP';
  x?: number;
  y?: number;
}

export const MAX_PLAYERS = 10;

/** World dimensions – the scrollable 2D prison map */
export const WORLD_WIDTH = 2800;
export const WORLD_HEIGHT = 1200;

/** Main chamber/viewport reference (still used for legacy compatibility) */
export const CHAMBER_WIDTH = WORLD_WIDTH;
export const CHAMBER_HEIGHT = WORLD_HEIGHT;

/** Primary floor level (spawn area) */
export const FLOOR_Y = 620;

/** Lower sub-floor level (basement passages) */
export const LOWER_FLOOR_Y = 980;

/** Right wall vertical pipe (main escape route pipe) */
export const V_PIPE_X = 1480;
export const V_PIPE_TOP_Y = 90;

/** Ceiling horizontal pipe */
export const H_PIPE_Y = 90;
export const H_PIPE_EXIT_X = 130;

/** Dormitory ledge (requires ladder to access from main floor) */
export const DORM_LEDGE_Y = 360;
export const DORM_LEFT_X = 580;
export const DORM_RIGHT_X = 1080;

/** Maintenance room x range (ladders spawn here) */
export const MAINT_ROOM_LEFT_X = 80;
export const MAINT_ROOM_RIGHT_X = 420;

/** Spawn area x range */
export const SPAWN_LEFT_X = 300;
export const SPAWN_RIGHT_X = 1200;

// ── ROUTE ANCHOR CONSTANTS ────────────────────────────────────────────────
/** Ledge above maintenance room — ladder from floor reaches here (Route A) */
export const MAINT_UPPER_LEDGE_Y = 460;
export const MAINT_UPPER_LEDGE_X = 80;
export const MAINT_UPPER_LEDGE_W = 500;

/** Rope anchor bolt on right wall of maintenance room (Route B) */
export const ROPE_ANCHOR_X = 360;
export const ROPE_ANCHOR_Y = 200;

/** Basement corridor left entry x (Route C) */
export const BASEMENT_ENTRY_X = 1600;

/** Shaft gap between main floor and basement (x range) */
export const SHAFT_LEFT_X = 2100;
export const SHAFT_RIGHT_X = 2280;

export interface WallRect {
  x: number;
  y: number;
  width: number;
  height: number;
  solid?: boolean; // true = full collision (default), false = top-only (platforms)
  isPlatform?: boolean;
}

export type WallSegment = WallRect;

/**
 * PRISON MAZE GEOMETRY  (World: 2800 × 1200)
 *
 * Three traversal routes:
 *   Route A — Ladder route: maintenance room → carry ladder → place at MAINT_UPPER_LEDGE → climb → dormitory
 *   Route B — Rope route:   dormitory → throw rope at ROPE_ANCHOR bolt → swing across shaft → pipe → hatch
 *   Route C — Basement:     shaft gap at X=2100-2280 → basement corridor → left passage → back up to main floor
 *
 * Key Y levels:
 *   30   = ceiling
 *   200  = dormitory ceiling / upper pipe area
 *   360  = dormitory floor (DORM_LEDGE_Y)
 *   460  = maintenance upper ledge (MAINT_UPPER_LEDGE_Y)
 *   620  = main floor (FLOOR_Y)
 *   980  = basement floor (LOWER_FLOOR_Y)
 */
export const MAZE_WALLS: WallRect[] = [

  // ══ WORLD BOUNDARY ═══════════════════════════════════════════════════════
  { x: 0,              y: 0,   width: WORLD_WIDTH, height: 30,  solid: true }, // ceiling
  { x: 0,              y: 0,   width: 30,          height: WORLD_HEIGHT, solid: true }, // left wall
  { x: WORLD_WIDTH-30, y: 0,   width: 30,          height: WORLD_HEIGHT, solid: true }, // right wall
  { x: 0,              y: WORLD_HEIGHT-30, width: WORLD_WIDTH, height: 30, solid: true }, // bottom

  // ══ MAIN DETENTION FLOOR (Y=620) ═════════════════════════════════════════
  // Left section: X=30 to 2100 (continuous spawn + combat area)
  { x: 30,   y: FLOOR_Y, width: 2070, height: 40, solid: true },
  // Right section: X=2280 to 2770 (right of shaft gap)
  { x: 2280, y: FLOOR_Y, width: 490,  height: 40, solid: true },

  // ══ MAINTENANCE ROOM (left side, X=30–420, Y=460–620) ════════════════════
  // Dividing wall upper lintel (doorway below Y=380 allows walking on catwalk Y=460 and floor Y=620)
  { x: 420, y: 200, width: 22, height: 180, solid: true },
  // Upper catwalk from maintenance room reaching dormitory entrance (Route A)
  { x: MAINT_UPPER_LEDGE_X, y: MAINT_UPPER_LEDGE_Y, width: MAINT_UPPER_LEDGE_W, height: 16, isPlatform: true },
  // Stepping shelves inside maintenance room (allow jumping up while carrying equipment)
  { x: 250, y: 560, width: 110, height: 12, isPlatform: true },
  { x: 80,  y: 510, width: 150, height: 12, isPlatform: true },

  // ══ DORMITORY (X=580–1080, Y=200–360) ════════════════════════════════════
  // Dormitory floor ledge
  { x: DORM_LEFT_X,  y: DORM_LEDGE_Y, width: DORM_RIGHT_X - DORM_LEFT_X, height: 18, isPlatform: true },
  // Dormitory left wall upper lintel (doorway from Y=290 to DORM_LEDGE_Y=360)
  { x: DORM_LEFT_X,  y: 200, width: 22, height: 90, solid: true },
  // Dormitory right wall upper lintel (doorway from Y=290 to DORM_LEDGE_Y=360)
  { x: DORM_RIGHT_X, y: 200, width: 22, height: 90, solid: true },
  // Dormitory ceiling
  { x: DORM_LEFT_X,  y: 200, width: DORM_RIGHT_X - DORM_LEFT_X, height: 18, isPlatform: true },
  // Bunk bed mid-shelf inside dormitory
  { x: 640,  y: 290, width: 120, height: 12, isPlatform: true },
  { x: 860,  y: 290, width: 120, height: 12, isPlatform: true },

  // ══ UPPER-LEFT PIPE LANDING (near escape hatch, X=200–360, Y=200) ════════
  { x: 200, y: 200, width: 160, height: 14, isPlatform: true },

  // ══ SERVICE CORRIDOR (X=1150–1600, Y=500) ════════════════════════════════
  { x: 1150, y: 500, width: 450, height: 16, isPlatform: true },
  // Security gate pillar
  { x: 1230, y: 516, width: 18,  height: 104, solid: true },

  // ══ SHAFT GAP WALLS (X=2100–2280) ════════════════════════════════════════
  // Left shaft wall — players fall through gap into basement
  { x: 2100, y: FLOOR_Y + 40, width: 22, height: LOWER_FLOOR_Y - FLOOR_Y - 40, solid: true },
  // Right shaft wall
  { x: 2258, y: FLOOR_Y + 40, width: 22, height: LOWER_FLOOR_Y - FLOOR_Y - 40, solid: true },

  // ══ BASEMENT FLOOR (Y=980, X=1600–2770) ══════════════════════════════════
  { x: 1600, y: LOWER_FLOOR_Y, width: 1170, height: 40, solid: true },

  // ══ BASEMENT PASSAGES & PLATFORMS ════════════════════════════════════════
  // Basement left wall (connects to shaft)
  { x: 1600, y: FLOOR_Y + 40, width: 22, height: LOWER_FLOOR_Y - FLOOR_Y - 40, solid: true },
  // Basement stepping platforms leading out of the pit runoff (Route C return staircase, clear of shaft gap at X=2100-2280)
  { x: 1900, y: 910, width: 180, height: 14, isPlatform: true },
  { x: 1780, y: 840, width: 150, height: 14, isPlatform: true },
  { x: 1680, y: 770, width: 140, height: 14, isPlatform: true },
  { x: 1620, y: 700, width: 120, height: 14, isPlatform: true },
  { x: 1620, y: 650, width: 100, height: 14, isPlatform: true },
];


export interface HatchZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GameState {
  phase: GamePhase;
  matchTimer: number;
  lobbyCountdown: number;
  maxPlayers: number;
  signalQuota: number;
  signalEscapedCount: number;
  totalEscapedCount: number;
  signalWindowRemaining: number;
  nextSignalIn: number;
  announcementText: string;
  hatch: HatchZone;
  rope: Rope;
  players: Player[];
  obstacles: Obstacle[];
  fallingRocks: FallingRock[];
  projectiles: Projectile[];
  recentShots: SniperShot[];
  soundEvents: SoundEvent[];
  /** Physical ladders in the world */
  ladders: Ladder[];
}

export interface ClientInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  interact: boolean; // 'E' to pick up/drop/release rope or ladder
  attack: boolean;   // Throw rock or rope
  tackle: boolean;   // Spacebar: tackle or yank rope or climbing kick/grab
  pull?: boolean;    // Pull attached victim
  climbKick?: boolean;  // Climbing downward kick
  climbGrab?: boolean;  // Climbing hold grab
  struggle?: boolean;   // Struggle to break free when grabbed
  aimAngle: number;
}

export interface JoinMessage {
  type: 'JOIN';
  name: string;
  resumeToken?: string;
  roomCode?: string;
  createRoom?: boolean;
  mode?: 'survival' | 'campaign';
}

export interface WelcomeMessage {
  type: 'WELCOME';
  playerId: string;
  name: string;
  resumeToken: string;
  phase: GamePhase;
  roomCode: string;
  mode?: 'survival' | 'campaign';
  roomId?: number;
}

export interface ErrorMessage {
  type: 'ERROR';
  code: 'ROOM_FULL' | 'INVALID_NAME' | 'MALFORMED' | 'RATE_LIMITED' | 'ROOM_NOT_FOUND';
  message: string;
}

export interface SyncMessage {
  type: 'SYNC';
  mode?: 'survival' | 'campaign';
  state?: GameState;
  campaign?: any;
}

export interface InputMessage {
  type: 'INPUT';
  input: ClientInput;
}

export interface ReadyMessage {
  type: 'READY';
}

export type ClientMessage = JoinMessage | InputMessage | ReadyMessage;
export type ServerMessage = WelcomeMessage | ErrorMessage | SyncMessage;
