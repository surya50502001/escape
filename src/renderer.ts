import { GameState, Player, Projectile, SniperShot, LadderZone } from '../server/types.js';

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
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 180;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 2 + Math.random() * 3,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9
      });
    }
  }

  public render(state: GameState, localPlayerId: string): void {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const ctx = this.ctx;

    // 1. Draw Cell Background
    this.drawDungeonFloor(ctx);

    // 2. Draw Ladder & Hatch
    const isHatchOpen = state.phase === 'SIGNAL_ACTIVE';
    this.drawLadderAndHatch(ctx, state.ladder, isHatchOpen);

    // 3. Draw Particles
    this.updateAndDrawParticles(ctx, dt);

    // 4. Draw Projectiles
    this.drawProjectiles(ctx, state.projectiles);

    // 5. Draw Dead Players (on floor)
    for (const p of state.players) {
      if (p.state === 'DEAD') {
        this.drawDeadPlayer(ctx, p);
      }
    }

    // 6. Draw Living Players in Pit (skip escaped players who left the cell)
    for (const p of state.players) {
      if (p.state !== 'DEAD' && !p.hasEscaped) {
        const isLocal = p.id === localPlayerId;
        this.drawPlayer(ctx, p, isLocal);
      }
    }

    // 7. Draw Sniper Laser Beams
    this.drawSniperShots(ctx, state.recentShots);

    // 8. Draw Anonymous Overseer at Hatch
    this.drawOverseer(ctx, state.ladder, isHatchOpen);

    // 9. Draw HUD & Roster
    this.drawHUD(ctx, state, localPlayerId);

    // 10. Match Over Screen
    if (state.phase === 'MATCH_OVER') {
      this.drawMatchOverScreen(ctx, state);
    }
  }

  private drawDungeonFloor(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#101216';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = '#1a1d24';
    ctx.lineWidth = 1.5;
    const tileSize = 50;
    for (let x = 0; x < this.width; x += tileSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = 0; y < this.height; y += tileSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    // Heavy iron perimeter border
    ctx.strokeStyle = '#272b35';
    ctx.lineWidth = 20;
    ctx.strokeRect(10, 10, this.width - 20, this.height - 20);

    // Ambient darkness vignette
    const grad = ctx.createRadialGradient(this.width / 2, this.height / 2, 200, this.width / 2, this.height / 2, 550);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawLadderAndHatch(ctx: CanvasRenderingContext2D, ladder: LadderZone, isOpen: boolean): void {
    // Hatch Door
    ctx.fillStyle = isOpen ? '#22c55e' : '#7f1d1d';
    ctx.fillRect(ladder.x - 15, 0, ladder.width + 30, 35);

    // Spotlight beam if hatch is open
    if (isOpen) {
      const hatchGrad = ctx.createLinearGradient(ladder.x + ladder.width / 2, 0, ladder.x + ladder.width / 2, ladder.y + ladder.height + 60);
      hatchGrad.addColorStop(0, 'rgba(34, 197, 94, 0.45)');
      hatchGrad.addColorStop(1, 'rgba(34, 197, 94, 0.0)');
      ctx.fillStyle = hatchGrad;
      ctx.beginPath();
      ctx.moveTo(ladder.x - 20, 0);
      ctx.lineTo(ladder.x + ladder.width + 20, 0);
      ctx.lineTo(ladder.x + ladder.width + 60, ladder.y + ladder.height + 60);
      ctx.lineTo(ladder.x - 60, ladder.y + ladder.height + 60);
      ctx.closePath();
      ctx.fill();
    } else {
      // Locked iron hatch bolts
      ctx.strokeStyle = '#450a0a';
      ctx.lineWidth = 3;
      ctx.strokeRect(ladder.x - 15, 0, ladder.width + 30, 35);
    }

    // Wooden / Iron Ladder Rails
    ctx.fillStyle = '#78350f';
    ctx.fillRect(ladder.x + 10, ladder.y, 8, ladder.height);
    ctx.fillRect(ladder.x + ladder.width - 18, ladder.y, 8, ladder.height);

    // Ladder Rungs
    ctx.fillStyle = '#d6d3d1';
    const rungs = 7;
    for (let i = 0; i < rungs; i++) {
      const rungY = ladder.y + 10 + (i * (ladder.height - 20) / (rungs - 1));
      ctx.fillRect(ladder.x + 10, rungY, ladder.width - 20, 4);
    }

    ctx.fillStyle = isOpen ? '#4ade80' : 'rgba(255, 255, 255, 0.3)';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(isOpen ? '▼ LADDER UNLATCHED ▼' : '⛔ HATCH SEALED', ladder.x + ladder.width / 2, ladder.y + ladder.height + 25);
  }

  private drawOverseer(ctx: CanvasRenderingContext2D, ladder: LadderZone, isOpen: boolean): void {
    const x = ladder.x + ladder.width / 2;
    const y = 16;

    ctx.save();
    ctx.translate(x, y);

    // Drop shadow under sniper
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 18, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body: Heavy Tactical SWAT / Guard Vest (Shoulders)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(-16, -6, 32, 22, 6);
    ctx.fill();

    // Tactical Kevlar Shoulder Pads
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-17, -4, 6, 12);
    ctx.fillRect(11, -4, 6, 12);

    // Sniper Hands & Arms aiming down
    ctx.fillStyle = '#2d3748'; // Gloves
    ctx.beginPath();
    ctx.arc(6, 16, 4, 0, Math.PI * 2); // Trigger hand
    ctx.arc(4, 28, 4, 0, Math.PI * 2); // Handguard grip
    ctx.fill();

    // High-Caliber Sniper Rifle
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(5, 6);
    ctx.lineTo(5, 38); // Long sniper barrel
    ctx.stroke();

    // Muzzle brake
    ctx.fillStyle = '#475569';
    ctx.fillRect(3, 37, 4, 4);

    // Scope / Optic on Rifle
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(2, 12, 6, 14);
    // Glowing sniper lens
    ctx.fillStyle = isOpen ? '#ef4444' : '#64748b';
    ctx.beginPath();
    ctx.arc(5, 26, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Tactical Combat Helmet (Top of head)
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Night vision / Tactical Visor
    ctx.fillStyle = isOpen ? '#f87171' : '#475569';
    ctx.fillRect(-6, 8, 12, 3);

    ctx.restore();

    ctx.fillStyle = isOpen ? '#f87171' : '#94a3b8';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ANONYMOUS', x, y - 10);
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, p: Player, isLocal: boolean): void {
    ctx.save();
    ctx.translate(p.x, p.y);

    // Dynamic drop shadow for authentic 2D depth
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 18, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    // Local player target ring
    if (isLocal) {
      ctx.strokeStyle = 'rgba(0, 255, 204, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Tackle dash motion effect
    if (p.state === 'TACKLING') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(-p.vx * 0.06, -p.vy * 0.06);
      ctx.lineTo(0, 0);
      ctx.stroke();
    }

    // Rotate player towards aim angle
    ctx.rotate(p.angle);

    const isMoving = (p.vx !== 0 || p.vy !== 0) && p.state !== 'CLIMBING';
    const walkCycle = isMoving ? Math.sin(Date.now() * 0.015) : 0;

    // 1. Combat Boots / Shoes (Alternating Footsteps)
    ctx.fillStyle = '#1e293b';
    // Left boot
    ctx.beginPath();
    ctx.ellipse(-7 + (walkCycle * 4), 12, 4, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Right boot
    ctx.beginPath();
    ctx.ellipse(-7 - (walkCycle * 4), -12, 4, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Realistic Muscular Arms & Hands
    const skinTone = '#e0a97a';
    const darkSkinTone = '#c98a58';

    if (p.state === 'CLIMBING') {
      // Reaching alternating arms up ladder rungs
      const climbAnim = Math.sin(Date.now() * 0.012) * 8;

      ctx.fillStyle = skinTone;
      // Left arm reaching high
      ctx.beginPath();
      ctx.ellipse(14 + climbAnim, -11, 5, 12, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      // Right arm pulling
      ctx.beginPath();
      ctx.ellipse(14 - climbAnim, 11, 5, 12, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();

      // Hands gripping rungs
      ctx.fillStyle = darkSkinTone;
      ctx.beginPath();
      ctx.arc(22 + climbAnim, -13, 4.5, 0, Math.PI * 2);
      ctx.arc(22 - climbAnim, 13, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal / Brawling posture: arms reaching forward
      // Left arm (bracing/fist)
      ctx.fillStyle = skinTone;
      ctx.beginPath();
      ctx.ellipse(8, -13, 5, 10, -Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();

      // Right arm (throwing / punching)
      ctx.beginPath();
      ctx.ellipse(10, 13, 5, 10, Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();

      // Hands with knuckles
      ctx.fillStyle = darkSkinTone;
      ctx.beginPath();
      ctx.arc(17, -15, 4.5, 0, Math.PI * 2);
      ctx.arc(19, 15, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Rock held in right hand (textured jagged rock)
      if (p.rocks > 0) {
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.moveTo(20, 11);
        ctx.lineTo(26, 14);
        ctx.lineTo(24, 20);
        ctx.lineTo(18, 18);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // 3. Human Torso: Broad Shoulders tapering to waist (Realistic Prison Inmate Vest)
    // Shirt / Jumpsuit
    ctx.fillStyle = p.color; // Prison overalls color
    ctx.beginPath();
    ctx.moveTo(-10, -14); // Left shoulder
    ctx.lineTo(6, -15);
    ctx.lineTo(6, 15);
    ctx.lineTo(-10, 14); // Right shoulder
    ctx.lineTo(-14, 0);  // Back spine
    ctx.closePath();
    ctx.fill();

    // Muscle / Fabric fold shading on back
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-11, -12);
    ctx.lineTo(3, -11);
    ctx.moveTo(-11, 12);
    ctx.lineTo(3, 11);
    ctx.moveTo(-12, 0); // Spine fold
    ctx.lineTo(2, 0);
    ctx.stroke();

    // Shirt Collar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(3, 0, 6, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // 4. Realistic Human Head & Ears
    // Neck
    ctx.fillStyle = darkSkinTone;
    ctx.fillRect(-2, -4, 6, 8);

    // Left and Right Ears
    ctx.fillStyle = skinTone;
    ctx.beginPath();
    ctx.arc(0, -9, 3, 0, Math.PI * 2);
    ctx.arc(0, 9, 3, 0, Math.PI * 2);
    ctx.fill();

    // Cranium / Head
    ctx.fillStyle = skinTone;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Realistic Hair / Inmate Buzzcut
    ctx.fillStyle = '#292524'; // Dark hair
    ctx.beginPath();
    ctx.ellipse(-2, 0, 7.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose bridge pointing forward
    ctx.fillStyle = darkSkinTone;
    ctx.beginPath();
    ctx.moveTo(8, -1.5);
    ctx.lineTo(11, 0);
    ctx.lineTo(8, 1.5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Overhead HUD
    ctx.textAlign = 'center';

    if (p.stunnedTimer > 0) {
      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('💫 STUNNED', p.x, p.y - 34);
    } else {
      ctx.fillStyle = isLocal ? '#00ffcc' : '#ecf0f1';
      ctx.font = isLocal ? 'bold 12px sans-serif' : '11px sans-serif';
      ctx.fillText(p.name, p.x, p.y - 28);
    }

    // Health Bar
    const barWidth = 32;
    const barHeight = 4;
    ctx.fillStyle = '#444';
    ctx.fillRect(p.x - barWidth / 2, p.y - 24, barWidth, barHeight);
    ctx.fillStyle = p.health > 40 ? '#2ecc71' : '#e74c3c';
    ctx.fillRect(p.x - barWidth / 2, p.y - 24, barWidth * (p.health / 100), barHeight);

    // Climb progress meter
    if (p.state === 'CLIMBING') {
      ctx.fillStyle = '#f39c12';
      ctx.fillRect(p.x - barWidth / 2, p.y - 18, barWidth * (p.climbProgress / 100), 5);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - barWidth / 2, p.y - 18, barWidth, 5);

      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`CLIMB: ${Math.floor(p.climbProgress)}%`, p.x, p.y - 8);
    }
  }

  private drawDeadPlayer(ctx: CanvasRenderingContext2D, p: Player): void {
    // Realistic irregular blood pool with coagulation
    ctx.fillStyle = 'rgba(127, 29, 29, 0.75)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 26, 16, Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(80, 10, 10, 0.85)';
    ctx.beginPath();
    ctx.ellipse(p.x - 4, p.y + 2, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Realistic human corpse sprawled out on floor
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // Limp legs
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-16, -9, 12, 5);
    ctx.fillRect(-18, 5, 14, 5);

    // Torso
    ctx.fillStyle = p.color;
    ctx.fillRect(-10, -7, 18, 14);

    // Splayed limp arms
    ctx.fillStyle = '#c98a58';
    ctx.fillRect(2, -14, 5, 8);
    ctx.fillRect(-4, 7, 5, 10);

    // Head turned to side
    ctx.beginPath();
    ctx.arc(8, 0, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`💀 ${p.name}`, p.x, p.y + 6);
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[]): void {
    for (const proj of projectiles) {
      ctx.save();
      ctx.fillStyle = '#bdc3c7';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7f8c8d';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawSniperShots(ctx: CanvasRenderingContext2D, shots: SniperShot[]): void {
    const now = Date.now();
    for (const s of shots) {
      const age = (now - s.timestamp) / 1000;
      const alpha = Math.max(0, 1 - age * 2.5);

      ctx.strokeStyle = `rgba(231, 76, 60, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.fromX, s.fromY);
      ctx.lineTo(s.toX, s.toY);
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(s.toX, s.toY, 15 * (1 - age), 0, Math.PI * 2);
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

    // Format 10-minute timer
    const mins = Math.floor(state.matchTimer / 60);
    const secs = Math.floor(state.matchTimer % 60);
    const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    // 1. Center Status / Signal Announcement
    ctx.textAlign = 'center';
    if (state.phase === 'SIGNAL_ACTIVE') {
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 36px monospace';
      ctx.fillText(`🚨 ESCAPE QUOTA: ${state.signalEscapedCount} / ${state.signalQuota}`, this.width / 2, 230);

      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(`HATCH SEALS IN: ${state.signalWindowRemaining}s (IF 2 CLIMB AT ONCE, SHOT FIRED!)`, this.width / 2, 258);
    } else if (state.phase === 'WAITING_SIGNAL') {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 28px monospace';
      ctx.fillText(`ANONYMOUS IS SILENT...`, this.width / 2, 230);

      ctx.fillStyle = '#64748b';
      ctx.font = '14px monospace';
      ctx.fillText(`NEXT CALL IN: ~${state.nextSignalIn}s (OR PERHAPS NEVER)`, this.width / 2, 255);
    } else if (state.phase === 'PURGE') {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 40px monospace';
      ctx.fillText(`10 MINUTES ELAPSED - FINAL PURGE!`, this.width / 2, 230);
    }

    // 2. Overseer Announcement Bar (Top)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(40, 48, this.width - 80, 36);
    ctx.strokeStyle = state.phase === 'SIGNAL_ACTIVE' ? '#22c55e' : '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(40, 48, this.width - 80, 36);

    ctx.fillStyle = state.phase === 'SIGNAL_ACTIVE' ? '#86efac' : '#f8fafc';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(state.announcementText, this.width / 2, 71);

    // 3. 10-Minute Clock & Remaining in Pit (Top Left)
    ctx.textAlign = 'left';
    ctx.fillStyle = state.matchTimer < 120 ? '#ef4444' : '#f8fafc';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`⏱️ ${timeFormatted}`, 45, 115);

    const livingInPit = state.players.filter(p => !p.hasEscaped && p.state !== 'DEAD').length;
    ctx.fillStyle = '#38bdf8';
    ctx.font = '13px monospace';
    ctx.fillText(`PRISONERS IN CELL: ${livingInPit}`, 45, 138);

    // 4. Surface Survivors List & Player Status (Top Right)
    ctx.textAlign = 'right';
    if (localPlayer) {
      if (localPlayer.hasEscaped) {
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`🏆 YOU ESCAPED AT ${localPlayer.escapeTime || '0:00'}!`, this.width - 45, 115);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px sans-serif';
        ctx.fillText(`Spectating surviving prisoners from surface`, this.width - 45, 135);
      } else if (localPlayer.state === 'DEAD') {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`💀 YOU WERE EXECUTED`, this.width - 45, 115);
      } else {
        ctx.fillStyle = '#00ffcc';
        ctx.font = 'bold 13px monospace';
        const rocksText = '🪨 '.repeat(localPlayer.rocks) || 'NO ROCKS';
        ctx.fillText(`YOU ARE IN THE PIT  |  ${rocksText}`, this.width - 45, 115);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px monospace';
        ctx.fillText(`SABOTAGES: ${localPlayer.sabotages}`, this.width - 45, 135);
      }
    }

    // List of all escaped players so far (Bottom Left)
    const escaped = state.players.filter(p => p.hasEscaped);
    if (escaped.length > 0) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`SURVIVED TO SURFACE (${escaped.length}):`, 45, this.height - 35);
      const names = escaped.map(e => `${e.name} (${e.escapeTime})`).join(', ');
      ctx.fillStyle = '#a7f3d0';
      ctx.font = '11px monospace';
      ctx.fillText(names, 45, this.height - 18);
    }
  }

  private drawMatchOverScreen(ctx: CanvasRenderingContext2D, state: GameState): void {
    ctx.fillStyle = 'rgba(10, 10, 15, 0.92)';
    ctx.fillRect(150, 120, this.width - 300, 460);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(150, 120, this.width - 300, 460);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('10-MINUTE SURVIVAL MATCH OVER', this.width / 2, 170);

    const survivors = state.players.filter(p => p.hasEscaped);
    const dead = state.players.filter(p => !p.hasEscaped);

    // Survivors column
    ctx.textAlign = 'left';
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`🏆 SURVIVORS (${survivors.length})`, 200, 220);
    survivors.forEach((p, idx) => {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '13px monospace';
      ctx.fillText(`• ${p.name} - Escaped at ${p.escapeTime}`, 200, 250 + idx * 24);
    });

    // Casualties column
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
