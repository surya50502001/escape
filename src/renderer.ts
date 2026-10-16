import { GameState, Player, Projectile, SniperShot, Rope, HatchZone, FLOOR_Y, V_PIPE_X, V_PIPE_TOP_Y, H_PIPE_Y, H_PIPE_EXIT_X } from '../server/types.js';

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

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.width = canvas.width;
    this.height = canvas.height;
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

    // 1. Draw 2D Side-View Concrete & Rock Chamber
    this.drawChamberEnvironment(ctx, state);

    // 2. Draw Continuous Traversal Pipes (Right Wall Vertical -> Ceiling Horizontal)
    this.drawIndustrialPipes(ctx);

    // 3. Draw Escape Hatch & Overseer at Upper-Left
    this.drawUpperLeftHatchAndOverseer(ctx, state);

    // 4. Draw Particles (impact dust, blood, sparks)
    this.updateAndDrawParticles(ctx, dt);

    // 5. Draw The Single Rope (on floor, thrown, or attached)
    this.drawRope(ctx, state.rope, state.players);

    // 6. Draw Thrown Rocks
    this.drawProjectiles(ctx, state.projectiles);

    // 7. Draw Dead Prisoners (on floor)
    for (const p of state.players) {
      if (p.state === 'DEAD') {
        this.drawDeadHuman(ctx, p);
      }
    }

    // 8. Draw Living Human Prisoners
    for (const p of state.players) {
      if (p.state !== 'DEAD' && !p.hasEscaped) {
        const isLocal = p.id === localPlayerId;
        this.drawHumanPrisoner(ctx, p, isLocal);
      }
    }

    // 9. Draw Sniper Shots
    this.drawSniperShots(ctx, state.recentShots);

    // 10. Draw Clean Tactical HUD & Timers
    this.drawHUD(ctx, state, localPlayerId);

    // 11. Match Over Screen if completed
    if (state.phase === 'MATCH_OVER') {
      this.drawMatchOverScreen(ctx, state);
    }
  }

  // ==========================================
  // 1. 2D SIDE-VIEW INDUSTRIAL CHAMBER
  // ==========================================
  private drawChamberEnvironment(ctx: CanvasRenderingContext2D, state: GameState): void {
    // Deep underground dark stone / bedrock back wall
    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(0, 0, this.width, this.height);

    // Concrete slab panels on back wall with grime
    ctx.strokeStyle = '#151921';
    ctx.lineWidth = 2;
    for (let x = 0; x < this.width; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, FLOOR_Y);
      ctx.stroke();
    }
    for (let y = 0; y < FLOOR_Y; y += 90) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    // Water seepage and rust stains dripping down walls
    ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
    ctx.fillRect(350, 0, 40, FLOOR_Y);
    ctx.fillRect(720, 0, 30, FLOOR_Y);

    // Vertical Iron Structural Beams along walls
    ctx.fillStyle = '#1e2430';
    ctx.fillRect(0, 0, 30, FLOOR_Y); // Left wall
    ctx.fillRect(this.width - 30, 0, 30, FLOOR_Y); // Right wall

    // Rivets on structural pillars
    ctx.fillStyle = '#334155';
    for (let y = 40; y < FLOOR_Y; y += 50) {
      ctx.beginPath();
      ctx.arc(15, y, 3, 0, Math.PI * 2);
      ctx.arc(this.width - 15, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Heavy Dirty Concrete Floor
    ctx.fillStyle = '#1c1f26';
    ctx.fillRect(0, FLOOR_Y, this.width, this.height - FLOOR_Y);

    // Concrete floor top curb with grunge
    ctx.fillStyle = '#2d3340';
    ctx.fillRect(0, FLOOR_Y - 4, this.width, 5);

    // Cracks in the concrete floor
    ctx.strokeStyle = '#0d0f14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(220, FLOOR_Y); ctx.lineTo(245, FLOOR_Y + 15); ctx.lineTo(260, FLOOR_Y + 8);
    ctx.moveTo(610, FLOOR_Y); ctx.lineTo(630, FLOOR_Y + 22);
    ctx.stroke();

    // Dark ambient shadow gradient from top and bottom
    const shadowGrad = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    shadowGrad.addColorStop(0, 'rgba(0,0,0,0.75)');
    shadowGrad.addColorStop(0.3, 'rgba(0,0,0,0.15)');
    shadowGrad.addColorStop(0.85, 'rgba(0,0,0,0.15)');
    shadowGrad.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = shadowGrad;
    ctx.fillRect(0, 0, this.width, FLOOR_Y);
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
    const hatch = state.hatch;

    ctx.save();

    // Dark escape duct / hatch tunnel in upper-left
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, hatch.y - 15, hatch.width + 45, hatch.height + 25);

    // Reinforced heavy steel hatch door frame
    ctx.strokeStyle = isOpen ? '#22c55e' : '#7f1d1d';
    ctx.lineWidth = 6;
    ctx.strokeRect(hatch.x, hatch.y, hatch.width, hatch.height);

    // Industrial Spotlight above the hatch
    ctx.fillStyle = '#334155';
    ctx.fillRect(hatch.x + hatch.width - 10, hatch.y - 16, 18, 12);

    // Harsh volumetric cone of light casting across upper chamber
    if (isOpen) {
      const cone = ctx.createRadialGradient(
        hatch.x + hatch.width, hatch.y + 10, 10,
        hatch.x + hatch.width + 300, hatch.y + 140, 450
      );
      cone.addColorStop(0, 'rgba(34, 197, 94, 0.4)');
      cone.addColorStop(0.5, 'rgba(34, 197, 94, 0.12)');
      cone.addColorStop(1, 'rgba(34, 197, 94, 0.0)');

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

    // Dark shadowed human torso & arms
    ctx.fillStyle = '#0a0d14';
    // Body / Trenchcoat
    ctx.fillRect(overseerX - 10, overseerY - 26, 20, 36);
    // Head / Tactical Hood
    ctx.beginPath();
    ctx.arc(overseerX, overseerY - 33, 9, 0, Math.PI * 2);
    ctx.fill();

    // Sniper rifle resting over the ledge aiming into the pit
    ctx.strokeStyle = '#020617';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(overseerX - 4, overseerY - 14);
    ctx.lineTo(overseerX + 38, overseerY + 4);
    ctx.stroke();

    // Sniper Scope Optic with red glint
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(overseerX + 8, overseerY - 10, 14, 5);
    ctx.fillStyle = isOpen ? '#ef4444' : '#64748b';
    ctx.beginPath();
    ctx.arc(overseerX + 22, overseerY - 8, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = isOpen ? '#86efac' : '#94a3b8';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ESCAPE HATCH', hatch.x + hatch.width / 2, hatch.y + hatch.height + 18);

    ctx.restore();
  }

  // ==========================================
  // 4. THE ROPE (ON FLOOR / CARRIED / ATTACHED)
  // ==========================================
  private drawRope(ctx: CanvasRenderingContext2D, rope: Rope, players: Player[]): void {
    ctx.save();

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

      // Action hint prompt
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('[E] GRAB ROPE', rope.x, FLOOR_Y - 22);
    } else if (rope.state === 'HELD') {
      const holder = players.find(p => p.id === rope.heldByPlayerId);
      if (holder) {
        // Coiled rope in player's hands with trailing cord
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(holder.x + (holder.facing === 'RIGHT' ? 10 : -10), holder.y - 18);
        ctx.lineTo(holder.x, holder.y - 6);
        ctx.stroke();

        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('HOLDING ROPE [CLICK TO THROW]', holder.x, holder.y - 42);
      }
    } else if (rope.state === 'THROWN') {
      // Flying rope projectile with lasso loop
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(rope.x, rope.y, 8, 0, Math.PI * 2);
      ctx.stroke();

      // Trailing rope segments
      const holder = players.find(p => p.id === rope.heldByPlayerId);
      if (holder) {
        ctx.strokeStyle = 'rgba(217, 119, 6, 0.7)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(holder.x, holder.y - 18);
        ctx.quadraticCurveTo((holder.x + rope.x) / 2, Math.max(holder.y, rope.y) + 30, rope.x, rope.y);
        ctx.stroke();
      }
    } else if (rope.state === 'ATTACHED') {
      const holder = players.find(p => p.id === rope.heldByPlayerId);
      const target = players.find(p => p.id === rope.attachedPlayerId);

      if (holder && target) {
        // Taut rope connecting holder on ground to victim hanging/climbing
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(holder.x, holder.y - 18);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();

        // Lasso loop wrapped around target's waist/legs
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(target.x, target.y, 10, 6, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('⚡ ROPE ATTACHED! [SPACE TO YANK OFF PIPE]', holder.x, holder.y - 42);
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

      // Facing the vertical pipe (looking right toward x = 920)
      // Torso
      ctx.fillStyle = clothColor;
      ctx.fillRect(-6, -26, 12, 16);

      // Legs gripping the pipe
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      // Left leg bent gripping pipe
      ctx.moveTo(-3, -10);
      ctx.lineTo(4, -6 + climbCycle * 5);
      ctx.lineTo(6, -2 + climbCycle * 5);
      // Right leg gripping pipe
      ctx.moveTo(3, -10);
      ctx.lineTo(4, -6 - climbCycle * 5);
      ctx.lineTo(6, -2 - climbCycle * 5);
      ctx.stroke();

      // Head looking up
      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.arc(0, -32, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // Arms reaching up gripping vertical pipe
      ctx.strokeStyle = skinTone;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      // Upper arm reaching up
      ctx.moveTo(0, -24);
      ctx.lineTo(6, -28 - climbCycle * 6);
      ctx.lineTo(6, -34 - climbCycle * 6);
      // Lower arm pulling
      ctx.moveTo(0, -24);
      ctx.lineTo(6, -22 + climbCycle * 6);
      ctx.lineTo(6, -18 + climbCycle * 6);
      ctx.stroke();

    } else if (p.state === 'HANGING_H_PIPE') {
      // --- HORIZONTAL CEILING PIPE BRACHIATION ---
      const handCycle = Math.sin(Date.now() * 0.014);

      // Arms reaching STRAIGHT UP gripping pipe at y = H_PIPE_Y
      ctx.strokeStyle = skinTone;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      // Left arm grasping ceiling pipe
      ctx.moveTo(-4, -14);
      ctx.lineTo(-6 - handCycle * 5, -24);
      ctx.lineTo(-7 - handCycle * 5, -28);
      // Right arm grasping ceiling pipe
      ctx.moveTo(4, -14);
      ctx.lineTo(6 + handCycle * 5, -24);
      ctx.lineTo(7 + handCycle * 5, -28);
      ctx.stroke();

      // Torso hanging suspended beneath hands
      ctx.fillStyle = clothColor;
      ctx.fillRect(-5, -14, 10, 16);

      // Head hanging between shoulders
      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.arc(0, -18, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // Legs dangling in mid-air
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
    }

    ctx.restore();

    // Overhead Status (Name & Health)
    ctx.textAlign = 'center';
    if (p.stunnedTimer > 0) {
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
    // Irregular blood puddle on floor
    ctx.fillStyle = 'rgba(127, 29, 29, 0.85)';
    ctx.beginPath();
    ctx.ellipse(p.x, FLOOR_Y - 2, 24, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sprawled corpse flat on the concrete
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 12, FLOOR_Y - 6, 20, 6); // Torso

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(p.x - 24, FLOOR_Y - 5, 12, 4); // Legs

    ctx.fillStyle = '#b27b4c';
    ctx.beginPath();
    ctx.arc(p.x + 12, FLOOR_Y - 5, 5, 0, Math.PI * 2); // Head
    ctx.fill();

    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`💀 ${p.name}`, p.x, FLOOR_Y + 14);
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

    // Top Overseer Announcement Marquee Bar
    ctx.fillStyle = 'rgba(11, 13, 17, 0.92)';
    ctx.fillRect(40, 48, this.width - 80, 36);
    ctx.strokeStyle = state.phase === 'SIGNAL_ACTIVE' ? '#22c55e' : '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(40, 48, this.width - 80, 36);

    ctx.textAlign = 'center';
    ctx.fillStyle = state.phase === 'SIGNAL_ACTIVE' ? '#86efac' : '#f8fafc';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(state.announcementText, this.width / 2, 71);

    // 10-Minute Clock & Remaining Prisoners (Top Left)
    ctx.textAlign = 'left';
    ctx.fillStyle = state.matchTimer < 120 ? '#ef4444' : '#f8fafc';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(`⏱️ ${timeFormatted}`, 45, 115);

    const livingInPit = state.players.filter(p => !p.hasEscaped && p.state !== 'DEAD').length;
    ctx.fillStyle = '#38bdf8';
    ctx.font = '12px monospace';
    ctx.fillText(`PRISONERS TRAPPED: ${livingInPit}`, 45, 134);

    // Local Player Status (Top Right)
    ctx.textAlign = 'right';
    if (localPlayer) {
      if (localPlayer.hasEscaped) {
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(`🏆 YOU ESCAPED AT ${localPlayer.escapeTime || '0:00'}!`, this.width - 45, 115);
      } else if (localPlayer.state === 'DEAD') {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(`💀 YOU PERISHED`, this.width - 45, 115);
      } else {
        ctx.fillStyle = '#22d3ee';
        ctx.font = 'bold 13px monospace';
        const hasRope = state.rope.heldByPlayerId === localPlayer.id;
        const statusText = hasRope ? 'ROPE READY' : (localPlayer.rocks > 0 ? '🪨 ROCK' : 'BARE HANDS');
        ctx.fillText(`EQUIPPED: ${statusText}`, this.width - 45, 115);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px monospace';
        ctx.fillText(`SABOTAGES: ${localPlayer.sabotages}`, this.width - 45, 134);
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
}
