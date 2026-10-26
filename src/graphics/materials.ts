/**
 * Realistic Procedural Material & Texture Generator
 * Generates high-fidelity concrete, steel, hazard, and architectural textures
 * onto offscreen canvases, cached as CanvasPatterns for 60 FPS performance.
 */

export class MaterialManager {
  private static instance: MaterialManager | null = null;

  public concreteWallPattern: CanvasPattern | null = null;
  public concreteFloorPattern: CanvasPattern | null = null;
  public steelPlatePattern: CanvasPattern | null = null;
  public diamondTreadPattern: CanvasPattern | null = null;
  public hazardChevronPattern: CanvasPattern | null = null;

  private isInitialized: boolean = false;

  public static getInstance(): MaterialManager {
    if (!MaterialManager.instance) {
      MaterialManager.instance = new MaterialManager();
    }
    return MaterialManager.instance;
  }

  public init(ctx: CanvasRenderingContext2D): void {
    if (this.isInitialized) return;

    this.concreteWallPattern = this.generateConcreteWall(ctx);
    this.concreteFloorPattern = this.generateConcreteFloor(ctx);
    this.steelPlatePattern = this.generateSteelPlate(ctx);
    this.diamondTreadPattern = this.generateDiamondTread(ctx);
    this.hazardChevronPattern = this.generateHazardChevron(ctx);

    this.isInitialized = true;
  }

  /**
   * Poured reinforced concrete wall with formwork seams, tie-rod holes,
   * surface aggregate pitting, and weathering.
   */
  private generateConcreteWall(mainCtx: CanvasRenderingContext2D): CanvasPattern | null {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Base concrete grey with subtle warm undertone
    ctx.fillStyle = '#22262c';
    ctx.fillRect(0, 0, 128, 128);

    // Aggregate noise and surface pitting
    const imgData = ctx.getImageData(0, 0, 128, 128);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 22;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise + 2)); // slight cool bias
    }
    ctx.putImageData(imgData, 0, 0);

    // Horizontal formwork board seams (every 64px)
    ctx.strokeStyle = '#14171c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 64);
    ctx.lineTo(128, 64);
    ctx.moveTo(0, 127.5);
    ctx.lineTo(128, 127.5);
    ctx.stroke();

    // Subtle highlight on lower edge of seam for bevel depth
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 65.5);
    ctx.lineTo(128, 65.5);
    ctx.stroke();

    // Tie-rod holes (circular indentations where formwork rods were clamped)
    const tieHoles = [
      { x: 32, y: 32 },
      { x: 96, y: 32 },
      { x: 32, y: 96 },
      { x: 96, y: 96 }
    ];
    for (const hole of tieHoles) {
      // Outer shadow recess
      ctx.fillStyle = '#101216';
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Inner rusty steel plug
      ctx.fillStyle = '#2c221e';
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Lower highlight lip
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y + 0.5, 4, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    }

    // Faint vertical water seepage stains
    ctx.fillStyle = 'rgba(10, 12, 16, 0.18)';
    ctx.fillRect(40, 0, 16, 128);
    ctx.fillRect(85, 40, 12, 88);

    return mainCtx.createPattern(canvas, 'repeat');
  }

  /**
   * Heavy foundation slab concrete floor with wear, scuffs and aggregate.
   */
  private generateConcreteFloor(mainCtx: CanvasRenderingContext2D): CanvasPattern | null {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#2a2e36';
    ctx.fillRect(0, 0, 64, 64);

    const imgData = ctx.getImageData(0, 0, 64, 64);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 18;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);

    // Floor expansion joint
    ctx.strokeStyle = '#181b20';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 63.5);
    ctx.lineTo(64, 63.5);
    ctx.stroke();

    return mainCtx.createPattern(canvas, 'repeat');
  }

  /**
   * Industrial cold-rolled steel plate with directional mill grain and edge seams.
   */
  private generateSteelPlate(mainCtx: CanvasRenderingContext2D): CanvasPattern | null {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    // Steel base gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#3a4454');
    grad.addColorStop(0.5, '#2e3744');
    grad.addColorStop(1, '#252c37');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    // Mill grain scratch lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let y = 3; y < 64; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y + (Math.random() - 0.5));
      ctx.lineTo(64, y + (Math.random() - 0.5));
      ctx.stroke();
    }

    // Plate border bevel
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.strokeRect(0.5, 0.5, 63, 63);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.strokeRect(1.5, 1.5, 61, 61);

    return mainCtx.createPattern(canvas, 'repeat');
  }

  /**
   * Embossed diamond tread industrial metal plating for catwalks and walkways.
   */
  private generateDiamondTread(mainCtx: CanvasRenderingContext2D): CanvasPattern | null {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#2b333e';
    ctx.fillRect(0, 0, 16, 16);

    // Diamond 1
    this.drawDiamond(ctx, 4, 4);
    this.drawDiamond(ctx, 12, 12);

    return mainCtx.createPattern(canvas, 'repeat');
  }

  private drawDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);

    // Drop shadow
    ctx.fillStyle = '#171c22';
    ctx.fillRect(-2, -0.8, 4, 1.6);

    // Diamond highlight body
    ctx.fillStyle = '#475363';
    ctx.fillRect(-2.5, -1.2, 5, 2.4);

    // Top specular glint
    ctx.fillStyle = '#657488';
    ctx.fillRect(-2, -1, 4, 1);

    ctx.restore();
  }

  /**
   * Heavy industrial 45-degree yellow and black safety hazard chevron.
   */
  private generateHazardChevron(mainCtx: CanvasRenderingContext2D): CanvasPattern | null {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d')!;

    // Worn safety yellow base
    ctx.fillStyle = '#d97706'; // Gritty industrial amber-yellow
    ctx.fillRect(0, 0, 24, 24);

    // Black diagonal bands
    ctx.fillStyle = '#1c1917'; // Grimy carbon black
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.lineTo(12, 0);
    ctx.lineTo(24, 0);
    ctx.lineTo(0, 24);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(12, 24);
    ctx.lineTo(24, 12);
    ctx.lineTo(24, 24);
    ctx.closePath();
    ctx.fill();

    // Weathering/scuff marks
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, 24, 3);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(0, 21, 24, 3);

    return mainCtx.createPattern(canvas, 'repeat');
  }

  /**
   * Utility to draw realistic 3D rounded industrial rivets/bolts.
   */
  public drawRivet(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number = 2.5): void {
    // Cast shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.arc(x + 0.8, y + 0.8, radius, 0, Math.PI * 2);
    ctx.fill();

    // Rivet head base
    const grad = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    grad.addColorStop(0, '#525e6f');
    grad.addColorStop(0.5, '#384250');
    grad.addColorStop(1, '#1e242c');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Specular highlight glint
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(x - radius * 0.35, y - radius * 0.35, radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}
