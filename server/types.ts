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
export const WORLD_WIDTH = 3000;
export const WORLD_HEIGHT = 1400;

/** Main chamber/viewport reference (still used for legacy compatibility) */
export const CHAMBER_WIDTH = WORLD_WIDTH;
export const CHAMBER_HEIGHT = WORLD_HEIGHT;

/** Primary floor level (spawn area) */
export const FLOOR_Y = 620;

/** Lower sub-floor level (basement passages) */
export const LOWER_FLOOR_Y = 1020;

/** Right wall vertical pipe (main escape route pipe) */
export const V_PIPE_X = 1480;
export const V_PIPE_TOP_Y = 90;

/** Ceiling horizontal pipe */
export const H_PIPE_Y = 90;
export const H_PIPE_EXIT_X = 130;

/** Dormitory ledge (requires ladder to access from main floor) */
export const DORM_LEDGE_Y = 360;
export const DORM_LEFT_X = 600;
export const DORM_RIGHT_X = 1100;

/** Maintenance room x range (ladders spawn here) */
export const MAINT_ROOM_LEFT_X = 80;
export const MAINT_ROOM_RIGHT_X = 400;

/** Spawn area x range */
export const SPAWN_LEFT_X = 300;
export const SPAWN_RIGHT_X = 1300;

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
 * PRISON MAZE GEOMETRY
 * World is 3000 x 1400.
 * Main floor at Y=620. Lower basement at Y=1020.
 * Escape hatch at X=40-130, Y=40-130.
 * Vertical pipe at X=1480, from Y=90 to Y=620.
 */
export const MAZE_WALLS: WallRect[] = [
  // ── CEILING ──────────────────────────────────────────────────────────────
  { x: 0,    y: 0,   width: WORLD_WIDTH, height: 30 },

  // ── OUTER LEFT WALL ───────────────────────────────────────────────────────
  { x: 0,    y: 0,   width: 30, height: FLOOR_Y + 40 },

  // ── OUTER RIGHT WALL (far end) ─────────────────────────────────────────────
  { x: WORLD_WIDTH - 30, y: 0, width: 30, height: LOWER_FLOOR_Y + 80 },

  // ── MAIN FLOOR (Y=620, X=0 to 2200) ────────────────────────────────────────
  { x: 0, y: FLOOR_Y, width: 2200, height: 40, solid: true },

  // ── MAIN FLOOR RIGHT SECTION (X=2400 to end) ───────────────────────────────
  { x: 2400, y: FLOOR_Y, width: 600, height: 40, solid: true },

  // ── LOWER BASEMENT FLOOR ────────────────────────────────────────────────────
  { x: 1600, y: LOWER_FLOOR_Y, width: WORLD_WIDTH - 1600, height: 40, solid: true },

  // ── LEFT BASEMENT WALL (below main floor, X=0-30) ───────────────────────── 
  { x: 0, y: FLOOR_Y + 40, width: 30, height: LOWER_FLOOR_Y - FLOOR_Y },

  // ── LEFT MAINTENANCE ROOM (X=0–380, Y=400–620) ─────────────────────────────
  { x: 30,  y: 400, width: 350, height: 20, isPlatform: true },
  { x: 380, y: 430, width: 20, height: 190, solid: true },
  { x: 80,  y: 460, width: 180, height: 14, isPlatform: true },

  // ── UPPER DORMITORY LEDGE (X=600–1100, Y=360) ──────────────────────────────
  { x: DORM_LEFT_X,  y: DORM_LEDGE_Y, width: DORM_RIGHT_X - DORM_LEFT_X, height: 18, isPlatform: true },
  { x: DORM_LEFT_X,  y: 200, width: 20, height: DORM_LEDGE_Y - 200, solid: true },
  { x: DORM_RIGHT_X, y: 200, width: 20, height: DORM_LEDGE_Y - 200, solid: true },
  { x: DORM_LEFT_X,  y: 200, width: DORM_RIGHT_X - DORM_LEFT_X, height: 18, isPlatform: true },

  // ── SERVICE CORRIDOR (X=1500–1800, Y=500–620) ─────────────────────────────
  { x: 1500, y: 500, width: 300, height: 16, isPlatform: true },
  { x: 1640, y: 516, width: 16, height: 104, solid: true },

  // ── UPPER-LEFT PIPE AREA (near escape hatch) ───────────────────────────────
  { x: 220, y: 200, width: 120, height: 14, isPlatform: true },

  // ── LOWER BASEMENT PASSAGE WALL / PLATFORMS ───────────────────────────────
  { x: 1600, y: FLOOR_Y + 40, width: 30, height: LOWER_FLOOR_Y - FLOOR_Y },
  { x: 1750, y: 850, width: 200, height: 14, isPlatform: true },
  { x: 2200, y: 900, width: 180, height: 14, isPlatform: true },
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
}

export interface WelcomeMessage {
  type: 'WELCOME';
  playerId: string;
  name: string;
  resumeToken: string;
  phase: GamePhase;
}

export interface ErrorMessage {
  type: 'ERROR';
  code: 'ROOM_FULL' | 'INVALID_NAME' | 'MALFORMED' | 'RATE_LIMITED';
  message: string;
}

export interface SyncMessage {
  type: 'SYNC';
  state: GameState;
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
