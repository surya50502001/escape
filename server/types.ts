export type GamePhase = 'LOBBY' | 'WAITING_SIGNAL' | 'SIGNAL_ACTIVE' | 'PURGE' | 'MATCH_OVER';

export type PlayerState = 'IDLE' | 'RUNNING' | 'TACKLING' | 'STUNNED' | 'CLIMBING' | 'ESCAPED' | 'DEAD';

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  color: string;
  health: number;
  stamina: number;
  state: PlayerState;
  stunnedTimer: number;
  tackleCooldown: number;
  attackCooldown: number;
  climbProgress: number; // 0 to 100%
  rocks: number; // Thrown projectiles remaining
  hasEscaped: boolean;
  escapeTime?: string;
  sabotages: number;
}

export interface Projectile {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: 'rock';
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
  type: 'ANNOUNCEMENT' | 'CLANG' | 'GUNSHOT' | 'TACKLE' | 'ROCK_HIT' | 'ESCAPE' | 'CRASH' | 'TICK';
  x?: number;
  y?: number;
}

export interface LadderZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GameState {
  phase: GamePhase;
  matchTimer: number; // Seconds remaining in 10-minute match (600s)
  signalQuota: number; // Number allowed in current active signal (e.g. 1 or 2)
  signalEscapedCount: number;
  totalEscapedCount: number;
  signalWindowRemaining: number; // Seconds remaining on current ladder opening
  nextSignalIn: number; // Approximate seconds until Anonymous might speak again
  announcementText: string;
  ladder: LadderZone;
  players: Player[];
  projectiles: Projectile[];
  recentShots: SniperShot[];
  soundEvents: SoundEvent[];
}

export interface ClientInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  aimAngle: number;
  attack: boolean; // Throw rock or punch
  tackle: boolean; // Lunge tackle
  interact: boolean; // Climb ladder
}
