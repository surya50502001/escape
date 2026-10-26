import { ClientCampaignSync } from '../../server/campaign/campaignSession.js';
import { MaterialManager } from './materials.js';
import { LightingSystem } from './lighting.js';

export class Room1Renderer {
  private static instance: Room1Renderer | null = null;
  private mat: MaterialManager;
  private light: LightingSystem;

  public static getInstance(): Room1Renderer {
    if (!Room1Renderer.instance) {
      Room1Renderer.instance = new Room1Renderer();
    }
    return Room1Renderer.instance;
  }

  constructor() {
    this.mat = MaterialManager.getInstance();
    this.light = LightingSystem.getInstance();
  }

  /**
   * Render Stage A Realistic Prison Cell Environment (Room 1).
   * Exact physics coordinates:
   * - Room dimensions: 1600 x 640
   * - Main floor surface: Y = 544
   * - Upper ledge / walkway surface: Y = 384 (x: 576..1600)
   * - Boost zone: x: 256..448, y: 480..544
   * - Rope anchor: x: 992, y: 384
   * - Exit door: x: 1504..1568, y: 288..384
   */
  public render(
    ctx: CanvasRenderingContext2D,
    campaign: ClientCampaignSync,
    now: number = performance.now()
  ): void {
    const roomW = campaign.roomWidth || 1600;
    const roomH = campaign.roomHeight || 640;

    this.mat.init(ctx);

    // ── 1. BACKGROUND WALL ARCHITECTURE ──────────────────────────────
    this.drawBackgroundWalls(ctx, roomW, roomH);

    // ── 2. BACKGROUND PRISON CELL FIXTURES ───────────────────────────
    this.drawCellFixtures(ctx, now);

    // ── 3. PLATFORMS, WALKWAY & FOUNDATION SLABS ─────────────────────
    this.drawConcreteStructures(ctx, campaign);

    // ── 4. STAINLESS & COLD-ROLLED STEEL DOORS ───────────────────────
    this.drawSteelDoors(ctx, campaign, now);

    // ── 5. INTERACTIVE OBJECTS & FIXTURES ────────────────────────────
    this.drawInteractiveFixtures(ctx, campaign, now);

    // ── 6. DYNAMIC OVERHEAD LIGHTING & GODRAYS ───────────────────────
    this.drawLightingPass(ctx, now);
  }

  /**
   * Poured reinforced concrete wall with formwork tie holes, seams, and grime.
   */
  private drawBackgroundWalls(ctx: CanvasRenderingContext2D, roomW: number, roomH: number): void {
    // Fill with modular weathered concrete pattern
    if (this.mat.concreteWallPattern) {
      ctx.fillStyle = this.mat.concreteWallPattern;
      ctx.fillRect(0, 0, roomW, roomH);
    } else {
      ctx.fillStyle = '#1c2027';
      ctx.fillRect(0, 0, roomW, roomH);
    }

    // Top ceiling shadow
    const ceilingGrad = ctx.createLinearGradient(0, 0, 0, 80);
    ceilingGrad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
    ceilingGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ceilingGrad;
    ctx.fillRect(0, 0, roomW, 80);

    // Floor baseboard shadow & grime buildup
    const floorGrime = ctx.createLinearGradient(0, 500, 0, 544);
    floorGrime.addColorStop(0, 'rgba(0, 0, 0, 0)');
    floorGrime.addColorStop(1, 'rgba(10, 12, 16, 0.65)');
    ctx.fillStyle = floorGrime;
    ctx.fillRect(0, 500, roomW, 44);

    // Ambient occlusion under upper ledge (x: 576..1600, y: 384)
    const ledgeAO = ctx.createLinearGradient(0, 384, 0, 470);
    ledgeAO.addColorStop(0, 'rgba(5, 7, 10, 0.7)');
    ledgeAO.addColorStop(1, 'rgba(5, 7, 10, 0)');
    ctx.fillStyle = ledgeAO;
    ctx.fillRect(576, 384, roomW - 576, 86);
  }

  /**
   * Authentic prison cell interior fixtures: bolted steel bunk bed,
   * high-security barred window, and electrical conduit.
   */
  private drawCellFixtures(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.save();

    // 1. Barred High-Security Window (x: 180, y: 120, w: 90, h: 48)
    const winX = 180;
    const winY = 120;
    const winW = 90;
    const winH = 48;

    // Window recess depth shadow
    ctx.fillStyle = '#0f1217';
    ctx.fillRect(winX - 6, winY - 6, winW + 12, winH + 12);
    ctx.strokeStyle = '#2b333f';
    ctx.lineWidth = 2;
    ctx.strokeRect(winX - 6, winY - 6, winW + 12, winH + 12);

    // Outside security floodlight / moonlight sky
    const skyGrad = ctx.createLinearGradient(winX, winY, winX, winY + winH);
    skyGrad.addColorStop(0, '#38bdf8');
    skyGrad.addColorStop(0.4, '#0369a1');
    skyGrad.addColorStop(1, '#082f49');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(winX, winY, winW, winH);

    // Heavy round steel security bars
    ctx.strokeStyle = '#1e242c';
    ctx.lineWidth = 3.5;
    for (let bx = winX + 15; bx < winX + winW; bx += 15) {
      ctx.beginPath();
      ctx.moveTo(bx, winY);
      ctx.lineTo(bx, winY + winH);
      ctx.stroke();

      // Bar specular glint
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx - 0.8, winY);
      ctx.lineTo(bx - 0.8, winY + winH);
      ctx.stroke();
      ctx.strokeStyle = '#1e242c';
      ctx.lineWidth = 3.5;
    }

    // Volumetric God Rays pouring into the cell
    this.light.drawWindowGodRays(ctx, winX, winY, winW, winH);

    // 2. Bolted Industrial Steel Bunk Bed (x: 70, y: 460, w: 140, h: 84)
    const bedX = 70;
    const bedY = 460;
    const bedW = 140;

    // Bed cast shadow on floor
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(bedX - 4, 540, bedW + 8, 4);

    // Support Chains anchored to wall (hanging from wall down to bed frame)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bedX + 12, bedY - 40);
    ctx.lineTo(bedX + 12, bedY + 10);
    ctx.moveTo(bedX + bedW - 12, bedY - 40);
    ctx.lineTo(bedX + bedW - 12, bedY + 10);
    ctx.stroke();

    // Wall anchor plates
    ctx.fillStyle = '#1e242c';
    ctx.fillRect(bedX + 8, bedY - 44, 8, 8);
    ctx.fillRect(bedX + bedW - 16, bedY - 44, 8, 8);
    this.mat.drawRivet(ctx, bedX + 12, bedY - 40, 2);
    this.mat.drawRivet(ctx, bedX + bedW - 12, bedY - 40, 2);

    // Lower bunk frame (angle-iron steel)
    ctx.fillStyle = '#1e242c';
    ctx.fillRect(bedX, bedY + 10, bedW, 8);
    ctx.fillStyle = '#333e4f';
    ctx.fillRect(bedX, bedY + 10, bedW, 2); // Highlight lip

    // Thin institutional navy mattress
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(bedX + 4, bedY + 2, bedW - 8, 8);
    ctx.fillStyle = '#334155';
    ctx.fillRect(bedX + 4, bedY + 2, bedW - 8, 2);

    // Folded coarse prison wool blanket (olive/grey)
    ctx.fillStyle = '#3f4738';
    ctx.fillRect(bedX + 8, bedY, 40, 6);
    ctx.strokeStyle = '#272d23';
    ctx.lineWidth = 1;
    ctx.strokeRect(bedX + 8, bedY, 40, 6);

    // Bed support legs
    ctx.fillStyle = '#1e242c';
    ctx.fillRect(bedX + 8, bedY + 18, 6, 66);
    ctx.fillRect(bedX + bedW - 14, bedY + 18, 6, 66);

    // 3. Exposed Galvanized Steel Electrical Conduit & Junction Box
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 36);
    ctx.lineTo(1600, 36);
    ctx.stroke();

    // Conduit metallic highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 35);
    ctx.lineTo(1600, 35);
    ctx.stroke();

    // Junction boxes with warning plate
    const junctionBoxes = [360, 850, 1420];
    for (const jx of junctionBoxes) {
      ctx.fillStyle = '#334155';
      ctx.fillRect(jx - 10, 26, 20, 20);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(jx - 10, 26, 20, 20);
      this.mat.drawRivet(ctx, jx - 6, 30, 1.5);
      this.mat.drawRivet(ctx, jx + 6, 30, 1.5);
      this.mat.drawRivet(ctx, jx - 6, 42, 1.5);
      this.mat.drawRivet(ctx, jx + 6, 42, 1.5);
    }

    ctx.restore();
  }

  /**
   * Poured concrete slabs, structural steel I-beams, hazard edges, and diamond plate.
   */
  private drawConcreteStructures(ctx: CanvasRenderingContext2D, campaign: ClientCampaignSync): void {
    ctx.save();

    for (const w of campaign.walls) {
      if (w.isPlatform) {
        // Is this the Main Floor (y: 544..640)?
        if (w.y >= 544) {
          this.drawMainFloorSlab(ctx, w.x, w.y, w.width, w.height);
        } else {
          // Upper Walkway / Ledge (y: 384, w: ~1024)
          this.drawUpperWalkway(ctx, w.x, w.y, w.width, w.height);
        }
      } else {
        // Perimeter solid boundary walls
        ctx.fillStyle = '#11141a';
        ctx.fillRect(w.x, w.y, w.width, w.height);
        ctx.strokeStyle = '#232a35';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.width - 1, w.height - 1);
      }
    }

    ctx.restore();
  }

  /**
   * Heavy foundation concrete floor slab with expansion joints and floor grime.
   */
  private drawMainFloorSlab(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    // Concrete floor texture fill
    if (this.mat.concreteFloorPattern) {
      ctx.fillStyle = this.mat.concreteFloorPattern;
      ctx.fillRect(x, y, width, height);
    } else {
      ctx.fillStyle = '#262a32';
      ctx.fillRect(x, y, width, height);
    }

    // Top surface edge highlight (where feet touch at y=544)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(x, y, width, 2);

    // Deep structural bedrock fill below floor
    const subGrad = ctx.createLinearGradient(0, y + 20, 0, y + height);
    subGrad.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
    subGrad.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
    ctx.fillStyle = subGrad;
    ctx.fillRect(x, y + 20, width, height - 20);

    // Foundation expansion joint lines every 128px
    ctx.strokeStyle = '#181b22';
    ctx.lineWidth = 2;
    for (let jx = x + 128; jx < x + width; jx += 128) {
      ctx.beginPath();
      ctx.moveTo(jx, y);
      ctx.lineTo(jx, y + height);
      ctx.stroke();
    }
  }

  /**
   * Reinforced upper catwalk: structural steel I-beams, diamond tread surface,
   * safety hazard chevron edging, and drop shadows.
   */
  private drawUpperWalkway(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    // 1. Structural Steel C-Channel / I-Beam Support under the catwalk
    const beamH = Math.max(28, height);
    ctx.fillStyle = '#1e2530';
    ctx.fillRect(x, y + 6, width, beamH - 6);

    // Vertical structural stiffener plates & rivets every 96px
    for (let sx = x + 32; sx < x + width; sx += 96) {
      ctx.fillStyle = '#2d3744';
      ctx.fillRect(sx - 3, y + 6, 6, beamH - 6);
      this.mat.drawRivet(ctx, sx, y + 14, 2);
      this.mat.drawRivet(ctx, sx, y + beamH - 8, 2);
    }

    // Lower flange lip of the I-beam
    ctx.fillStyle = '#161b24';
    ctx.fillRect(x, y + beamH - 4, width, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x, y + beamH - 4, width, 1);

    // 2. Catwalk Walking Surface (y=384): Diamond Metal Tread Plating
    if (this.mat.diamondTreadPattern) {
      ctx.fillStyle = this.mat.diamondTreadPattern;
      ctx.fillRect(x, y, width, 6);
    } else {
      ctx.fillStyle = '#3a4454';
      ctx.fillRect(x, y, width, 6);
    }

    // 3. Worn Industrial Safety Hazard Chevrons on drop-off edge (left edge of walkway x: 576..608)
    if (this.mat.hazardChevronPattern) {
      ctx.fillStyle = this.mat.hazardChevronPattern;
      ctx.fillRect(x, y + 2, 36, 12);
      // Right edge hazard indicator
      ctx.fillRect(x + width - 36, y + 2, 36, 12);
    }

    // Top edge specular sheen (walking surface lip at y=384)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(x, y, width, 1.5);
  }

  /**
   * Heavy blast-hardened steel cell doors with hydraulic arm, barrel hinges,
   * observation port, and status indicator LED.
   */
  private drawSteelDoors(
    ctx: CanvasRenderingContext2D,
    campaign: ClientCampaignSync,
    now: number
  ): void {
    ctx.save();

    for (const door of campaign.doors) {
      const isExit = door.id.includes('exit');
      const dx = door.rect.x;
      const dy = door.rect.y;
      const dw = door.rect.width;
      const dh = door.rect.height;

      // 1. Heavy Industrial Steel Jamb Frame (outer recess)
      ctx.fillStyle = '#161b22';
      ctx.fillRect(dx - 4, dy - 6, dw + 8, dh + 6);
      ctx.strokeStyle = '#2e3846';
      ctx.lineWidth = 2;
      ctx.strokeRect(dx - 4, dy - 6, dw + 8, dh + 6);

      // Frame mounting anchor bolts
      this.mat.drawRivet(ctx, dx - 2, dy + 8, 2);
      this.mat.drawRivet(ctx, dx - 2, dy + dh - 12, 2);
      this.mat.drawRivet(ctx, dx + dw + 2, dy + 8, 2);
      this.mat.drawRivet(ctx, dx + dw + 2, dy + dh - 12, 2);

      // 2. Cold-Rolled Heavy Steel Door Leaf
      if (this.mat.steelPlatePattern) {
        ctx.fillStyle = this.mat.steelPlatePattern;
        ctx.fillRect(dx, dy, dw, dh);
      } else {
        ctx.fillStyle = '#2b3340';
        ctx.fillRect(dx, dy, dw, dh);
      }

      // Door bevel edge highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);

      // 3. Overhead Pneumatic Door Closer Cylinder Arm
      ctx.fillStyle = '#1c222c';
      ctx.fillRect(dx + 6, dy - 5, dw - 12, 4);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(dx + 10, dy - 4, 14, 2); // Hydraulic rod

      // 4. Heavy Security Barrel Hinges on door edge
      const hinges = [dy + 16, dy + dh / 2, dy + dh - 20];
      for (const hy of hinges) {
        ctx.fillStyle = '#1c222c';
        ctx.fillRect(dx - 3, hy - 6, 4, 12);
        ctx.fillStyle = '#475569';
        ctx.fillRect(dx - 2.5, hy - 4, 3, 8);
      }

      // 5. Reinforced Wireframe Glass Observation Window
      const winW = 20;
      const winH = 28;
      const winX = dx + dw / 2 - winW / 2;
      const winY = dy + 18;

      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(winX, winY, winW, winH);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(winX, winY, winW, winH);

      // Vertical security bars across window
      ctx.strokeStyle = '#1e242c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(winX + 7, winY);
      ctx.lineTo(winX + 7, winY + winH);
      ctx.moveTo(winX + 13, winY);
      ctx.lineTo(winX + 13, winY + winH);
      ctx.stroke();

      // Glass specular reflection
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(winX + 3, winY + 4);
      ctx.lineTo(winX + 14, winY + 22);
      ctx.stroke();

      // 6. Electronic Deadbolt Status Indicator LED
      const ledX = dx + dw - 10;
      const ledY = dy + dh / 2;
      const isOpen = isExit; // Exit in Room 1 is open once reached

      const ledColor = isOpen ? '#22c55e' : '#38bdf8';
      const glowGrad = ctx.createRadialGradient(ledX, ledY, 1, ledX, ledY, 12);
      glowGrad.addColorStop(0, ledColor);
      glowGrad.addColorStop(0.4, isOpen ? 'rgba(34, 197, 94, 0.4)' : 'rgba(56, 189, 248, 0.4)');
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(ledX, ledY, 12, 0, Math.PI * 2);
      ctx.fill();

      // Solid LED diode bead
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ledX, ledY, 2, 0, Math.PI * 2);
      ctx.fill();

      // Tactical Door Designation Stencil
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      const label = isExit ? 'UNIT-02 EXIT' : 'AIRLOCK ENTRY';
      ctx.fillText(label, dx + dw / 2, dy + dh - 10);
    }

    ctx.restore();
  }

  /**
   * Interactive objects: Rope anchor bolt, deployed braided Manila rope,
   * and worn boost zone staging area.
   */
  private drawInteractiveFixtures(
    ctx: CanvasRenderingContext2D,
    campaign: ClientCampaignSync,
    now: number
  ): void {
    ctx.save();

    // 1. Worn Co-Op Boost Staging Zone on Floor (x: 256..448, y: 544)
    const bzX = 256;
    const bzW = 192;
    const bzY = 544;

    // Faded yellow industrial floor boundary lines
    ctx.strokeStyle = 'rgba(217, 119, 6, 0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.strokeRect(bzX, bzY - 60, bzW, 60);
    ctx.setLineDash([]);

    // Stenciled tactical floor text
    ctx.fillStyle = 'rgba(217, 119, 6, 0.7)';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ ELEVATION STAGING ZONE [W / SPACE]', bzX + bzW / 2, bzY - 10);

    // Directional chevron arrows indicating upward boost
    ctx.strokeStyle = 'rgba(217, 119, 6, 0.5)';
    ctx.lineWidth = 2;
    for (let ax = bzX + 36; ax < bzX + bzW; ax += 40) {
      ctx.beginPath();
      ctx.moveTo(ax - 6, bzY - 26);
      ctx.lineTo(ax, bzY - 34);
      ctx.lineTo(ax + 6, bzY - 26);
      ctx.stroke();
    }

    // 2. Heavy Forged Steel Rope Anchor Bolt at x=992, y=384
    const anchorX = 992;
    const anchorY = 384;
    const isDeployed = campaign.puzzleState.deployedMechanisms.includes('rope_anchor');

    // Steel circular mounting plate bolted to catwalk
    ctx.fillStyle = '#1e242c';
    ctx.beginPath();
    ctx.ellipse(anchorX, anchorY, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    this.mat.drawRivet(ctx, anchorX - 8, anchorY, 1.5);
    this.mat.drawRivet(ctx, anchorX + 8, anchorY, 1.5);

    // Cast-iron Eye-Bolt loop
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(anchorX, anchorY - 6, 5, 0, Math.PI * 2);
    ctx.stroke();

    // Specular highlight on top of ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(anchorX, anchorY - 8.5, 3, Math.PI * 0.8, Math.PI * 1.8);
    ctx.stroke();

    // Tactical Anchor Label
    if (!isDeployed) {
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚓ ROPE ANCHOR BOLT [E]', anchorX, anchorY - 18);
    }

    // 3. Deployed Braided Manila Hemp Climbing Rope
    if (isDeployed) {
      const ropeTopY = anchorY;
      const ropeBottomY = 544; // Touches the floor
      const ropeLen = ropeBottomY - ropeTopY;

      // Realistic helical 3-strand twisted hemp rope
      ctx.save();
      const ropeSway = Math.sin(now * 0.003) * 1.5;

      // Rope main core
      ctx.strokeStyle = '#92613b'; // Manila hemp golden brown
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(anchorX, ropeTopY);
      ctx.quadraticCurveTo(anchorX + ropeSway, ropeTopY + ropeLen / 2, anchorX, ropeBottomY);
      ctx.stroke();

      // Braided helical twists (twisted strand highlight lines)
      ctx.strokeStyle = '#c48f58';
      ctx.lineWidth = 1.5;
      for (let ry = ropeTopY + 4; ry < ropeBottomY; ry += 6) {
        const curSway = (Math.sin((ry / ropeLen) * Math.PI) * ropeSway);
        ctx.beginPath();
        ctx.moveTo(anchorX + curSway - 2, ry - 1.5);
        ctx.lineTo(anchorX + curSway + 2, ry + 1.5);
        ctx.stroke();
      }

      // Anchor knot lashed securely around eye-bolt
      ctx.fillStyle = '#784725';
      ctx.beginPath();
      ctx.arc(anchorX, ropeTopY - 2, 5, 0, Math.PI * 2);
      ctx.fill();

      // Heavy weighted steel teardrop thimble at bottom
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(anchorX, ropeBottomY - 2, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Cinematic ceiling fluorescent fixtures, downward volumetric light shafts,
   * and floating airborne dust motes.
   */
  private drawLightingPass(ctx: CanvasRenderingContext2D, now: number): void {
    // Overhead Fluorescent Fixtures at Room 1 ceiling
    // Fixture 1: Above bunk/boost zone (x: 320, y: 16)
    this.light.drawFluorescentFixture(ctx, 320, 16, 110, now);

    // Fixture 2: Above walkway and rope anchor (x: 992, y: 16)
    this.light.drawFluorescentFixture(ctx, 992, 16, 120, now);

    // Floating atmospheric dust motes
    this.light.updateAndDrawDustMotes(ctx, 1 / 60, now);
  }
}
