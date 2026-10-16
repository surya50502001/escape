import { GameState, GamePhase, Player, Projectile, SniperShot, SoundEvent, ClientInput } from './types.js';

export const ARENA_WIDTH = 1000;
export const ARENA_HEIGHT = 700;
export const LADDER_ZONE = { x: 450, y: 30, width: 100, height: 110 };
const TICK_RATE = 30; // 30 Hz
const DT = 1 / TICK_RATE;

const BOT_NAMES = [
  'Rusty Pete', 'Shiv Miller', 'Big Knuckles', 'Rat-Bite Sal', 
  'Iron Jaw', 'Shadow Fox', 'One-Eye Jack', 'Snake Eyes', 'Mad Dog Boris'
];

const BOT_COLORS = [
  '#e67e22', '#e74c3c', '#9b59b6', '#3498db', 
  '#1abc9c', '#f1c40f', '#d35400', '#2ecc71', '#e84393'
];

export class GameEngine {
  public state: GameState;
  private soundEventsQueue: SoundEvent[] = [];
  private matchTimer: number = 600; // 10 minutes = 600s
  private nextSignalTimer: number = 15; // Countdown to next signal
  private signalWindowTimer: number = 0; // Countdown for open hatch window
  private finalSilenceActive: boolean = false; // If true, Anonymous will never speak again

  constructor() {
    this.state = {
      phase: 'LOBBY',
      matchTimer: 600,
      signalQuota: 0,
      signalEscapedCount: 0,
      totalEscapedCount: 0,
      signalWindowRemaining: 0,
      nextSignalIn: 15,
      announcementText: '10 PRISONERS ENTERING THE PIT...',
      ladder: { ...LADDER_ZONE },
      players: [],
      projectiles: [],
      recentShots: [],
      soundEvents: []
    };
  }

  public startNewMatch(): void {
    this.matchTimer = 600; // 10 minutes
    this.finalSilenceActive = false;
    this.state.phase = 'WAITING_SIGNAL';
    this.state.totalEscapedCount = 0;
    this.state.signalQuota = 0;
    this.state.signalEscapedCount = 0;
    this.state.projectiles = [];
    this.state.recentShots = [];
    this.soundEventsQueue = [];

    // Schedule first signal between 12 and 20 seconds
    this.nextSignalTimer = 14 + Math.random() * 8;
    this.state.announcementText = 'ANONYMOUS GUARDS THE HATCH. SURVIVE 10 MINUTES IN THE CELL.';

    this.soundEventsQueue.push({ type: 'CLANG' });

    // Spawn 10 players into the cell
    this.state.players.forEach((p, idx) => {
      p.x = 200 + Math.random() * 600;
      p.y = 420 + Math.random() * 220;
      p.vx = 0;
      p.vy = 0;
      p.health = 100;
      p.stamina = 100;
      p.state = 'IDLE';
      p.stunnedTimer = 0;
      p.tackleCooldown = 0;
      p.attackCooldown = 0;
      p.climbProgress = 0;
      p.hasEscaped = false;
      p.escapeTime = undefined;
      p.rocks = 2;
    });
  }

  public addHumanPlayer(id: string, name: string): Player {
    let p = this.state.players.find(x => x.id === id);
    if (p) return p;

    p = {
      id,
      name: name || 'You',
      isBot: false,
      x: 500,
      y: 550,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      color: '#00ffcc',
      health: 100,
      stamina: 100,
      state: 'IDLE',
      stunnedTimer: 0,
      tackleCooldown: 0,
      attackCooldown: 0,
      climbProgress: 0,
      rocks: 2,
      hasEscaped: false,
      sabotages: 0
    };
    this.state.players.push(p);
    this.ensureTenPlayers();
    return p;
  }

  public removePlayer(id: string): void {
    this.state.players = this.state.players.filter(p => p.id !== id);
  }

  public ensureTenPlayers(): void {
    let botIdx = 0;
    while (this.state.players.length < 10) {
      const name = BOT_NAMES[botIdx % BOT_NAMES.length];
      const color = BOT_COLORS[botIdx % BOT_COLORS.length];
      this.state.players.push({
        id: `bot_${Date.now()}_${botIdx}`,
        name,
        isBot: true,
        x: 200 + Math.random() * 600,
        y: 420 + Math.random() * 220,
        vx: 0,
        vy: 0,
        angle: -Math.PI / 2,
        color,
        health: 100,
        stamina: 100,
        state: 'IDLE',
        stunnedTimer: 0,
        tackleCooldown: 0,
        attackCooldown: 0,
        climbProgress: 0,
        rocks: 2,
        hasEscaped: false,
        sabotages: 0
      });
      botIdx++;
    }
  }

  public handleInput(playerId: string, input: ClientInput): void {
    const p = this.state.players.find(x => x.id === playerId);
    if (!p || p.state === 'DEAD' || p.state === 'ESCAPED') return;

    p.angle = input.aimAngle;
    if (p.stunnedTimer > 0) return;

    const speed = p.state === 'CLIMBING' ? 45 : 170;
    let dx = 0;
    let dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;

    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    if (p.state !== 'TACKLING') {
      p.vx = dx * speed;
      p.vy = dy * speed;
      if (p.state !== 'CLIMBING') {
        p.state = (dx !== 0 || dy !== 0) ? 'RUNNING' : 'IDLE';
      }
    }

    // Throw rock
    if (input.attack && p.attackCooldown <= 0 && p.rocks > 0) {
      p.rocks--;
      p.attackCooldown = 0.8;
      const rockSpeed = 380;
      this.state.projectiles.push({
        id: `proj_${Date.now()}_${Math.random()}`,
        ownerId: p.id,
        x: p.x + Math.cos(p.angle) * 22,
        y: p.y + Math.sin(p.angle) * 22,
        vx: Math.cos(p.angle) * rockSpeed,
        vy: Math.sin(p.angle) * rockSpeed,
        type: 'rock',
        lifetime: 1.5
      });
    }

    // Tackle dash
    if (input.tackle && p.tackleCooldown <= 0 && p.stamina >= 30 && p.state !== 'CLIMBING') {
      p.stamina -= 30;
      p.tackleCooldown = 2.0;
      p.state = 'TACKLING';
      p.stunnedTimer = 0.35;
      const tackleSpeed = 420;
      p.vx = Math.cos(p.angle) * tackleSpeed;
      p.vy = Math.sin(p.angle) * tackleSpeed;
      this.soundEventsQueue.push({ type: 'TACKLE', x: p.x, y: p.y });
    }
  }

  public update(): void {
    this.soundEventsQueue = [];

    const now = Date.now();
    this.state.recentShots = this.state.recentShots.filter(s => now - s.timestamp < 1000);

    if (this.state.phase === 'LOBBY') {
      this.ensureTenPlayers();
      this.startNewMatch();
      return;
    }

    // Count down the global 10-minute match timer
    if (this.state.phase !== 'MATCH_OVER' && this.state.phase !== 'PURGE') {
      this.matchTimer -= DT;
      this.state.matchTimer = Math.max(0, Math.ceil(this.matchTimer));

      if (this.matchTimer <= 0) {
        this.triggerFinalPurge();
        return;
      }
    }

    // Phase handling
    if (this.state.phase === 'WAITING_SIGNAL') {
      this.updateWaitingPhase();
    } else if (this.state.phase === 'SIGNAL_ACTIVE') {
      this.updateSignalActivePhase();
    } else if (this.state.phase === 'PURGE') {
      // 5 seconds of final purge animation before match over
      this.signalWindowTimer -= DT;
      if (this.signalWindowTimer <= 0) {
        this.state.phase = 'MATCH_OVER';
      }
    }

    // Update projectiles & general movement
    this.updateProjectiles();
    this.updateLivingPlayers();

    this.state.soundEvents = [...this.soundEventsQueue];
  }

  private updateWaitingPhase(): void {
    // Count down to next signal
    this.nextSignalTimer -= DT;
    this.state.nextSignalIn = Math.max(0, Math.ceil(this.nextSignalTimer));

    // Check if remaining living prisoners in cell
    const prisonersInPit = this.state.players.filter(p => !p.hasEscaped && p.state !== 'DEAD');
    if (prisonersInPit.length === 0) {
      // Everyone either escaped or died
      this.state.phase = 'MATCH_OVER';
      this.state.announcementText = 'ALL PRISONERS HAVE EITHER ESCAPED OR PERISHED.';
      return;
    }

    if (this.nextSignalTimer <= 0) {
      // Chance of final silence or trigger new signal
      const roll = Math.random();
      // If 8+ minutes passed and only 1-2 prisoners left, Anonymous might stop speaking
      if (this.matchTimer < 120 && roll < 0.25) {
        this.finalSilenceActive = true;
        this.state.announcementText = 'ANONYMOUS IS GONE. THE HATCH REMAINS COLD AND DEAD...';
        this.nextSignalTimer = 999;
        return;
      }

      // Trigger a signal!
      // Anonymous chooses quota: usually 1, sometimes 2 (if multiple people left)
      this.state.signalQuota = (prisonersInPit.length > 2 && Math.random() < 0.35) ? 2 : 1;
      this.state.signalEscapedCount = 0;
      this.signalWindowTimer = 16.0; // 16-second window to reach ladder
      this.state.signalWindowRemaining = 16;
      this.state.phase = 'SIGNAL_ACTIVE';

      this.state.announcementText = this.state.signalQuota === 1
        ? 'ANONYMOUS: "I WILL TAKE 1 PRISONER. IF TWO TOUCH THE LADDER, I SHOOT."'
        : 'ANONYMOUS: "I GRANT PASSAGE FOR 2. FIGHT FOR IT."';

      this.soundEventsQueue.push({ type: 'ANNOUNCEMENT' });
      this.soundEventsQueue.push({ type: 'CLANG' });
    }
  }

  private updateSignalActivePhase(): void {
    this.signalWindowTimer -= DT;
    this.state.signalWindowRemaining = Math.max(0, Math.ceil(this.signalWindowTimer));

    const activeClimbers: Player[] = [];
    const allowedRemaining = this.state.signalQuota - this.state.signalEscapedCount;

    for (const p of this.state.players) {
      if (p.hasEscaped || p.state === 'DEAD') continue;

      const onLadder = (
        p.x >= this.state.ladder.x &&
        p.x <= this.state.ladder.x + this.state.ladder.width &&
        p.y >= this.state.ladder.y &&
        p.y <= this.state.ladder.y + this.state.ladder.height
      );

      if (onLadder && p.state !== 'STUNNED' && p.stunnedTimer <= 0) {
        p.state = 'CLIMBING';
        activeClimbers.push(p);

        p.climbProgress = Math.min(100, p.climbProgress + (42 * DT));
        p.y = Math.max(this.state.ladder.y + 15, p.y - 20 * DT);

        // Escape success!
        if (p.climbProgress >= 100) {
          p.state = 'ESCAPED';
          p.hasEscaped = true;
          // Format escape timestamp
          const mins = Math.floor((600 - this.matchTimer) / 60);
          const secs = Math.floor((600 - this.matchTimer) % 60);
          p.escapeTime = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

          this.state.signalEscapedCount++;
          this.state.totalEscapedCount++;
          this.soundEventsQueue.push({ type: 'ESCAPE', x: p.x, y: p.y });

          // If quota reached, close the hatch immediately!
          if (this.state.signalEscapedCount >= this.state.signalQuota) {
            this.closeHatchAndReturnToSilence('QUOTA_FILLED');
            return;
          }
        }
      } else if (!onLadder && p.state === 'CLIMBING') {
        p.state = 'IDLE';
        p.climbProgress = 0;
      }
    }

    // Quota violation: if more people on ladder than allowed, Anonymous executes the lower climber!
    if (activeClimbers.length > allowedRemaining && allowedRemaining > 0) {
      activeClimbers.sort((a, b) => a.climbProgress - b.climbProgress);
      const violator = activeClimbers[0];
      this.snipePlayer(violator, 'QUOTA_VIOLATED');
    }

    // Window closed due to time expiring
    if (this.signalWindowTimer <= 0) {
      this.closeHatchAndReturnToSilence('WINDOW_EXPIRED');
    }
  }

  private closeHatchAndReturnToSilence(reason: 'QUOTA_FILLED' | 'WINDOW_EXPIRED'): void {
    this.soundEventsQueue.push({ type: 'CLANG' });

    // Reset anyone still on the ladder
    for (const p of this.state.players) {
      if (p.state === 'CLIMBING') {
        p.state = 'IDLE';
        p.climbProgress = 0;
        p.y += 35; // Drop back into pit
      }
    }

    this.state.phase = 'WAITING_SIGNAL';
    // Random wait before Anonymous might speak again (between 18 and 35 seconds)
    this.nextSignalTimer = 18 + Math.random() * 17;

    const remaining = this.state.players.filter(p => !p.hasEscaped && p.state !== 'DEAD').length;
    if (reason === 'QUOTA_FILLED') {
      this.state.announcementText = `HATCH SLAMS SHUT! ${remaining} PRISONERS REMAIN TRAPPED IN SILENCE...`;
    } else {
      this.state.announcementText = `ANONYMOUS WITHDREW: "TOO SLOW." HATCH SEALED. (${remaining} LEFT)`;
    }
  }

  private triggerFinalPurge(): void {
    this.state.phase = 'PURGE';
    this.signalWindowTimer = 5.0;
    this.state.announcementText = 'OVERSEER: "10 MINUTES HAVE ELAPSED. PURGE THE PIT! NO SURVIVORS!"';
    this.soundEventsQueue.push({ type: 'CRASH' });

    // Execute everyone remaining in the pit
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
    player.climbProgress = 0;

    this.state.recentShots.push({
      id: `shot_${Date.now()}_${Math.random()}`,
      targetId: player.id,
      fromX: this.state.ladder.x + this.state.ladder.width / 2,
      fromY: 10,
      toX: player.x,
      toY: player.y,
      reason,
      timestamp: Date.now()
    });

    this.soundEventsQueue.push({ type: 'GUNSHOT', x: player.x, y: player.y });
  }

  private updateProjectiles(): void {
    for (let i = this.state.projectiles.length - 1; i >= 0; i--) {
      const proj = this.state.projectiles[i];
      proj.x += proj.vx * DT;
      proj.y += proj.vy * DT;
      proj.lifetime -= DT;

      let hit = false;
      for (const p of this.state.players) {
        if (p.id === proj.ownerId || p.state === 'DEAD' || p.hasEscaped) continue;
        const dist = Math.hypot(p.x - proj.x, p.y - proj.y);
        if (dist < 22) {
          hit = true;
          p.health = Math.max(0, p.health - 25);
          p.stunnedTimer = 1.5;
          p.climbProgress = 0;
          p.state = 'STUNNED';
          if (p.y < 120) p.y += 35;

          const thrower = this.state.players.find(x => x.id === proj.ownerId);
          if (thrower) thrower.sabotages++;

          this.soundEventsQueue.push({ type: 'ROCK_HIT', x: p.x, y: p.y });
          break;
        }
      }

      if (hit || proj.lifetime <= 0 || proj.x < 30 || proj.x > ARENA_WIDTH - 30 || proj.y < 30 || proj.y > ARENA_HEIGHT - 30) {
        this.state.projectiles.splice(i, 1);
      }
    }
  }

  private updateLivingPlayers(): void {
    for (const p of this.state.players) {
      if (p.state === 'DEAD' || p.hasEscaped) continue;

      if (p.stamina < 100) p.stamina = Math.min(100, p.stamina + 20 * DT);
      if (p.tackleCooldown > 0) p.tackleCooldown -= DT;
      if (p.attackCooldown > 0) p.attackCooldown -= DT;

      if (p.stunnedTimer > 0) {
        p.stunnedTimer -= DT;
        if (p.stunnedTimer <= 0) {
          p.state = 'IDLE';
        }
      }

      p.x += p.vx * DT;
      p.y += p.vy * DT;

      const margin = 35;
      p.x = Math.max(margin, Math.min(ARENA_WIDTH - margin, p.x));
      p.y = Math.max(margin, Math.min(ARENA_HEIGHT - margin, p.y));

      // Tackle hit detection
      if (p.state === 'TACKLING') {
        for (const other of this.state.players) {
          if (other.id === p.id || other.state === 'DEAD' || other.hasEscaped) continue;
          const dist = Math.hypot(other.x - p.x, other.y - p.y);
          if (dist < 32) {
            other.health = Math.max(0, other.health - 20);
            other.stunnedTimer = 1.3;
            other.climbProgress = 0;
            other.state = 'STUNNED';
            p.sabotages++;

            const angle = Math.atan2(other.y - p.y, other.x - p.x);
            other.vx = Math.cos(angle) * 260;
            other.vy = Math.sin(angle) * 260;
            other.x += other.vx * 0.1;
            other.y += other.vy * 0.1;
            this.soundEventsQueue.push({ type: 'TACKLE', x: other.x, y: other.y });
          }
        }
      }
    }
  }
}
