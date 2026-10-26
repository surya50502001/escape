import { 
  GameState, Player, Projectile, SniperShot, Rope, HatchZone, Obstacle, FallingRock, Ladder,
  FLOOR_Y, LOWER_FLOOR_Y, WORLD_WIDTH, WORLD_HEIGHT,
  V_PIPE_X, V_PIPE_TOP_Y, H_PIPE_Y, H_PIPE_EXIT_X,
  DORM_LEDGE_Y, DORM_LEFT_X, DORM_RIGHT_X,
  MAINT_ROOM_LEFT_X, MAINT_ROOM_RIGHT_X,
  MAINT_UPPER_LEDGE_Y, MAINT_UPPER_LEDGE_X, MAINT_UPPER_LEDGE_W,
  SHAFT_LEFT_X, SHAFT_RIGHT_X, BASEMENT_ENTRY_X,
  MAZE_WALLS, WallRect
} from '../server/types.js';
import { ClientCampaignSync } from '../server/campaign/campaignSession.js';
import { Room1Renderer } from './graphics/room1Renderer.js';
import { CharacterRenderer } from './graphics/characterRenderer.js';
import { LightingSystem } from './graphics/lighting.js';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private width: number = 1000;
  private height: number = 700;
  private particles: Particle[] = [];
  private lastTime: number = performance.now();

  // Scrolling camera following local player
  public cameraX: number = 0;
  public cameraY: number = 0;
  private targetCameraX: number = 0;
  private targetCameraY: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  public getCameraX(): number {
    return this.cameraX;
  }

  public getCameraY(): number {
    return this.cameraY;
  }


  public addBloodSparks(x: number, y: number, color: string = '#c0392b', count: number = 14): void {
    this.addSparks(x, y, color, count);
  }

  public addSparks(x: number, y: number, color: string = '#c0392b', count: number = 12): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 160;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 2 + Math.random() * 3,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.8
      });
    }
  }

  public render(state: GameState, localPlayerId: string): void {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const ctx = this.ctx;

    // Camera targeting and smoothing
    const localPlayer = state.players.find(p => p.id === localPlayerId);
    if (state.phase === 'PURGE') {
      // Pan camera directly to the Overseer at upper-left during final purge
      this.targetCameraX = 0;
      this.targetCameraY = 0;
    } else if (localPlayer) {
      this.targetCameraX = localPlayer.x - this.width / 2;
      this.targetCameraY = localPlayer.y - this.height * 0.55;
    } else {
      this.targetCameraX = 750 - this.width / 2;
      this.targetCameraY = FLOOR_Y - this.height * 0.6;
    }

    this.targetCameraX = Math.max(0, Math.min(WORLD_WIDTH - this.width, this.targetCameraX));
    this.targetCameraY = Math.max(0, Math.min(WORLD_HEIGHT - this.height, this.targetCameraY));

    // Smooth lerp
    const lerpSpeed = 0.08;
    this.cameraX += (this.targetCameraX - this.cameraX) * lerpSpeed;
    this.cameraY += (this.targetCameraY - this.cameraY) * lerpSpeed;
    this.cameraX = Math.max(0, Math.min(WORLD_WIDTH - this.width, this.cameraX));
    this.cameraY = Math.max(0, Math.min(WORLD_HEIGHT - this.height, this.cameraY));

    // Clear canvas before drawing
    ctx.fillStyle = '#06070a';
    ctx.fillRect(0, 0, this.width, this.height);

    // ── WORLD TRANSFORM (Camera Offset) ──────────────────────
    ctx.save();
    ctx.translate(-Math.round(this.cameraX), -Math.round(this.cameraY));

    // 1. Draw 2D Side-View Concrete & Rock Chamber and Multi-level Maze Environment
    this.drawChamberEnvironment(ctx, state);

    // 2. Draw Continuous Traversal Pipes (Right Wall Vertical -> Ceiling Horizontal)
    this.drawIndustrialPipes(ctx);

    // 3. Draw Escape Hatch & Overseer at Upper-Left
    this.drawUpperLeftHatchAndOverseer(ctx, state);

    // 4. Draw Obstacles (Moving Security Barrier)
    if (state.obstacles) {
      this.drawObstacles(ctx, state.obstacles);
    }

    // 5. Draw Ladders
    if (state.ladders) {
      this.drawLadders(ctx, state.ladders, localPlayerId, state.players);
    }

    // 6. Draw Falling Rocks & Warning Hazards
    if (state.fallingRocks) {
      this.drawFallingRocks(ctx, state.fallingRocks);
    }

    // 7. Draw Particles (impact dust, blood, sparks)
    this.updateAndDrawParticles(ctx, dt);

    // 8. Draw The Single Rope (on floor, thrown, or attached, plus aiming indicator)
    this.drawRope(ctx, state.rope, state.players, localPlayerId);

    // 9. Draw Thrown Rocks
    this.drawProjectiles(ctx, state.projectiles);

    // 10. Draw Dead Prisoners
    for (const p of state.players) {
      if (p.state === 'DEAD') {
        this.drawDeadHuman(ctx, p);
      }
    }

    // 11. Draw Living Human Prisoners
    for (const p of state.players) {
      if (p.state !== 'DEAD' && !p.hasEscaped) {
        const isLocal = p.id === localPlayerId;
        CharacterRenderer.getInstance().drawPlayer(ctx, p, isLocal, now);
      }
    }

    // 12. Draw Sniper Shots
    this.drawSniperShots(ctx, state.recentShots);

    ctx.restore();
    // ── END WORLD TRANSFORM ──────────────────────────────────

    // Cinematic vignette
    LightingSystem.getInstance().drawCinematicVignette(ctx, this.width, this.height);

    // 13. Draw Clean Tactical HUD & Timers in Viewport Space
    this.drawHUD(ctx, state, localPlayerId);

    // 14. Match Over Screen if completed
    if (state.phase === 'MATCH_OVER') {
      this.drawMatchOverScreen(ctx, state);
    }
  }

  // ==========================================
  // 1. 2D SIDE-VIEW INDUSTRIAL CHAMBER & MAZE
  // ==========================================
  private drawChamberEnvironment(ctx: CanvasRenderingContext2D, _state: GameState): void {
    // Background bedrock
    ctx.fillStyle = '#07080c';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Concrete masonry seams
    ctx.strokeStyle = '#11141c';
    ctx.lineWidth = 1.5;
    for (let x = 0; x < WORLD_WIDTH; x += 120) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y < WORLD_HEIGHT; y += 90) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke();
    }

    // Water seepage stains
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.fillRect(350, 0, 40, FLOOR_Y);
    ctx.fillRect(720, 0, 30, FLOOR_Y);
    ctx.fillRect(1350, 0, 35, FLOOR_Y);
    ctx.fillRect(1950, 0, 45, FLOOR_Y);
    ctx.fillRect(2700, 0, 35, LOWER_FLOOR_Y);

    // Draw MAZE_WALLS
    for (const wall of MAZE_WALLS) {
      if (wall.isPlatform) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
        ctx.fillStyle = '#475569';
        ctx.fillRect(wall.x, wall.y, wall.width, 3);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        for (let gx = wall.x + 8; gx < wall.x + wall.width; gx += 14) {
          ctx.beginPath();
          ctx.moveTo(gx, wall.y + 3);
          ctx.lineTo(gx - 5, wall.y + wall.height - 1);
          ctx.stroke();
        }
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(wall.x + 6, wall.y + wall.height, 8, 12);
        ctx.fillRect(wall.x + wall.width - 14, wall.y + wall.height, 8, 12);
      } else {
        ctx.fillStyle = '#141720';
        ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
        ctx.strokeStyle = '#090b10';
        ctx.lineWidth = 2;
        ctx.strokeRect(wall.x, wall.y, wall.width, wall.height);
        if (wall.width > 50 && (wall.y === FLOOR_Y || wall.y === LOWER_FLOOR_Y)) {
          ctx.fillStyle = '#2d3340';
          ctx.fillRect(wall.x, wall.y - 3, wall.width, 4);
          ctx.fillStyle = '#475569';
          ctx.fillRect(wall.x, wall.y - 3, wall.width, 1.5);
        }
      }
    }

    // ── MAINTENANCE ROOM label & props (X=30–420)
    ctx.fillStyle = '#161d2a';
    ctx.fillRect(60, MAINT_UPPER_LEDGE_Y + 20, 50, 90);
    ctx.fillRect(130, MAINT_UPPER_LEDGE_Y + 40, 60, 70);
    ctx.fillStyle = '#243042';
    ctx.fillRect(70, MAINT_UPPER_LEDGE_Y + 50, 8, 2);
    ctx.fillRect(140, MAINT_UPPER_LEDGE_Y + 60, 8, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SECTOR 1-A // WORKSHOP & LADDER STORAGE', 50, MAINT_UPPER_LEDGE_Y - 8);

    // ── DORMITORY label & bunk beds (X=580–1080, Y=200–360)
    ctx.fillStyle = '#141824';
    for (let bx = DORM_LEFT_X + 60; bx < DORM_RIGHT_X - 40; bx += 90) {
      ctx.fillRect(bx, 220, 60, 78);
      ctx.fillStyle = '#0b0d14';
      ctx.fillRect(bx + 4, 226, 52, 30);
      ctx.fillRect(bx + 4, 264, 52, 30);
      ctx.fillStyle = '#141824';
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('CELL BLOCK B // DORMITORY [ELEVATION: ' + DORM_LEDGE_Y + ']', DORM_LEFT_X + 20, DORM_LEDGE_Y - 8);

    // ── SHAFT GAP hazard markings
    ctx.fillStyle = '#eab308';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(SHAFT_LEFT_X - 40 + i * 10, FLOOR_Y);
      ctx.lineTo(SHAFT_LEFT_X - 30 + i * 10, FLOOR_Y);
      ctx.lineTo(SHAFT_LEFT_X - 40 + i * 10, FLOOR_Y + 12);
      ctx.lineTo(SHAFT_LEFT_X - 50 + i * 10, FLOOR_Y + 12);
      ctx.fill();
    }
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚠ SHAFT DROP ⚠', (SHAFT_LEFT_X + SHAFT_RIGHT_X) / 2, FLOOR_Y + 22);

    // ── BASEMENT area
    ctx.fillStyle = '#10131a';
    ctx.fillRect(BASEMENT_ENTRY_X, LOWER_FLOOR_Y, WORLD_WIDTH - BASEMENT_ENTRY_X, WORLD_HEIGHT - LOWER_FLOOR_Y);
    ctx.fillStyle = '#0b0d12';
    for (let bx = BASEMENT_ENTRY_X + 60; bx < WORLD_WIDTH - 30; bx += 180) {
      ctx.fillRect(bx, LOWER_FLOOR_Y, 16, WORLD_HEIGHT - LOWER_FLOOR_Y);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SUB-LEVEL 02 // BASEMENT CORRIDOR', BASEMENT_ENTRY_X + 50, LOWER_FLOOR_Y + 30);

    // ── SERVICE CORRIDOR label
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('SERVICE CORRIDOR // SLUICE GATE', 1220, 492);

    // ── MAIN FLOOR label
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('SECTOR 0 // COMMON DETENTION FLOOR', 450, FLOOR_Y + 28);
  }

  // ==========================================
  // 2. INDUSTRIAL PIPES: RIGHT WALL & CEILING
  // ==========================================
  private drawIndustrialPipes(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    // Wall Mount Brackets on Right Wall
    ctx.fillStyle = '#334155';
    for (let y = 140; y < FLOOR_Y; y += 90) {
      ctx.fillRect(V_PIPE_X - 6, y - 5, 50, 10);
      // Bracket wall bolts
      ctx.fillStyle = '#475569';
      ctx.fillRect(V_PIPE_X + 38, y - 4, 4, 8);
      ctx.fillStyle = '#334155';
    }

    // Ceiling Hangar Brackets
    for (let x = H_PIPE_EXIT_X + 60; x < V_PIPE_X - 40; x += 140) {
      ctx.fillRect(x - 4, 0, 8, H_PIPE_Y);
      // Joint flange
      ctx.fillStyle = '#475569';
      ctx.fillRect(x - 7, H_PIPE_Y - 14, 14, 5);
      ctx.fillStyle = '#334155';
    }

    // --- Vertical Pipe (Right Wall) ---
    // Pipe base body
    const vGrad = ctx.createLinearGradient(V_PIPE_X - 10, 0, V_PIPE_X + 10, 0);
    vGrad.addColorStop(0, '#475569');
    vGrad.addColorStop(0.35, '#94a3b8'); // Metallic reflection
    vGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = vGrad;
    ctx.fillRect(V_PIPE_X - 9, V_PIPE_TOP_Y, 18, FLOOR_Y - V_PIPE_TOP_Y);

    // Vertical Pipe Flanges / Rusted Ribs
    ctx.fillStyle = '#64748b';
    for (let y = 120; y < FLOOR_Y; y += 80) {
      ctx.fillRect(V_PIPE_X - 12, y - 3, 24, 6);
    }

    // --- Corner 90° Elbow Joint (Top Right) ---
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(V_PIPE_X, H_PIPE_Y, 14, 0, Math.PI * 2);
    ctx.fill();

    // --- Horizontal Pipe (Across Ceiling to Left) ---
    const hGrad = ctx.createLinearGradient(0, H_PIPE_Y - 9, 0, H_PIPE_Y + 9);
    hGrad.addColorStop(0, '#475569');
    hGrad.addColorStop(0.35, '#94a3b8');
    hGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = hGrad;
    ctx.fillRect(H_PIPE_EXIT_X, H_PIPE_Y - 8, V_PIPE_X - H_PIPE_EXIT_X, 16);

    // Horizontal Pipe Joint Flanges
    ctx.fillStyle = '#64748b';
    for (let x = H_PIPE_EXIT_X + 80; x < V_PIPE_X; x += 120) {
      ctx.fillRect(x - 4, H_PIPE_Y - 11, 8, 22);
    }

    // Rust texture spots along pipe
    ctx.fillStyle = 'rgba(180, 83, 9, 0.45)';
    ctx.fillRect(V_PIPE_X - 7, 240, 14, 30);
    ctx.fillRect(520, H_PIPE_Y - 6, 45, 12);
    ctx.fillRect(310, H_PIPE_Y - 6, 35, 12);

    // Navigation Hint Arrows along pipe
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▲ CLIMB WALL PIPE', V_PIPE_X - 55, 360);
    ctx.fillText('◄ TRAVERSE CEILING PIPE TO ESCAPE ◄', 520, H_PIPE_Y - 18);

    ctx.restore();
  }

  // ==========================================
  // 3. UPPER-LEFT HATCH & ANONYMOUS OVERSEER
  // ==========================================
  private drawUpperLeftHatchAndOverseer(ctx: CanvasRenderingContext2D, state: GameState): void {
    const isOpen = state.phase === 'SIGNAL_ACTIVE';
    const isPurge = state.phase === 'PURGE';
    const hatch = state.hatch;

    ctx.save();

    // Dark escape duct / hatch tunnel in upper-left
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, hatch.y - 15, hatch.width + 45, hatch.height + 25);

    // Reinforced heavy steel hatch door frame
    ctx.strokeStyle = isPurge ? '#ef4444' : (isOpen ? '#22c55e' : '#7f1d1d');
    ctx.lineWidth = 6;
    ctx.strokeRect(hatch.x, hatch.y, hatch.width, hatch.height);

    // Industrial Spotlight above the hatch
    ctx.fillStyle = '#334155';
    ctx.fillRect(hatch.x + hatch.width - 10, hatch.y - 16, 18, 12);

    // Harsh volumetric cone of light casting across upper chamber
    if (isOpen || isPurge) {
      const cone = ctx.createRadialGradient(
        hatch.x + hatch.width, hatch.y + 10, 10,
        hatch.x + hatch.width + 300, hatch.y + 140, 450
      );
      if (isPurge) {
        cone.addColorStop(0, 'rgba(239, 68, 68, 0.45)');
        cone.addColorStop(0.5, 'rgba(239, 68, 68, 0.15)');
        cone.addColorStop(1, 'rgba(239, 68, 68, 0.0)');
      } else {
        cone.addColorStop(0, 'rgba(34, 197, 94, 0.4)');
        cone.addColorStop(0.5, 'rgba(34, 197, 94, 0.12)');
        cone.addColorStop(1, 'rgba(34, 197, 94, 0.0)');
      }

      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(hatch.x + hatch.width, hatch.y - 5);
      ctx.lineTo(hatch.x + hatch.width + 450, hatch.y + 240);
      ctx.lineTo(hatch.x + hatch.width + 250, hatch.y + 360);
      ctx.lineTo(hatch.x + hatch.width - 15, hatch.y + hatch.height);
      ctx.closePath();
      ctx.fill();
    }

    // --- ANONYMOUS OVERSEER SILHOUETTE ---
    // Standing in the upper-left escape opening
    const overseerX = hatch.x + 35;
    const overseerY = hatch.y + 55;

    // Trenchcoat / Torso
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(overseerX - 12, overseerY - 26, 24, 38);
    // Shoulder tactical armor
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(overseerX - 14, overseerY - 24, 5, 12);
    ctx.fillRect(overseerX + 9, overseerY - 24, 5, 12);

    // Head / Tactical Hood
    ctx.fillStyle = '#0a0d14';
    ctx.beginPath();
    ctx.arc(overseerX, overseerY - 33, 10, 0, Math.PI * 2);
    ctx.fill();

    // Glowing ocular optic / visor
    ctx.fillStyle = (isOpen || isPurge) ? '#ef4444' : '#64748b';
    ctx.fillRect(overseerX - 2, overseerY - 35, 7, 3);

    // Heavy sniper rifle resting over the ledge aiming down into the pit
    const muzzleX = overseerX + 38;
    const muzzleY = overseerY + 4;
    ctx.strokeStyle = '#020617';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(overseerX - 4, overseerY - 14);
    ctx.lineTo(muzzleX, muzzleY);
    ctx.stroke();

    // Sniper Scope Optic with red glint
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(overseerX + 8, overseerY - 10, 14, 5);
    ctx.fillStyle = (isOpen || isPurge) ? '#ef4444' : '#64748b';
    ctx.beginPath();
    ctx.arc(overseerX + 22, overseerY - 8, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Red Laser Sight Targeting Beam into the pit when active or purging
    if (isOpen || isPurge) {
      ctx.strokeStyle = isPurge ? 'rgba(239, 68, 68, 0.75)' : 'rgba(239, 68, 68, 0.35)';
      ctx.lineWidth = isPurge ? 1.5 : 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(muzzleX, muzzleY);
      ctx.lineTo(muzzleX + 500, muzzleY + 420);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Label above overseer
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ANONYMOUS OVERSEER', overseerX, hatch.y - 4);

    // Label below hatch with state
    ctx.fillStyle = isPurge ? '#ef4444' : (isOpen ? '#86efac' : '#94a3b8');
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    const hatchStatus = isPurge ? 'PURGE ACTIVE - DEADLY' : (isOpen ? 'HATCH: OPEN (QUOTA: 1)' : 'HATCH: SEALED');
    ctx.fillText(hatchStatus, hatch.x + hatch.width / 2, hatch.y + hatch.height + 18);

    ctx.restore();
  }

  // ==========================================
  // 4. ENVIRONMENTAL OBSTACLES (CATWALK, SPIKES, STEAM, BARRIER)
  // ==========================================
  // ==========================================
  // 4. ENVIRONMENTAL OBSTACLES (MOVING BARRIER & PLATFORMS)
  // ==========================================
  private drawObstacles(ctx: CanvasRenderingContext2D, obstacles: Obstacle[]): void {
    const time = performance.now() / 1000;

    for (const obs of obstacles) {
      ctx.save();

      if (obs.type === 'PLATFORM') {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
        ctx.fillStyle = '#475569';
        ctx.fillRect(obs.x, obs.y, obs.width, 3);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        for (let gx = obs.x + 8; gx < obs.x + obs.width; gx += 12) {
          ctx.beginPath();
          ctx.moveTo(gx, obs.y + 3);
          ctx.lineTo(gx - 6, obs.y + obs.height - 1);
          ctx.stroke();
        }
      } else if (obs.type === 'MOVING_BARRIER') {
        // Heavy Hydraulic Security Sluice Gate in Service Corridor
        ctx.fillStyle = '#334155';
        ctx.fillRect(obs.x + obs.width / 2 - 4, 500, 8, obs.y - 500);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(obs.x + obs.width / 2 - 2, obs.y - 10, 4, 10);

        // Barrier Body
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);

        // Yellow and Black Diagonal Hazard Stripes
        ctx.save();
        ctx.beginPath();
        ctx.rect(obs.x, obs.y, obs.width, obs.height);
        ctx.clip();

        ctx.fillStyle = '#eab308';
        ctx.lineWidth = 6;
        for (let sx = -obs.height; sx < obs.width + obs.height; sx += 14) {
          ctx.beginPath();
          ctx.moveTo(obs.x + sx, obs.y);
          ctx.lineTo(obs.x + sx + 8, obs.y);
          ctx.lineTo(obs.x + sx + 8 + obs.height, obs.y + obs.height);
          ctx.lineTo(obs.x + sx + obs.height, obs.y + obs.height);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();

        // Metallic reinforced frame
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);

        // Status Beacon Light on top
        const beaconP = (Math.sin(time * 8) + 1) / 2;
        ctx.fillStyle = `rgba(239, 68, 68, ${0.6 + beaconP * 0.4})`;
        ctx.beginPath();
        ctx.arc(obs.x + obs.width / 2, obs.y + 6, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // ==========================================
  // 4B. PHYSICAL LADDERS (PLACED IN WORLD)
  // ==========================================
  private drawLadders(ctx: CanvasRenderingContext2D, ladders: Ladder[], localPlayerId: string, players: Player[]): void {
    const time = performance.now() / 1000;
    const localPlayer = players.find(p => p.id === localPlayerId);

    for (const ladder of ladders) {
      if (ladder.state === 'CARRIED') continue; // Drawn attached to carrier

      const lx = ladder.x;
      const ly = ladder.y;
      const lw = ladder.width || 20;
      const lh = ladder.height || 90;
      const halfW = lw / 2;

      ctx.save();

      // Drop shadow on wall/floor
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(lx - halfW + 3, ly + 3, lw, lh);

      // Side Rails (Heavy steel / reinforced alloy)
      const railGrad = ctx.createLinearGradient(lx - halfW, 0, lx + halfW, 0);
      railGrad.addColorStop(0, '#334155');
      railGrad.addColorStop(0.5, '#64748b');
      railGrad.addColorStop(1, '#1e293b');

      ctx.fillStyle = railGrad;
      // Left rail
      ctx.fillRect(lx - halfW, ly, 4, lh);
      // Right rail
      ctx.fillRect(lx + halfW - 4, ly, 4, lh);

      // Rungs every 14px
      ctx.fillStyle = '#94a3b8';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      for (let ry = ly + 8; ry < ly + lh - 4; ry += 14) {
        ctx.fillRect(lx - halfW + 3, ry - 2, lw - 6, 4);
        ctx.strokeRect(lx - halfW + 3, ry - 2, lw - 6, 4);
      }

      // Base footing plates
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(lx - halfW - 2, ly + lh - 3, 6, 4);
      ctx.fillRect(lx + halfW - 4, ly + lh - 3, 6, 4);

      // Interaction Prompt for Local Player
      if (localPlayer && localPlayer.state !== 'DEAD' && !localPlayer.hasEscaped) {
        const distToBase = Math.hypot(localPlayer.x - lx, localPlayer.y - (ly + lh));
        const distToLadderX = Math.abs(localPlayer.x - lx);
        const inClimbY = localPlayer.y >= ly - 10 && localPlayer.y <= ly + lh + 10;

        if (distToBase < 55 && !localPlayer.carryingLadderId) {
          const pulse = 0.7 + Math.sin(time * 6) * 0.3;
          ctx.fillStyle = `rgba(253, 224, 71, ${pulse})`;
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('[E] PICK UP LADDER', lx, ly - 14);

          if (distToLadderX < 35 && inClimbY) {
            ctx.fillStyle = '#38bdf8';
            ctx.fillText('[W / ▲] CLIMB LADDER', lx, ly - 26);
          }
        }
      }

      ctx.restore();
    }
  }

  // ==========================================
  // 5. FALLING CEILING ROCKS & DANGER CRACKS
  // ==========================================
  private drawFallingRocks(ctx: CanvasRenderingContext2D, fallingRocks: FallingRock[]): void {
    const time = performance.now() / 1000;

    for (const rock of fallingRocks) {
      ctx.save();
      const rockRadius = rock.radius || 14;
      const isWarning = rock.warningTimer !== undefined ? rock.warningTimer > 0 : (rock as unknown as { state?: string }).state === 'WARNING';

      if (isWarning) {
        // Ceiling fracture cracks at rock.x
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rock.x, 0);
        ctx.lineTo(rock.x - 6, 8);
        ctx.lineTo(rock.x + 4, 16);
        ctx.lineTo(rock.x - 2, 24);
        ctx.moveTo(rock.x, 0);
        ctx.lineTo(rock.x + 8, 10);
        ctx.lineTo(rock.x + 14, 20);
        ctx.stroke();

        // Warning crumb dust tumbling
        ctx.fillStyle = '#64748b';
        const dustY = ((time * 120) % 70);
        ctx.fillRect(rock.x - 2 + Math.sin(time * 10) * 4, dustY, 2, 2);
        ctx.fillRect(rock.x + 3 + Math.cos(time * 10) * 4, (dustY + 25) % 70, 2, 2);

        // Floor warning targeting indicator shadow
        const shadowP = 0.3 + (Math.sin(time * 14) + 1) * 0.2;
        ctx.fillStyle = `rgba(239, 68, 68, ${shadowP})`;
        ctx.beginPath();
        ctx.ellipse(rock.x, FLOOR_Y - 2, rockRadius * 1.2, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('▲ CRUMBLING CEILING ▲', rock.x, 38);

      } else {
        // Falling boulder
        // Motion speed blur lines
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rock.x - 4, rock.y - rockRadius - 12);
        ctx.lineTo(rock.x - 4, rock.y - rockRadius);
        ctx.moveTo(rock.x + 4, rock.y - rockRadius - 18);
        ctx.lineTo(rock.x + 4, rock.y - rockRadius);
        ctx.stroke();

        // Rough jagged polygonal boulder
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        const pts = 7;
        for (let i = 0; i < pts; i++) {
          const angle = (i / pts) * Math.PI * 2;
          const r = rockRadius * (0.85 + (i % 3) * 0.15);
          const px = rock.x + Math.cos(angle) * r;
          const py = rock.y + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // Edge contour and highlights
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Surface fissure
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rock.x - 4, rock.y - 4);
        ctx.lineTo(rock.x + 2, rock.y + 2);
        ctx.lineTo(rock.x + 5, rock.y - 3);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // ==========================================
  // 6. THE ROPE (ON FLOOR / CARRIED / ATTACHED / THROWN)
  // ==========================================
  private drawRope(ctx: CanvasRenderingContext2D, rope: Rope, players: Player[], localPlayerId: string): void {
    ctx.save();
    const time = performance.now() / 1000;

    if (rope.state === 'ON_FLOOR') {
      // Coiled hemp rope resting on dirty concrete floor
      ctx.fillStyle = '#b45309';
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2;

      // Coils
      ctx.beginPath();
      ctx.ellipse(rope.x, FLOOR_Y - 4, 18, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(rope.x - 2, FLOOR_Y - 6, 14, 5, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Loose rope end
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rope.x + 8, FLOOR_Y - 5);
      ctx.quadraticCurveTo(rope.x + 22, FLOOR_Y - 12, rope.x + 30, FLOOR_Y - 2);
      ctx.stroke();

      // Action hint prompt with pulsing glow
      const promptAlpha = 0.75 + Math.sin(time * 6) * 0.25;
      ctx.fillStyle = `rgba(253, 224, 71, ${promptAlpha})`;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('[E] PICK UP ROPE', rope.x, FLOOR_Y - 22);

    } else if (rope.state === 'HELD') {
      const holder = players.find(p => p.id === rope.heldByPlayerId);
      if (holder) {
        // Coiled rope in player's hands with trailing cord
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 3;
        ctx.beginPath();
        const handX = holder.x + (holder.facing === 'RIGHT' ? 10 : -10);
        const handY = holder.y - 18;
        ctx.moveTo(handX, handY);
        ctx.lineTo(holder.x, holder.y - 6);
        ctx.stroke();

        const canThrowRope = holder.id === localPlayerId &&
          holder.state !== 'DEAD' &&
          holder.state !== 'STUNNED' &&
          !holder.climbGrabbingId &&
          !holder.grabbedByPlayerId &&
          holder.attackCooldown <= 0;

        if (canThrowRope) {
          // Draw aiming trajectory dotted line for local player
          const aimLen = rope.maxDistance || 280;
          const endAimX = handX + Math.cos(holder.angle) * aimLen;
          const endAimY = handY + Math.sin(holder.angle) * aimLen;

          ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(handX, handY);
          ctx.lineTo(endAimX, endAimY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Aim crosshair circle
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(endAimX, endAimY, 5, 0, Math.PI * 2);
          ctx.stroke();

          // Overhead HUD hint for local player (offset cleanly above name tag)
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(holder.x - 110, holder.y - 66, 220, 16);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1;
          ctx.strokeRect(holder.x - 110, holder.y - 66, 220, 16);
          ctx.fillStyle = '#fde047';
          ctx.font = 'bold 9px monospace';
          ctx.fillText('AIM: MOUSE | CLICK: THROW | [E] DROP', holder.x, holder.y - 54);
        } else if (holder.id === localPlayerId) {
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(holder.x - 55, holder.y - 66, 110, 16);
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1;
          ctx.strokeRect(holder.x - 55, holder.y - 66, 110, 16);
          ctx.fillStyle = '#cbd5e1';
          ctx.font = 'bold 9px monospace';
          ctx.fillText('[E] DROP ROPE', holder.x, holder.y - 54);
        } else {
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(holder.x - 50, holder.y - 66, 100, 16);
          ctx.fillStyle = '#fde047';
          ctx.font = 'bold 9px monospace';
          ctx.fillText('HOLDING ROPE', holder.x, holder.y - 54);
        }
      }

    } else if (rope.state === 'THROWN') {
      // Flying rope projectile with lasso loop
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(rope.x, rope.y, 8, 0, Math.PI * 2);
      ctx.stroke();

      // Trailing dynamic rope segments connecting throw origin / holder
      const holder = players.find(p => p.id === rope.heldByPlayerId);
      const startX = rope.startX ?? (holder ? holder.x : rope.x);
      const startY = rope.startY ?? (holder ? holder.y - 18 : rope.y);

      ctx.strokeStyle = 'rgba(217, 119, 6, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      // Slight droop curve
      const midX = (startX + rope.x) / 2;
      const midY = (startY + rope.y) / 2 + 18;
      ctx.quadraticCurveTo(midX, midY, rope.x, rope.y);
      ctx.stroke();

    } else if (rope.state === 'ATTACHED') {
      const holder = players.find(p => p.id === rope.heldByPlayerId);
      const target = players.find(p => p.id === rope.attachedPlayerId);

      if (holder && target) {
        const isPulling = Boolean(rope.pulling);
        const holderHandX = holder.x + (holder.facing === 'RIGHT' ? 10 : -10);
        const holderHandY = holder.y - 18;

        if (isPulling) {
          // Dynamic tense cable with electrical/strain vibration
          const jitter = (Math.sin(time * 30) * 3);
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(holderHandX, holderHandY);
          const midX = (holderHandX + target.x) / 2 + jitter;
          const midY = (holderHandY + target.y) / 2 - jitter;
          ctx.lineTo(midX, midY);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
        } else {
          // Taut rope connecting holder to victim
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(holderHandX, holderHandY);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
        }

        // Lasso loop wrapped around target's torso/legs
        ctx.strokeStyle = isPulling ? '#ef4444' : '#b45309';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(target.x, target.y - 8, 12, 7, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Contextual action prompt for holder
        if (holder.id === localPlayerId) {
          ctx.fillStyle = isPulling ? '#f97316' : '#fde047';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          const actionText = isPulling
            ? '⚡ DRAGGING VICTIM! [E: RELEASE]'
            : '⚡ VICTIM HOOKED! [HOLD SPACE/CLICK: DRAG | E: RELEASE]';
          ctx.fillText(actionText, holder.x, holder.y - 44);
        } else if (target.id === localPlayerId) {
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('⚠ ENSNARED IN ROPE! ⚠', target.x, target.y - 48);
        }
      }
    }

    ctx.restore();
  }

  // ==========================================
  // 5. REALISTIC 2D HUMAN PRISONER SILHOUETTES
  // ==========================================
  private drawHumanPrisoner(ctx: CanvasRenderingContext2D, p: Player, isLocal: boolean): void {
    ctx.save();
    ctx.translate(p.x, p.y);

    // Player target ring
    if (isLocal) {
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(0, -18, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const isFacingRight = p.facing === 'RIGHT';
    const dir = isFacingRight ? 1 : -1;

    // Head / Skin tones
    const skinTone = '#d49b6a';
    const darkSkinTone = '#b27b4c';
    const clothColor = p.color;

    // --- ANIMATIONS ACCORDING TO STATE ---
    if (p.state === 'ON_FLOOR') {
      // Ground contact shadow under feet
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      const isRunning = Math.abs(p.vx) > 10;
      const step = isRunning ? Math.sin(Date.now() * 0.016) : 0;

      // Legs in motion
      ctx.strokeStyle = '#1e293b'; // Dark prison trousers
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';

      // Back leg
      ctx.beginPath();
      ctx.moveTo(-2 * dir, -12);
      ctx.lineTo((-6 - step * 9) * dir, -5);
      ctx.lineTo((-7 - step * 10) * dir, 0);
      ctx.stroke();

      // Front leg
      ctx.beginPath();
      ctx.moveTo(2 * dir, -12);
      ctx.lineTo((4 + step * 9) * dir, -5);
      ctx.lineTo((5 + step * 10) * dir, 0);
      ctx.stroke();

      // Torso (Side-view prison vest, leaning forward if running)
      const lean = isRunning ? 3 * dir : 0;
      ctx.fillStyle = clothColor;
      ctx.beginPath();
      ctx.moveTo(-5 * dir + lean, -24);
      ctx.lineTo(6 * dir + lean, -24);
      ctx.lineTo(4 * dir, -12);
      ctx.lineTo(-4 * dir, -12);
      ctx.closePath();
      ctx.fill();

      // Head & Neck
      ctx.fillStyle = darkSkinTone;
      ctx.fillRect(-2 * dir + lean, -28, 4, 5); // Neck

      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.arc(lean, -33, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // Inmate hair
      ctx.fillStyle = '#292524';
      ctx.beginPath();
      ctx.arc(lean - 1 * dir, -35, 5.5, 0, Math.PI * 2);
      ctx.fill();

      // Arms (Pumping when running, aiming when throwing)
      ctx.strokeStyle = skinTone;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      if (isRunning) {
        ctx.moveTo(lean, -22);
        ctx.lineTo((-5 - step * 7) * dir, -16);
        ctx.lineTo((-7 - step * 8) * dir, -12);
      } else {
        ctx.moveTo(lean, -22);
        ctx.lineTo(5 * dir, -16);
        ctx.lineTo(7 * dir, -12);
      }
      ctx.stroke();

    } else if (p.state === 'CLIMBING_V_PIPE') {
      // --- VERTICAL PIPE CLIMBING ANIMATION ---
      const climbCycle = Math.sin(Date.now() * 0.014);
      const isKicking = p.climbKickTimer && p.climbKickTimer > 0;
      const isGrabbing = Boolean(p.climbGrabbingId);
      const isGrabbed = Boolean(p.grabbedByPlayerId);

      // Torso
      ctx.fillStyle = clothColor;
      ctx.fillRect(-6, -26, 12, 16);

      // Head
      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.arc(0, -32, 6.5, 0, Math.PI * 2);
      ctx.fill();

      if (isGrabbed) {
        // Dangling helplessly while held beneath attacker with struggle jitter
        const jitter = (p.struggleMeter && p.struggleMeter > 0) ? Math.sin(Date.now() * 0.06) * 2.5 : 0;
        ctx.translate(jitter, 0);

        // Arms reaching straight up to attacker
        ctx.strokeStyle = skinTone;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-3, -24); ctx.lineTo(-4, -40);
        ctx.moveTo(3, -24);  ctx.lineTo(4, -40);
        ctx.stroke();

        // Legs dangling downward
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-3, -10); ctx.lineTo(-4, 6); ctx.lineTo(-5, 14);
        ctx.moveTo(3, -10);  ctx.lineTo(4, 8);  ctx.lineTo(5, 16);
        ctx.stroke();

      } else if (isKicking) {
        // Kicking leg thrusting downward/forward
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        // Left leg holding pipe
        ctx.moveTo(-2, -10); ctx.lineTo(3, -4); ctx.lineTo(6, 0);
        // Right leg kicking downward
        ctx.moveTo(3, -10);  ctx.lineTo(-4, 6);  ctx.lineTo(-8, 18);
        ctx.stroke();

        // Motion swoosh line beneath kicking foot
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(-8, 18, 10, Math.PI * 0.3, Math.PI * 0.9);
        ctx.stroke();

        // Hands gripping pipe tightly
        ctx.strokeStyle = skinTone;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(0, -24); ctx.lineTo(6, -28); ctx.lineTo(6, -34);
        ctx.moveTo(0, -24); ctx.lineTo(6, -20); ctx.lineTo(6, -16);
        ctx.stroke();

      } else if (isGrabbing) {
        // One hand on pipe, one reaching down gripping victim
        ctx.strokeStyle = skinTone;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        // Upper arm on pipe
        ctx.moveTo(0, -24); ctx.lineTo(6, -28); ctx.lineTo(6, -34);
        // Lower arm reaching down grasping
        ctx.moveTo(0, -24); ctx.lineTo(-2, -8); ctx.lineTo(0, 12);
        ctx.stroke();

        // Legs on pipe
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-3, -10); ctx.lineTo(4, -6); ctx.lineTo(6, -2);
        ctx.moveTo(3, -10);  ctx.lineTo(4, -2); ctx.lineTo(6, 4);
        ctx.stroke();

      } else {
        // Normal climbing animation
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-3, -10);
        ctx.lineTo(4, -6 + climbCycle * 5);
        ctx.lineTo(6, -2 + climbCycle * 5);
        ctx.moveTo(3, -10);
        ctx.lineTo(4, -6 - climbCycle * 5);
        ctx.lineTo(6, -2 - climbCycle * 5);
        ctx.stroke();

        ctx.strokeStyle = skinTone;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(0, -24);
        ctx.lineTo(6, -28 - climbCycle * 6);
        ctx.lineTo(6, -34 - climbCycle * 6);
        ctx.moveTo(0, -24);
        ctx.lineTo(6, -22 + climbCycle * 6);
        ctx.lineTo(6, -18 + climbCycle * 6);
        ctx.stroke();
      }

    } else if (p.state === 'HANGING_H_PIPE') {
      // --- HORIZONTAL CEILING PIPE BRACHIATION ---
      const handCycle = Math.sin(Date.now() * 0.014);
      const isKicking = p.climbKickTimer && p.climbKickTimer > 0;
      const isGrabbing = Boolean(p.climbGrabbingId);
      const isGrabbed = Boolean(p.grabbedByPlayerId);

      // Torso
      ctx.fillStyle = clothColor;
      ctx.fillRect(-5, -14, 10, 16);

      // Head
      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.arc(0, -18, 6.5, 0, Math.PI * 2);
      ctx.fill();

      if (isGrabbed) {
        // Dangling suspended
        const jitter = (p.struggleMeter && p.struggleMeter > 0) ? Math.sin(Date.now() * 0.06) * 2.5 : 0;
        ctx.translate(jitter, 0);

        ctx.strokeStyle = skinTone;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-3, -14); ctx.lineTo(-4, -36);
        ctx.moveTo(3, -14);  ctx.lineTo(4, -36);
        ctx.stroke();

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-3, 2); ctx.lineTo(-4, 14); ctx.lineTo(-5, 22);
        ctx.moveTo(3, 2);  ctx.lineTo(4, 16);  ctx.lineTo(5, 24);
        ctx.stroke();

      } else if (isKicking) {
        // Hanging with both hands, kicking forward/downward
        ctx.strokeStyle = skinTone;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-4, -14); ctx.lineTo(-6, -24); ctx.lineTo(-7, -28);
        ctx.moveTo(4, -14);  ctx.lineTo(6, -24);  ctx.lineTo(7, -28);
        ctx.stroke();

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.moveTo(-3, 2); ctx.lineTo(dir * 12, 10); ctx.lineTo(dir * 22, 16);
        ctx.stroke();

        // Kicking impact visual arc
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(dir * 22, 16, 10, 0, Math.PI * 2);
        ctx.stroke();

      } else if (isGrabbing) {
        // One hand on ceiling pipe, one hand reaching down
        ctx.strokeStyle = skinTone;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-4, -14); ctx.lineTo(-6, -24); ctx.lineTo(-7, -28);
        // Grabbing arm down
        ctx.moveTo(4, -14); ctx.lineTo(4, 2); ctx.lineTo(4, 18);
        ctx.stroke();

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-3, 2); ctx.lineTo(-4, 12); ctx.lineTo(-5, 20);
        ctx.moveTo(3, 2);  ctx.lineTo(4, 12);  ctx.lineTo(5, 20);
        ctx.stroke();

      } else {
        // Normal horizontal traverse
        ctx.strokeStyle = skinTone;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-4, -14);
        ctx.lineTo(-6 - handCycle * 5, -24);
        ctx.lineTo(-7 - handCycle * 5, -28);
        ctx.moveTo(4, -14);
        ctx.lineTo(6 + handCycle * 5, -24);
        ctx.lineTo(7 + handCycle * 5, -28);
        ctx.stroke();

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-3, 2);
        ctx.lineTo(-4 + handCycle * 4, 12);
        ctx.lineTo(-5 + handCycle * 5, 20);
        ctx.moveTo(3, 2);
        ctx.lineTo(4 - handCycle * 4, 12);
        ctx.lineTo(5 - handCycle * 5, 20);
        ctx.stroke();
      }

    } else if (p.state === 'FALLING') {
      // --- RAGDOLL / TUMBLING DOWNWARD ---
      ctx.rotate(0.2 * dir);

      ctx.fillStyle = clothColor;
      ctx.fillRect(-6, -20, 12, 14);

      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.arc(0, -26, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // Flailing arms
      ctx.strokeStyle = skinTone;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-4, -18); ctx.lineTo(-12, -26);
      ctx.moveTo(4, -18);  ctx.lineTo(12, -10);
      ctx.stroke();

      // Flailing legs
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-3, -6); ctx.lineTo(-8, 6);
      ctx.moveTo(3, -6);  ctx.lineTo(7, 4);
      ctx.stroke();
    } else if (p.state === 'STUNNED') {
      // Slumped on knees
      ctx.fillStyle = clothColor;
      ctx.fillRect(-6, -14, 12, 10);
      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.arc(0, -18, 6.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-4, -4); ctx.lineTo(-8, 0);
      ctx.moveTo(4, -4); ctx.lineTo(8, 0);
      ctx.stroke();

    } else if (p.state === 'CLIMBING_LADDER') {
      // Vertical ladder climbing animation
      const climbCycle = Math.sin(Date.now() * 0.016);
      ctx.fillStyle = clothColor;
      ctx.fillRect(-6, -24, 12, 14);

      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.arc(0, -30, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // Arms alternating on ladder rungs
      ctx.strokeStyle = skinTone;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-4, -20);
      ctx.lineTo(-9, -26 - climbCycle * 6);
      ctx.lineTo(-7, -34 - climbCycle * 6);
      ctx.moveTo(4, -20);
      ctx.lineTo(9, -20 + climbCycle * 6);
      ctx.lineTo(7, -14 + climbCycle * 6);
      ctx.stroke();

      // Legs alternating on ladder rungs
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-3, -10);
      ctx.lineTo(-7, -4 + climbCycle * 6);
      ctx.lineTo(-7, 2 + climbCycle * 6);
      ctx.moveTo(3, -10);
      ctx.lineTo(7, -4 - climbCycle * 6);
      ctx.lineTo(7, 2 - climbCycle * 6);
      ctx.stroke();
    }

    // Carried physical ladder strapped to player's back
    if (p.carryingLadderId) {
      ctx.save();
      ctx.fillStyle = '#64748b';
      ctx.fillRect(-14 * dir, -38, 4, 46);
      ctx.fillRect(-6 * dir, -38, 4, 46);
      ctx.fillStyle = '#94a3b8';
      for (let ry = -34; ry < 6; ry += 8) {
        ctx.fillRect(-14 * dir, ry, 12, 2);
      }
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6 * dir, -26);
      ctx.lineTo(6 * dir, -14);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // Overhead Status (Name, Health, Grab & Struggle Prompts)
    ctx.textAlign = 'center';

    if (p.grabbedByPlayerId) {
      // Grabbed Victim Struggle Meter
      const strugglePct = Math.min(100, Math.max(0, p.struggleMeter || 0));
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`⚠ GRABBED! MASH SPACE/W [${Math.floor(strugglePct)}%]`, p.x, p.y - 52);

      const sWidth = 42;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(p.x - sWidth / 2, p.y - 45, sWidth, 5);
      ctx.fillStyle = strugglePct >= 70 ? '#22c55e' : (strugglePct >= 35 ? '#eab308' : '#ef4444');
      ctx.fillRect(p.x - sWidth / 2, p.y - 45, sWidth * (strugglePct / 100), 5);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - sWidth / 2, p.y - 45, sWidth, 5);

    } else if (p.climbGrabbingId && isLocal) {
      // Attacker Holding Victim Prompt
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('⚡ HOLDING PRISONER [S: DRAG DOWN | RELEASE KEY: DROP]', p.x, p.y - 50);

    } else if (p.climbKickTimer && p.climbKickTimer > 0) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('💥 DOWNWARD KICK', p.x, p.y - 46);

    } else if (p.stunnedTimer > 0) {
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('💫 STUNNED', p.x, p.y - 42);
    } else {
      ctx.fillStyle = isLocal ? '#22d3ee' : '#cbd5e1';
      ctx.font = isLocal ? 'bold 12px monospace' : '10px monospace';
      ctx.fillText(p.name, p.x, p.y - 38);
    }

    // Health bar
    const barWidth = 26;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(p.x - barWidth / 2, p.y - 34, barWidth, 3);
    ctx.fillStyle = p.health > 40 ? '#22c55e' : '#ef4444';
    ctx.fillRect(p.x - barWidth / 2, p.y - 34, barWidth * (p.health / 100), 3);
  }

  private drawDeadHuman(ctx: CanvasRenderingContext2D, p: Player): void {
    const py = p.y;
    // Irregular blood puddle on floor/ledge
    ctx.fillStyle = 'rgba(127, 29, 29, 0.85)';
    ctx.beginPath();
    ctx.ellipse(p.x, py - 2, 24, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sprawled corpse flat on the concrete
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 12, py - 6, 20, 6); // Torso

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(p.x - 24, py - 5, 12, 4); // Legs

    ctx.fillStyle = '#b27b4c';
    ctx.beginPath();
    ctx.arc(p.x + 12, py - 5, 5, 0, Math.PI * 2); // Head
    ctx.fill();

    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`💀 ${p.name}`, p.x, py + 14);
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[]): void {
    for (const proj of projectiles) {
      ctx.save();
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawSniperShots(ctx: CanvasRenderingContext2D, shots: SniperShot[]): void {
    const now = Date.now();
    for (const s of shots) {
      const age = (now - s.timestamp) / 1000;
      const alpha = Math.max(0, 1 - age * 2.5);

      ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.fromX, s.fromY);
      ctx.lineTo(s.toX, s.toY);
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(s.toX, s.toY, 14 * (1 - age), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private updateAndDrawParticles(ctx: CanvasRenderingContext2D, dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHUD(ctx: CanvasRenderingContext2D, state: GameState, localPlayerId: string): void {
    const localPlayer = state.players.find(p => p.id === localPlayerId);

    const mins = Math.floor(state.matchTimer / 60);
    const secs = Math.floor(state.matchTimer % 60);
    const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    // Top Overseer Announcement Marquee Bar (offset to X=180 to keep upper-left escape hatch & overseer clear)
    const marqueeX = 180;
    const marqueeW = this.width - marqueeX - 40;
    ctx.fillStyle = 'rgba(11, 13, 17, 0.92)';
    ctx.fillRect(marqueeX, 48, marqueeW, 36);
    ctx.strokeStyle = state.phase === 'SIGNAL_ACTIVE' ? '#22c55e' : (state.phase === 'PURGE' ? '#ef4444' : '#334155');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(marqueeX, 48, marqueeW, 36);

    ctx.textAlign = 'center';
    ctx.fillStyle = state.phase === 'SIGNAL_ACTIVE' ? '#86efac' : (state.phase === 'PURGE' ? '#fca5a5' : '#f8fafc');
    ctx.font = 'bold 13px monospace';
    ctx.fillText(state.announcementText, marqueeX + marqueeW / 2, 71);

    // Top-Left Status Card (Clock & Prisoner Counts)
    const leftCardX = 180;
    const leftCardY = 92;
    const leftCardW = 280;
    const leftCardH = 50;
    ctx.fillStyle = 'rgba(11, 15, 25, 0.90)';
    ctx.fillRect(leftCardX, leftCardY, leftCardW, leftCardH);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(leftCardX, leftCardY, leftCardW, leftCardH);

    ctx.textAlign = 'left';
    if (state.phase === 'LOBBY') {
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(`LOBBY: ${state.players.length}/${state.maxPlayers || 10} PRISONERS`, leftCardX + 12, leftCardY + 22);

      const playerNames = state.players.map(p => p.name).join(', ');
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px monospace';
      ctx.fillText(`CONNECTED: ${playerNames || 'None'}`, leftCardX + 12, leftCardY + 39);
    } else {
      ctx.fillStyle = state.phase === 'PURGE' ? '#ef4444' : (state.matchTimer < 120 ? '#ef4444' : '#f8fafc');
      ctx.font = 'bold 18px monospace';
      const clockPrefix = state.phase === 'PURGE' ? '💀 PURGE: ' : '⏱️ ';
      ctx.fillText(`${clockPrefix}${timeFormatted}`, leftCardX + 12, leftCardY + 22);

      const livingInPit = state.players.filter(p => !p.hasEscaped && p.state !== 'DEAD').length;
      ctx.fillStyle = '#38bdf8';
      ctx.font = '11px monospace';
      ctx.fillText(`PRISONERS TRAPPED: ${livingInPit}`, leftCardX + 12, leftCardY + 39);
    }

    // Top-Right Player Card (Equipment & Game State)
    const rightCardW = 240;
    const rightCardX = this.width - rightCardW - 40;
    const rightCardY = 92;
    const rightCardH = 50;
    ctx.fillStyle = 'rgba(11, 15, 25, 0.90)';
    ctx.fillRect(rightCardX, rightCardY, rightCardW, rightCardH);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(rightCardX, rightCardY, rightCardW, rightCardH);

    ctx.textAlign = 'right';
    const textRightX = rightCardX + rightCardW - 14;

    if (localPlayer) {
      if (localPlayer.hasEscaped) {
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(`🏆 YOU ESCAPED AT ${localPlayer.escapeTime || '0:00'}!`, textRightX, rightCardY + 28);
      } else if (localPlayer.state === 'DEAD') {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(`💀 YOU PERISHED`, textRightX, rightCardY + 28);
      } else {
        const hasRope = state.rope.heldByPlayerId === localPlayer.id;
        const statusText = hasRope ? 'ROPE READY' : (localPlayer.rocks > 0 ? '🪨 ROCK' : 'BARE HANDS');

        if (state.phase === 'LOBBY' && state.lobbyCountdown > 0) {
          ctx.fillStyle = '#22c55e';
          ctx.font = 'bold 13px monospace';
          ctx.fillText(`STARTING IN: ${state.lobbyCountdown}s`, textRightX, rightCardY + 20);

          ctx.fillStyle = '#22d3ee';
          ctx.font = 'bold 11px monospace';
          ctx.fillText(`EQUIPPED: ${statusText}`, textRightX, rightCardY + 38);
        } else {
          ctx.fillStyle = '#22d3ee';
          ctx.font = 'bold 13px monospace';
          ctx.fillText(`EQUIPPED: ${statusText}`, textRightX, rightCardY + 20);

          ctx.fillStyle = '#94a3b8';
          ctx.font = '11px monospace';
          const subText = state.phase === 'LOBBY' ? 'READY IN LOBBY' : `SABOTAGES: ${localPlayer.sabotages}`;
          ctx.fillText(subText, textRightX, rightCardY + 38);
        }
      }
    }

    // Surface Survivors Roster (Bottom Left)
    const escaped = state.players.filter(p => p.hasEscaped);
    if (escaped.length > 0) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`SURVIVED TO SURFACE (${escaped.length}):`, 45, this.height - 25);
      const names = escaped.map(e => `${e.name} (${e.escapeTime})`).join(', ');
      ctx.fillStyle = '#86efac';
      ctx.font = '10px monospace';
      ctx.fillText(names, 45, this.height - 10);
    }
  }

  private drawMatchOverScreen(ctx: CanvasRenderingContext2D, state: GameState): void {
    ctx.fillStyle = 'rgba(10, 12, 16, 0.94)';
    ctx.fillRect(150, 120, this.width - 300, 460);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(150, 120, this.width - 300, 460);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('10-MINUTE SURVIVAL MATCH OVER', this.width / 2, 170);

    const survivors = state.players.filter(p => p.hasEscaped);
    const dead = state.players.filter(p => !p.hasEscaped);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`🏆 SURVIVORS (${survivors.length})`, 200, 220);
    survivors.forEach((p, idx) => {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '13px monospace';
      ctx.fillText(`• ${p.name} - Escaped at ${p.escapeTime}`, 200, 250 + idx * 24);
    });

    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`💀 CASUALTIES (${dead.length})`, 550, 220);
    dead.forEach((p, idx) => {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px monospace';
      ctx.fillText(`• ${p.name} - Purged in cell`, 550, 250 + idx * 24);
    });
  }

  // =========================================================================
  // 10-ROOM AUTHORITATIVE COOPERATIVE CAMPAIGN RENDERER
  // =========================================================================
  public renderCampaign(campaign: ClientCampaignSync, localPlayerId: string): void {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const ctx = this.ctx;
    const roomW = campaign.roomWidth || 1600;
    const roomH = campaign.roomHeight || 640;

    // 1. Camera Tracking
    const localPlayer = campaign.players.find(p => p.id === localPlayerId);
    if (localPlayer) {
      this.targetCameraX = localPlayer.x - this.width / 2;
      this.targetCameraY = localPlayer.y - this.height * 0.55;
    } else {
      this.targetCameraX = 0;
      this.targetCameraY = Math.max(0, roomH - this.height);
    }

    const maxCamX = Math.max(0, roomW - this.width);
    const maxCamY = Math.max(0, roomH - this.height);
    this.targetCameraX = Math.max(0, Math.min(maxCamX, this.targetCameraX));
    this.targetCameraY = Math.max(0, Math.min(maxCamY, this.targetCameraY));

    // Smooth lerp
    this.cameraX += (this.targetCameraX - this.cameraX) * 0.1;
    this.cameraY += (this.targetCameraY - this.cameraY) * 0.1;
    this.cameraX = Math.max(0, Math.min(maxCamX, this.cameraX));
    this.cameraY = Math.max(0, Math.min(maxCamY, this.cameraY));

    // Clear canvas
    ctx.fillStyle = '#06070a';
    ctx.fillRect(0, 0, this.width, this.height);

    // ── WORLD TRANSFORM ─────────────────────────────────────────
    ctx.save();
    ctx.translate(-Math.round(this.cameraX), -Math.round(this.cameraY));

    if (campaign.roomId === 1) {
      Room1Renderer.getInstance().render(ctx, campaign, now);
    } else {
    // A. Room Background Paneling
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, roomW, roomH);

    // Grid Seams
    ctx.strokeStyle = '#101726';
    ctx.lineWidth = 1;
    for (let x = 0; x <= roomW; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, roomH); ctx.stroke();
    }
    for (let y = 0; y <= roomH; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(roomW, y); ctx.stroke();
    }

    // B. Safe Arrival Zones
    for (const sz of campaign.safeZones) {
      ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
      ctx.fillRect(sz.rect.x, sz.rect.y, sz.rect.width, sz.rect.height);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sz.rect.x, sz.rect.y, sz.rect.width, sz.rect.height);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SAFE ARRIVAL ZONE', sz.rect.x + sz.rect.width / 2, sz.rect.y + 14);
    }

    // C. Platforms and Solid Walls
    for (const w of campaign.walls) {
      if (w.isPlatform) {
        // High-tech platform
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(w.x, w.y, w.width, w.height);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(w.x, w.y, w.width, 3);

        // Yellow edge safety caps
        const capW = Math.min(12, w.width / 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(w.x, w.y + 3, capW, Math.max(0, w.height - 3));
        ctx.fillRect(w.x + w.width - capW, w.y + 3, capW, Math.max(0, w.height - 3));
      } else {
        // Reinforced solid wall
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(w.x, w.y, w.width, w.height);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.width - 1, w.height - 1);

        // Steel rivets
        ctx.fillStyle = '#475569';
        for (let rx = w.x + 8; rx < w.x + w.width; rx += 32) {
          ctx.beginPath(); ctx.arc(rx, w.y + 4, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // D. Doors & Airlocks
    for (const door of campaign.doors) {
      const isExit = door.id.includes('exit') || door.id.includes('hatch');
      let isUnlocked = true;

      if (campaign.roomId === 8 && door.id === 'exit_door') {
        isUnlocked = campaign.puzzleState.deployedMechanisms.includes('door_unlocked');
      } else if (campaign.roomId === 10 && (door.id === 'sealed_hatch' || door.targetRoomId === 'Surface')) {
        isUnlocked = campaign.puzzleState.cutHatches.includes('sealed_hatch');
      }

      if (isExit) {
        if (isUnlocked) {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
          ctx.fillRect(door.rect.x, door.rect.y, door.rect.width, door.rect.height);
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(door.rect.x, door.rect.y, door.rect.width, door.rect.height);

          ctx.fillStyle = '#4ade80';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          const exitText = door.targetRoomId === 'Surface' ? 'SURFACE EXIT' : `DOOR → R${door.targetRoomId || ''}`;
          ctx.fillText(exitText, door.rect.x + door.rect.width / 2, door.rect.y - 8);
        } else {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
          ctx.fillRect(door.rect.x, door.rect.y, door.rect.width, door.rect.height);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(door.rect.x, door.rect.y, door.rect.width, door.rect.height);

          ctx.fillStyle = '#f87171';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('🔒 LOCKED', door.rect.x + door.rect.width / 2, door.rect.y - 8);
        }
      } else {
        // Entry door / return door
        ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.fillRect(door.rect.x, door.rect.y, door.rect.width, door.rect.height);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.strokeRect(door.rect.x, door.rect.y, door.rect.width, door.rect.height);

        ctx.fillStyle = '#7dd3fc';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        const label = campaign.roomId === 10 ? '← BACKTRACK R9' : 'ENTRY AIRLOCK';
        ctx.fillText(label, door.rect.x + door.rect.width / 2, door.rect.y - 6);
      }
    }

    // E. Ladders & Climbables
    for (const ladder of campaign.ladders) {
      if (!ladder.isPlaced) continue;

      if (ladder.id === 'cell_rope') {
        // Deployed climbable rope
        ctx.strokeStyle = '#ca8a04';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(ladder.x, ladder.y);
        ctx.lineTo(ladder.x, ladder.y + ladder.height);
        ctx.stroke();

        // Knots
        ctx.fillStyle = '#eab308';
        for (let ky = ladder.y + 16; ky < ladder.y + ladder.height; ky += 24) {
          ctx.beginPath(); ctx.arc(ladder.x, ky, 3.5, 0, Math.PI * 2); ctx.fill();
        }

        // Anchor bolt at top
        ctx.fillStyle = '#facc15';
        ctx.fillRect(ladder.x - 6, ladder.y - 4, 12, 8);
      } else {
        // Industrial ladder
        const railX1 = ladder.x - ladder.width / 2;
        const railX2 = ladder.x + ladder.width / 2;
        const isEmergency = ladder.id === 'emergency_ladder';

        ctx.strokeStyle = isEmergency ? '#eab308' : '#64748b';
        ctx.lineWidth = 3;

        // Side rails
        ctx.beginPath();
        ctx.moveTo(railX1, ladder.y); ctx.lineTo(railX1, ladder.y + ladder.height);
        ctx.moveTo(railX2, ladder.y); ctx.lineTo(railX2, ladder.y + ladder.height);
        ctx.stroke();

        // Rungs
        ctx.strokeStyle = isEmergency ? '#fde047' : '#94a3b8';
        ctx.lineWidth = 2;
        for (let ry = ladder.y + 12; ry < ladder.y + ladder.height; ry += 16) {
          ctx.beginPath();
          ctx.moveTo(railX1, ry);
          ctx.lineTo(railX2, ry);
          ctx.stroke();
        }

        if (isEmergency) {
          ctx.fillStyle = '#fde047';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('EMERGENCY LADDER', ladder.x, ladder.y - 6);
        }
      }
    }

    // F. Room-Specific Dynamic Mechanics
    // Room 1: Boost Zone & Anchor
    if (campaign.roomId === 1) {
      // Boost zone [8, 3, 14, 5] (px: x 256..448, y 480..544)
      ctx.fillStyle = 'rgba(34, 211, 238, 0.08)';
      ctx.fillRect(256, 480, 192, 64);
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(256, 480, 192, 64);
      ctx.setLineDash([]);

      ctx.fillStyle = '#22d3ee';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▲ CO-OP BOOST ZONE [W / SPACE] ▲', 352, 516);

      // Rope Anchor at [31, 8] (x: 992, y: 384)
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.arc(992, 384, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (!campaign.puzzleState.deployedMechanisms.includes('rope_anchor')) {
        ctx.fillStyle = '#fef08a';
        ctx.font = 'bold 10px monospace';
        ctx.fillText('⚓ ROPE ANCHOR', 992, 368);
      }
    }

    // Room 2: Movable Crate & Reset Lever
    if (campaign.roomId === 2) {
      // Reset lever at x=384, y=544
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(380, 524, 8, 20);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('RESET', 384, 516);
    }

    // Room 3: Sleeping Guard at x=768, y=544
    if (campaign.roomId === 3) {
      // Guard body
      ctx.fillStyle = '#475569';
      ctx.fillRect(754, 520, 28, 24);
      ctx.fillStyle = '#d97706';
      ctx.beginPath(); ctx.arc(768, 514, 8, 0, Math.PI * 2); ctx.fill();

      // Zzz animation
      const zOffset = (Date.now() % 2000) / 2000;
      ctx.fillStyle = 'rgba(56, 189, 248, ' + (1 - zOffset) + ')';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('Zzz...', 778 + zOffset * 10, 500 - zOffset * 25);
    }

    // Room 4: Searchlight Sweep Beam
    if (campaign.roomId === 4) {
      const sX = campaign.puzzleState.searchlightX || 160;
      const grad = ctx.createRadialGradient(sX, 0, 20, sX, 544, 250);
      grad.addColorStop(0, 'rgba(253, 224, 71, 0.45)');
      grad.addColorStop(1, 'rgba(253, 224, 71, 0.0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sX - 10, 0);
      ctx.lineTo(sX + 10, 0);
      ctx.lineTo(sX + 80, 544);
      ctx.lineTo(sX - 80, 544);
      ctx.closePath();
      ctx.fill();

      // Searchlight source projector at ceiling
      ctx.fillStyle = '#fde047';
      ctx.beginPath(); ctx.arc(sX, 10, 12, 0, Math.PI * 2); ctx.fill();
    }

    // Room 5: Secret Panel at x=800..864
    if (campaign.roomId === 5) {
      const opened = campaign.puzzleState.deployedMechanisms.includes('movable_panel');
      ctx.fillStyle = opened ? '#0f172a' : '#334155';
      ctx.fillRect(800, 480, 64, 64);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.strokeRect(800, 480, 64, 64);

      ctx.fillStyle = opened ? '#22c55e' : '#cbd5e1';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(opened ? 'OPEN' : 'PANEL', 832, 516);
    }

    // Room 7: Guard Patrol at guardX
    if (campaign.roomId === 7) {
      const gX = campaign.puzzleState.guardX || 576;
      // Flashlight cone
      ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
      ctx.beginPath();
      ctx.moveTo(gX, 524);
      ctx.lineTo(gX + 100, 500);
      ctx.lineTo(gX + 100, 548);
      ctx.closePath();
      ctx.fill();

      // Guard figure
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(gX - 10, 512, 20, 32);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GUARD', gX, 504);
    }

    // Room 8: Switch A & Switch B
    if (campaign.roomId === 8) {
      const isA = campaign.puzzleState.activatedSwitches.includes('switch_a');
      const isB = campaign.puzzleState.activatedSwitches.includes('switch_b');
      const tA = campaign.puzzleState.switchTimers?.switch_a || 0;
      const tB = campaign.puzzleState.switchTimers?.switch_b || 0;

      // Switch A (x=384, y=544)
      ctx.fillStyle = isA ? '#16a34a' : '#7f1d1d';
      ctx.fillRect(372, 512, 24, 32);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(isA ? `A (${tA}s)` : 'A', 384, 504);

      // Switch B (x=1152, y=544)
      ctx.fillStyle = isB ? '#16a34a' : '#7f1d1d';
      ctx.fillRect(1140, 512, 24, 32);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(isB ? `B (${tB}s)` : 'B', 1152, 504);
    }

    // Room 9: Key Niche & Box C
    if (campaign.roomId === 9) {
      // Key Niche Pedestal at x=256, y=544
      ctx.fillStyle = '#475569';
      ctx.fillRect(244, 520, 24, 24);
      ctx.fillStyle = '#f59e0b';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NICHE', 256, 514);

      // Box C at x=1120..1216, y=480..544
      const unlocked = campaign.puzzleState.unlockedContainers.includes('box_c');
      ctx.fillStyle = unlocked ? '#1e293b' : '#334155';
      ctx.fillRect(1120, 480, 96, 64);
      ctx.strokeStyle = unlocked ? '#22c55e' : '#eab308';
      ctx.lineWidth = 2;
      ctx.strokeRect(1120, 480, 96, 64);

      ctx.fillStyle = unlocked ? '#4ade80' : '#fde047';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(unlocked ? 'BOX C (UNLOCKED)' : '🔒 BOX C (LOCKED)', 1168, 516);
    }

    // Room 10: Platform C & Sealed Hatch
    if (campaign.roomId === 10) {
      const isCut = campaign.puzzleState.cutHatches.includes('sealed_hatch');
      // Sealed hatch at x: 1216..1312, y: 96..192
      if (isCut) {
        // Glorious Surface Portal
        const pGrad = ctx.createRadialGradient(1264, 144, 10, 1264, 144, 120);
        pGrad.addColorStop(0, '#ffffff');
        pGrad.addColorStop(0.3, '#38bdf8');
        pGrad.addColorStop(0.7, '#0284c7');
        pGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = pGrad;
        ctx.fillRect(1180, 60, 168, 168);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('☀️ SURFACE ESCAPE BREACH ☀️', 1264, 80);
      } else {
        // Reinforced Hatch with Heavy Rebar
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(1216, 96, 96, 96);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.strokeRect(1216, 96, 96, 96);

        // Steel rebar grid
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 4;
        for (let bx = 1232; bx < 1312; bx += 24) {
          ctx.beginPath(); ctx.moveTo(bx, 96); ctx.lineTo(bx, 192); ctx.stroke();
        }
        for (let by = 112; by < 192; by += 24) {
          ctx.beginPath(); ctx.moveTo(1216, by); ctx.lineTo(1312, by); ctx.stroke();
        }

        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('REINFORCED STEEL HATCH', 1264, 84);
      }
    }
    }

    // G. Ground Items
    for (const item of campaign.groundItems) {
      const bob = Math.sin(Date.now() * 0.006) * 3;
      const iy = item.y - 12 + bob;

      // Glow halo
      ctx.fillStyle = 'rgba(234, 179, 8, 0.25)';
      ctx.beginPath(); ctx.arc(item.x, iy, 18, 0, Math.PI * 2); ctx.fill();

      // Icon & Label
      let icon = '📦';
      let label = item.type.toUpperCase();
      if (item.type === 'cutting_tool') { icon = '✂️'; label = 'CUTTING TOOL'; }
      else if (item.type === 'key') { icon = '🔑'; label = 'BRASS KEY'; }
      else if (item.type === 'rope') { icon = '🪢'; label = 'ROPE'; }

      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(icon, item.x, iy + 6);

      // Pill label
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(item.x - 40, iy - 22, 80, 16);
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1;
      ctx.strokeRect(item.x - 40, iy - 22, 80, 16);

      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(label, item.x, iy - 10);
    }

    // H. Living Human Prisoners
    for (const p of campaign.players) {
      if (p.state !== 'DEAD' && !p.hasEscaped) {
        const isLocal = p.id === localPlayerId;
        CharacterRenderer.getInstance().drawPlayer(ctx, p, isLocal, now);

        // Draw carried item icon floating above head
        if (isLocal && campaign.carriedItem) {
          let cIcon = '📦';
          if (campaign.carriedItem.type === 'cutting_tool') cIcon = '✂️';
          else if (campaign.carriedItem.type === 'key') cIcon = '🔑';
          else if (campaign.carriedItem.type === 'rope') cIcon = '🪢';

          ctx.font = '14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(cIcon, p.x, p.y - 48);
        }
      }
    }

    // Particles
    this.updateAndDrawParticles(ctx, dt);

    ctx.restore();
    // ── END WORLD TRANSFORM ─────────────────────────────────────

    // Atmospheric cinematic vignette
    LightingSystem.getInstance().drawCinematicVignette(ctx, this.width, this.height);

    // 2. TACTICAL HUD (VIEWPORT SPACE)
    const ROOM_OBJECTIVES: Record<number, string> = {
      1: "Boost teammate to upper walkway [W/SPACE], lower rope [E] for team.",
      2: "Traverse movable crate and stepping platforms to reach upper exit.",
      3: "Sneak past sleeping guard or climb overhead bypass pipe.",
      4: "Evade sweeping searchlight by taking shelter behind cover blocks.",
      5: "Inspect suspicious wall panel [E] to reveal hidden equipment.",
      6: "Scale the vertical conduit and ladder to the upper catwalk.",
      7: "Descend ladder and evade patrolling guard to reach ground exit.",
      8: "Coordinate Switch A & B within 12s to unlock blast door.",
      9: "Find brass key at niche to unlock Box C and obtain cutting tool.",
      10: "Climb steps, deploy emergency ladder, backtrack for tool, cut rebar, and ESCAPE!"
    };

    // Top-Left Chamber Panel
    ctx.fillStyle = 'rgba(11, 15, 25, 0.88)';
    ctx.fillRect(16, 14, 460, 64);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(16, 14, 460, 64);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`ROOM ${campaign.roomId} / 10 — ${campaign.roomName.toUpperCase()}`, 28, 36);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '11px monospace';
    ctx.fillText(ROOM_OBJECTIVES[campaign.roomId] || 'Traverse the chamber cooperatively.', 28, 58);

    // Top-Right Inventory & Team Panel
    ctx.fillStyle = 'rgba(11, 15, 25, 0.88)';
    ctx.fillRect(this.width - 340, 14, 324, 64);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(this.width - 340, 14, 324, 64);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    let invText = 'Empty (Max 1 Item)';
    if (campaign.carriedItem) {
      if (campaign.carriedItem.type === 'cutting_tool') invText = '✂️ Cutting Tool';
      else if (campaign.carriedItem.type === 'key') invText = '🔑 Brass Key';
      else if (campaign.carriedItem.type === 'rope') invText = '🪢 Rope';
    }
    ctx.fillText(`HELD ITEM: ${invText}`, this.width - 326, 36);

    // Team Roster
    const rosterStr = campaign.teamRoster.map(m => `${m.name} (R${m.roomId})`).join('  |  ');
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(rosterStr || 'Solo Prisoner', this.width - 326, 58);

    // Center-Bottom Interaction Prompt
    if (campaign.interactionPrompt) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      const pW = 380;
      const pH = 38;
      const pX = this.width / 2 - pW / 2;
      const pY = this.height - 52;
      ctx.fillRect(pX, pY, pW, pH);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.strokeRect(pX, pY, pW, pH);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(campaign.interactionPrompt, this.width / 2, pY + 24);
    }

    // Surface Escape Celebration Screen
    if (campaign.puzzleState.campaignComplete || localPlayer?.hasEscaped) {
      ctx.fillStyle = 'rgba(8, 12, 20, 0.95)';
      ctx.fillRect(100, 100, this.width - 200, 500);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.strokeRect(100, 100, this.width - 200, 500);

      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PRISON ESCAPE SUCCESSFUL!', this.width / 2, 180);

      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.fillText('You cut through the reinforced steel rebar and breached the surface!', this.width / 2, 230);
      ctx.fillText('All 10 chambers conquered.', this.width / 2, 260);

      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('FREEDOM ACHIEVED', this.width / 2, 330);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px monospace';
      ctx.fillText('Thank you for playing The Pit Co-op Campaign.', this.width / 2, 420);
    }
  }
}
