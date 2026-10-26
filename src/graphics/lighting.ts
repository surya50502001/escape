/**
 * Realistic Cinematic Prison Lighting & Atmosphere System
 * Renders volumetric lighting cones, ceiling fluorescent fixtures,
 * floating atmospheric dust motes, and a cinematic perimeter vignette.
 */

export interface LightSource {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  color: string;
  flicker?: boolean;
}

interface DustMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  pulsePhase: number;
}

export class LightingSystem {
  private static instance: LightingSystem | null = null;
  private dustMotes: DustMote[] = [];
  private numMotes: number = 35;
  private vignetteCanvas: HTMLCanvasElement | null = null;

  public static getInstance(): LightingSystem {
    if (!LightingSystem.instance) {
      LightingSystem.instance = new LightingSystem();
    }
    return LightingSystem.instance;
  }

  constructor() {
    this.initDustMotes();
  }

  private initDustMotes(): void {
    this.dustMotes = [];
    for (let i = 0; i < this.numMotes; i++) {
      this.dustMotes.push({
        x: Math.random() * 1600,
        y: Math.random() * 640,
        vx: (Math.random() - 0.5) * 6,
        vy: -2 - Math.random() * 4, // Gentle upward drift
        size: 0.8 + Math.random() * 1.6,
        alpha: 0.15 + Math.random() * 0.45,
        pulsePhase: Math.random() * Math.PI * 2
      });
    }
  }

  /**
   * Render overhead fluorescent industrial fixture in a protective steel cage.
   */
  public drawFluorescentFixture(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number = 96,
    now: number = performance.now()
  ): void {
    const halfW = width / 2;
    // Micro flicker for realistic aging fluorescent tube
    const flicker = Math.sin(now * 0.04) > 0.98 ? 0.8 : 1.0;

    // 1. Steel Mounting Channel Box
    ctx.fillStyle = '#1c1f24';
    ctx.fillRect(x - halfW - 4, y - 6, width + 8, 8);
    ctx.strokeStyle = '#333b47';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - halfW - 4, y - 6, width + 8, 8);

    // 2. High-output Fluorescent Tube
    const tubeGrad = ctx.createLinearGradient(0, y, 0, y + 6);
    tubeGrad.addColorStop(0, '#ffffff');
    tubeGrad.addColorStop(0.5, `rgba(240, 249, 255, ${0.95 * flicker})`);
    tubeGrad.addColorStop(1, '#93c5fd');
    ctx.fillStyle = tubeGrad;
    ctx.fillRect(x - halfW, y + 2, width, 5);

    // 3. Steel Protective Wire Cage
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - halfW - 2, y, width + 4, 10);
    for (let gx = x - halfW + 8; gx < x + halfW; gx += 12) {
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + 10);
      ctx.stroke();
    }

    // 4. Volumetric Downward Light Cone
    const coneH = 340;
    const coneBottomW = width * 3.5;
    const lightGrad = ctx.createRadialGradient(x, y + 6, 10, x, y + coneH * 0.6, coneH);
    lightGrad.addColorStop(0, `rgba(224, 242, 254, ${0.22 * flicker})`);
    lightGrad.addColorStop(0.35, `rgba(186, 230, 253, ${0.1 * flicker})`);
    lightGrad.addColorStop(0.7, `rgba(125, 211, 252, ${0.03 * flicker})`);
    lightGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.save();
    ctx.fillStyle = lightGrad;
    ctx.beginPath();
    ctx.moveTo(x - halfW, y + 6);
    ctx.lineTo(x + halfW, y + 6);
    ctx.lineTo(x + coneBottomW / 2, y + coneH);
    ctx.lineTo(x - coneBottomW / 2, y + coneH);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Update and draw floating airborne dust motes catching ambient light.
   */
  public updateAndDrawDustMotes(ctx: CanvasRenderingContext2D, dt: number, now: number): void {
    ctx.save();
    for (const mote of this.dustMotes) {
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;

      // Wrap around room bounds
      if (mote.y < 0) {
        mote.y = 640;
        mote.x = Math.random() * 1600;
      }
      if (mote.x < 0) mote.x = 1600;
      if (mote.x > 1600) mote.x = 0;

      const alphaPulse = mote.alpha * (0.7 + Math.sin(now * 0.002 + mote.pulsePhase) * 0.3);
      ctx.fillStyle = `rgba(224, 242, 254, ${alphaPulse})`;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Atmospheric window godrays through prison bars.
   */
  public drawWindowGodRays(
    ctx: CanvasRenderingContext2D,
    winX: number,
    winY: number,
    winW: number,
    winH: number
  ): void {
    ctx.save();
    const rayLength = 320;
    const rayAngle = Math.PI * 0.28; // Diagonal beam down-right

    const grad = ctx.createLinearGradient(
      winX, winY,
      winX + Math.cos(rayAngle) * rayLength,
      winY + Math.sin(rayAngle) * rayLength
    );
    grad.addColorStop(0, 'rgba(186, 230, 253, 0.16)');
    grad.addColorStop(0.3, 'rgba(186, 230, 253, 0.08)');
    grad.addColorStop(0.7, 'rgba(186, 230, 253, 0.02)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(winX, winY);
    ctx.lineTo(winX + winW, winY);
    ctx.lineTo(winX + winW + Math.cos(rayAngle) * rayLength + 40, winY + Math.sin(rayAngle) * rayLength);
    ctx.lineTo(winX + Math.cos(rayAngle) * rayLength - 20, winY + Math.sin(rayAngle) * rayLength);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Cinematic perimeter vignette in screen/viewport space.
   */
  public drawCinematicVignette(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    if (!this.vignetteCanvas || this.vignetteCanvas.width !== screenW || this.vignetteCanvas.height !== screenH) {
      this.vignetteCanvas = document.createElement('canvas');
      this.vignetteCanvas.width = screenW;
      this.vignetteCanvas.height = screenH;
      const vCtx = this.vignetteCanvas.getContext('2d')!;

      const cx = screenW / 2;
      const cy = screenH / 2;
      const maxR = Math.sqrt(cx * cx + cy * cy);
      const vGrad = vCtx.createRadialGradient(cx, cy, maxR * 0.45, cx, cy, maxR);
      vGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.2)');
      vGrad.addColorStop(1, 'rgba(3, 7, 18, 0.75)');

      vCtx.fillStyle = vGrad;
      vCtx.fillRect(0, 0, screenW, screenH);
    }

    ctx.drawImage(this.vignetteCanvas, 0, 0);
  }
}
