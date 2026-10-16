export type GamePhase = 'LOBBY' | 'WAITING_SIGNAL' | 'SIGNAL_ACTIVE' | 'PURGE' | 'MATCH_OVER';

export type PlayerState = 'ON_FLOOR' | 'CLIMBING_V_PIPE' | 'HANGING_H_PIPE' | 'FALLING' | 'STUNNED' | 'ESCAPED' | 'DEAD';

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
  type: 'ANNOUNCEMENT' | 'CLANG' | 'GUNSHOT' | 'TACKLE' | 'ROCK_HIT' | 'ROPE_ATTACH' | 'ROPE_PULL' | 'FALL_IMPACT' | 'ESCAPE' | 'CRASH';
  x?: number;
  y?: number;
}

export const CHAMBER_WIDTH = 1000;
export const CHAMBER_HEIGHT = 700;
export const FLOOR_Y = 620;
export const V_PIPE_X = 920;
export const V_PIPE_TOP_Y = 90;
export const H_PIPE_Y = 90;
export const H_PIPE_EXIT_X = 130;

export interface HatchZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GameState {
  phase: GamePhase;
  matchTimer: number;
  signalQuota: number;
  signalEscapedCount: number;
  totalEscapedCount: number;
  signalWindowRemaining: number;
  nextSignalIn: number;
  announcementText: string;
  hatch: HatchZone;
  rope: Rope;
  players: Player[];
  projectiles: Projectile[];
  recentShots: SniperShot[];
  soundEvents: SoundEvent[];
}

export interface ClientInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  interact: boolean; // 'E' to pick up/drop rope
  attack: boolean;   // Throw rock or rope
  tackle: boolean;   // Spacebar: tackle or yank rope
  aimAngle: number;
}
