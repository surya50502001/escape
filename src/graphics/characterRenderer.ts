import { Player } from '../../server/types.js';

export interface TeammatePalette {
  name: string;
  suitBase: string;
  suitLight: string;
  suitDark: string;
  suitSeam: string;
  skinTone: string;
  skinDark: string;
  hairTone: string;
  inmateNumber: string;
}

const PALETTES: Record<string, TeammatePalette> = {
  default: {
    name: 'Atlas',
    suitBase: '#254463', // State Penitentiary Slate/Denim
    suitLight: '#39638f',
    suitDark: '#16283b',
    suitSeam: '#0f1a26',
    skinTone: '#cf9972',
    skinDark: '#9e6d4c',
    hairTone: '#2b211b',
    inmateNumber: 'DOC-8142'
  },
  atlas: {
    name: 'Atlas',
    suitBase: '#254463',
    suitLight: '#39638f',
    suitDark: '#16283b',
    suitSeam: '#0f1a26',
    skinTone: '#cf9972',
    skinDark: '#9e6d4c',
    hairTone: '#2b211b',
    inmateNumber: 'DOC-8142'
  },
  beacon: {
    name: 'Beacon',
    suitBase: '#c2541a', // High-Security Hazard Orange
    suitLight: '#e66f2e',
    suitDark: '#853207',
    suitSeam: '#5c2204',
    skinTone: '#dfb18c',
    skinDark: '#b0815e',
    hairTone: '#1e1b18',
    inmateNumber: 'DOC-5091'
  },
  carter: {
    name: 'Carter',
    suitBase: '#61543e', // Minimum Security Khaki/Tan
    suitLight: '#827255',
    suitDark: '#423929',
    suitSeam: '#2b251b',
    skinTone: '#8d5534', // Rich warm dark skin tone
    skinDark: '#603920',
    hairTone: '#111111',
    inmateNumber: 'DOC-3320'
  },
  davis: {
    name: 'Davis',
    suitBase: '#3c4d42', // Forestry/Detention Olive Green
    suitLight: '#556d5e',
    suitDark: '#26332a',
    suitSeam: '#161e19',
    skinTone: '#ecc39a',
    skinDark: '#b8916b',
    hairTone: '#4a3728',
    inmateNumber: 'DOC-1904'
  }
};

export class CharacterRenderer {
  private static instance: CharacterRenderer | null = null;

  public static getInstance(): CharacterRenderer {
    if (!CharacterRenderer.instance) {
      CharacterRenderer.instance = new CharacterRenderer();
    }
    return CharacterRenderer.instance;
  }

  /**
   * Resolve distinct palette based on player name or ID.
   */
  public getPalette(p: Player): TeammatePalette {
    const key = (p.name || '').trim().toLowerCase();
    if (PALETTES[key]) return PALETTES[key];
    // Hash id into one of the 4 palettes for consistent visual identification
    let hash = 0;
    for (let i = 0; i < p.id.length; i++) hash = (hash + p.id.charCodeAt(i)) % 4;
    const keys = ['atlas', 'beacon', 'carter', 'davis'];
    return PALETTES[keys[hash]] || PALETTES.default;
  }

  /**
   * Draw fully animated, anatomically proportioned 2.5D realistic human prisoner.
   * Coordinate origin (0, 0) is at the center bottom of feet (p.x, p.y).
   */
  public drawPlayer(
    ctx: CanvasRenderingContext2D,
    p: Player,
    isLocal: boolean,
    now: number = performance.now()
  ): void {
    const pal = this.getPalette(p);
    const isFacingRight = p.facing === 'RIGHT';
    const dir = isFacingRight ? 1 : -1;

    ctx.save();
    ctx.translate(p.x, p.y);

    // 1. Dynamic Contact Shadow on Floor/Ledge
    this.drawContactShadow(ctx, p);

    // 2. Local Player Target Indicator (subtle tactical ring)
    if (isLocal) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Stunned visual effect (electric micro-arcs or head stars)
    if (p.state === 'STUNNED') {
      const starPhase = (now * 0.008) % (Math.PI * 2);
      ctx.fillStyle = '#facc15';
      for (let s = 0; s < 3; s++) {
        const ang = starPhase + (s * Math.PI * 2) / 3;
        const sx = Math.cos(ang) * 12;
        const sy = -45 + Math.sin(ang) * 4;
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }
    }

    // 4. Render Body based on physics state
    if (p.state === 'CLIMBING_LADDER' || p.state === 'CLIMBING_V_PIPE') {
      this.drawClimbingCharacter(ctx, p, pal, now);
    } else if (p.state === 'HANGING_H_PIPE') {
      this.drawHangingCharacter(ctx, p, pal, dir, now);
    } else {
      this.drawGroundOrAirCharacter(ctx, p, pal, dir, now);
    }

    // 5. Overhead Inmate Name Tag & Health Pip
    this.drawNameTag(ctx, p, pal, isLocal);

    ctx.restore();
  }

  /**
   * Soft, realistic ambient contact shadow directly underneath boots.
   */
  private drawContactShadow(ctx: CanvasRenderingContext2D, p: Player): void {
    const isGrounded = p.isGrounded && p.state === 'ON_FLOOR';
    const shadowAlpha = isGrounded ? 0.65 : Math.max(0.1, 0.45 - Math.abs(p.vy) * 0.0008);
    const shadowW = isGrounded ? 16 : Math.max(8, 16 - Math.abs(p.vy) * 0.015);
    const shadowH = isGrounded ? 5 : 3.5;

    // Contact shadow gradient
    const shadowGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, shadowW);
    shadowGrad.addColorStop(0, `rgba(0, 0, 0, ${shadowAlpha})`);
    shadowGrad.addColorStop(0.6, `rgba(0, 0, 0, ${shadowAlpha * 0.5})`);
    shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, shadowW, shadowH, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Normal ground movement (idle, walking, running) and airborne (jumping, falling).
   */
  private drawGroundOrAirCharacter(
    ctx: CanvasRenderingContext2D,
    p: Player,
    pal: TeammatePalette,
    dir: number,
    now: number
  ): void {
    const isRunning = p.state === 'ON_FLOOR' && Math.abs(p.vx) > 10;
    const isAirborne = p.state === 'FALLING' || !p.isGrounded;
    const isStunned = p.state === 'STUNNED';

    // Walk/run animation cycle
    const runCycle = isRunning ? (now * 0.018) % (Math.PI * 2) : 0;
    const breath = p.state === 'ON_FLOOR' ? Math.sin(now * 0.003) * 0.8 : 0;

    // Pelvis center position (height above ground)
    const pelvisY = isRunning ? -18 + Math.abs(Math.sin(runCycle)) * 1.5 : -18 + breath;
    const torsoLean = isRunning ? dir * 3.5 : isAirborne ? dir * 2 : isStunned ? dir * -2 : 0;

    // --- A. BACK LEG (Drawn behind torso) ---
    this.drawLeg(ctx, p, pal, dir, false, runCycle, pelvisY, isAirborne);

    // --- B. TORSO & PRISON JUMPSUIT ---
    this.drawTorso(ctx, p, pal, dir, pelvisY, torsoLean, breath);

    // --- C. HEAD, NECK & FACE ---
    this.drawHead(ctx, p, pal, dir, pelvisY, torsoLean, breath);

    // --- D. FRONT LEG (Drawn in front of torso) ---
    this.drawLeg(ctx, p, pal, dir, true, runCycle, pelvisY, isAirborne);

    // --- E. ARMS & HANDS (Drawn on top for correct depth) ---
    this.drawArms(ctx, p, pal, dir, pelvisY, torsoLean, runCycle, isAirborne, now);
  }

  /**
   * Anatomical leg with thigh, knee articulation, shin, and heavy work boot with lugged tread.
   */
  private drawLeg(
    ctx: CanvasRenderingContext2D,
    p: Player,
    pal: TeammatePalette,
    dir: number,
    isFront: boolean,
    runCycle: number,
    pelvisY: number,
    isAirborne: boolean
  ): void {
    ctx.save();

    // Hip joint anchor
    const hipX = isFront ? dir * 2 : dir * -2;
    const hipY = pelvisY + 1;

    let thighAngle = 0;
    let kneeAngle = 0;
    let bootX = hipX;
    let bootY = 0;

    if (p.state === 'ON_FLOOR' && Math.abs(p.vx) > 10) {
      // Kinematic running cycle (heel strike -> stance -> toe off)
      const phase = isFront ? runCycle : runCycle + Math.PI;
      thighAngle = Math.sin(phase) * 0.65;
      kneeAngle = Math.max(0, -Math.sin(phase)) * 0.9;

      const kneeX = hipX + Math.sin(thighAngle) * 9 * dir;
      const kneeY = hipY + Math.cos(thighAngle) * 9;

      bootX = kneeX + Math.sin(thighAngle - kneeAngle) * 9 * dir;
      bootY = Math.min(0, kneeY + Math.cos(thighAngle - kneeAngle) * 9);
    } else if (isAirborne) {
      // Tucked jump legs when rising, extended when falling
      if (p.vy < 0) {
        thighAngle = isFront ? 0.45 : 0.25;
        kneeAngle = 0.85;
        bootX = hipX + dir * (isFront ? 6 : -3);
        bootY = -4;
      } else {
        // Falling extension
        thighAngle = isFront ? 0.15 : -0.2;
        kneeAngle = 0.3;
        bootX = hipX + dir * (isFront ? 4 : -4);
        bootY = -2;
      }
    } else {
      // Idle standing stance: feet placed on floor (y=0)
      bootX = isFront ? dir * 4 : dir * -3;
      bootY = 0;
    }

    // Knee position
    const midX = (hipX + bootX) / 2 + dir * (isFront ? 2 : 1);
    const midY = (hipY + bootY) / 2;

    // Trouser fabric tone (back leg shaded darker for 2.5D depth)
    const legColor = isFront ? pal.suitBase : pal.suitDark;
    const foldColor = pal.suitSeam;

    // Upper Thigh
    ctx.strokeStyle = legColor;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(midX, midY);
    ctx.stroke();

    // Lower Shin/Calf with trouser cuff
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(bootX, bootY - 3);
    ctx.stroke();

    // Fabric wrinkle creases
    ctx.strokeStyle = foldColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(midX - 1.5, midY - 1);
    ctx.lineTo(midX + 1.5, midY + 1);
    ctx.stroke();

    // Heavy Leather Prison Utility Boot
    this.drawBoot(ctx, bootX, bootY, dir, isFront);

    ctx.restore();
  }

  /**
   * Detailed prison work boot: dark leather upper, reinforced toe box, thick sole and tread.
   */
  private drawBoot(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, isFront: boolean): void {
    ctx.save();
    ctx.translate(x, y);

    const bootBase = isFront ? '#1c1917' : '#0c0a09';
    const soleColor = '#000000';
    const highlight = 'rgba(255, 255, 255, 0.12)';

    // Thick rubber tread sole (sits precisely on surface y=0)
    ctx.fillStyle = soleColor;
    ctx.fillRect(dir > 0 ? -4 : -5, -2, 9, 2);

    // Lugged tread notches
    ctx.fillStyle = '#292524';
    ctx.fillRect(dir > 0 ? -3 : 2, -1, 2, 1);
    ctx.fillRect(dir > 0 ? 1 : -4, -1, 2, 1);

    // Leather boot upper
    ctx.fillStyle = bootBase;
    ctx.beginPath();
    ctx.moveTo(dir > 0 ? -3 : 3, -6); // Heel back
    ctx.lineTo(dir > 0 ? 0 : 0, -6);  // Ankle front
    ctx.lineTo(dir > 0 ? 4 : -4, -2); // Rounded toe tip
    ctx.lineTo(dir > 0 ? -4 : 4, -2); // Heel bottom
    ctx.closePath();
    ctx.fill();

    // Leather specular highlight on toe cap
    ctx.fillStyle = highlight;
    ctx.fillRect(dir > 0 ? 1 : -3, -4, 2.5, 1.5);

    ctx.restore();
  }

  /**
   * Anatomical torso with prison jumpsuit, collar, fabric folds, and inmate serial number.
   */
  private drawTorso(
    ctx: CanvasRenderingContext2D,
    p: Player,
    pal: TeammatePalette,
    dir: number,
    pelvisY: number,
    torsoLean: number,
    breath: number
  ): void {
    ctx.save();
    ctx.translate(torsoLean, 0);

    const chestY = pelvisY - 12 + breath * 0.4;
    const waistY = pelvisY;

    // Main Jumpsuit Body (Polygon with natural anatomical curve)
    ctx.fillStyle = pal.suitBase;
    ctx.beginPath();
    ctx.moveTo(-5.5 * dir, chestY); // Back shoulder
    ctx.lineTo(6.5 * dir, chestY);  // Front chest
    ctx.lineTo(5 * dir, waistY);    // Front waist
    ctx.lineTo(-4.5 * dir, waistY); // Back waist
    ctx.closePath();
    ctx.fill();

    // Top shoulder specular highlight
    ctx.fillStyle = pal.suitLight;
    ctx.beginPath();
    ctx.moveTo(-5.5 * dir, chestY);
    ctx.lineTo(6.5 * dir, chestY);
    ctx.lineTo(5.5 * dir, chestY + 2.5);
    ctx.lineTo(-5 * dir, chestY + 2.5);
    ctx.closePath();
    ctx.fill();

    // Fabric fold shading under chest and waist
    ctx.strokeStyle = pal.suitDark;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-3 * dir, chestY + 6);
    ctx.lineTo(4 * dir, chestY + 7);
    ctx.moveTo(-3.5 * dir, chestY + 10);
    ctx.lineTo(3.5 * dir, chestY + 11);
    ctx.stroke();

    // Inmate serial number patch on back/chest
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(-2 * dir, chestY + 4, 4 * dir, 3);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 3px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('0451', 0, chestY + 6.5);

    // Collar V-neck
    ctx.strokeStyle = pal.suitSeam;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(3 * dir, chestY);
    ctx.lineTo(4.5 * dir, chestY + 3);
    ctx.lineTo(6 * dir, chestY);
    ctx.stroke();

    // Exposed neck skin in collar notch
    ctx.fillStyle = pal.skinDark;
    ctx.beginPath();
    ctx.moveTo(3.5 * dir, chestY);
    ctx.lineTo(4.5 * dir, chestY + 2.5);
    ctx.lineTo(5.5 * dir, chestY);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * Anatomical head with realistic skull shape, brow, nose, jawline, ears, buzzcut, and stubble.
   */
  private drawHead(
    ctx: CanvasRenderingContext2D,
    p: Player,
    pal: TeammatePalette,
    dir: number,
    pelvisY: number,
    torsoLean: number,
    breath: number
  ): void {
    ctx.save();
    ctx.translate(torsoLean * 1.15, 0);

    const neckY = pelvisY - 13 + breath * 0.5;
    const headY = neckY - 7.5;

    // Neck with muscle tendon shading
    ctx.fillStyle = pal.skinDark;
    ctx.fillRect(dir * 1 - 2, neckY - 2.5, 4, 3.5);

    // Head Silhouette (Realistic human head profile)
    ctx.fillStyle = pal.skinTone;
    ctx.beginPath();
    // Start at back of skull
    ctx.moveTo(-3.5 * dir, headY + 1);
    ctx.quadraticCurveTo(-4.5 * dir, headY - 4, -1 * dir, headY - 5.5); // Top crown
    ctx.lineTo(2.5 * dir, headY - 5);   // Brow ridge
    ctx.lineTo(4.5 * dir, headY - 2.5); // Nose bridge protrusion
    ctx.lineTo(3.2 * dir, headY - 1.5); // Philtrum
    ctx.lineTo(3.8 * dir, headY);       // Chin tip
    ctx.lineTo(1 * dir, headY + 2.5);   // Jawline
    ctx.lineTo(-2.5 * dir, headY + 2);  // Under skull base
    ctx.closePath();
    ctx.fill();

    // Jawline & cheekbone shadow
    ctx.strokeStyle = pal.skinDark;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(1 * dir, headY + 2.2);
    ctx.lineTo(-2 * dir, headY + 1.5);
    ctx.stroke();

    // Buzzcut / Military crew cut prison hair
    ctx.fillStyle = pal.hairTone;
    ctx.beginPath();
    ctx.moveTo(-3.5 * dir, headY + 0.5);
    ctx.quadraticCurveTo(-4.5 * dir, headY - 4.2, -1 * dir, headY - 5.6);
    ctx.lineTo(2.5 * dir, headY - 5.1);
    ctx.lineTo(2.2 * dir, headY - 3.8); // Hairline temple
    ctx.lineTo(-2 * dir, headY - 3.2);  // Fade line
    ctx.closePath();
    ctx.fill();

    // 5 o'clock stubble shadow on jaw and chin
    ctx.fillStyle = 'rgba(30, 20, 15, 0.22)';
    ctx.beginPath();
    ctx.arc(2.5 * dir, headY + 0.5, 2, 0, Math.PI * 2);
    ctx.fill();

    // Realistic Ear
    ctx.fillStyle = pal.skinDark;
    ctx.beginPath();
    ctx.ellipse(-1 * dir, headY - 0.5, 1.2, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.skinTone;
    ctx.fillRect(-1 * dir - 0.4, headY - 1, 0.8, 1.2);

    // Eye socket depth & pupil (directed in facing vector)
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(dir > 0 ? 2.2 : -2.6, headY - 3.2, 1.2, 1);

    ctx.restore();
  }

  /**
   * Anatomical arms: deltoid shoulder, bicep, forearm, wrist cuffs, hands with gripping fingers.
   */
  private drawArms(
    ctx: CanvasRenderingContext2D,
    p: Player,
    pal: TeammatePalette,
    dir: number,
    pelvisY: number,
    torsoLean: number,
    runCycle: number,
    isAirborne: boolean,
    now: number
  ): void {
    ctx.save();
    ctx.translate(torsoLean, 0);

    const shoulderX = 1 * dir;
    const shoulderY = pelvisY - 11;

    let elbowX = shoulderX;
    let elbowY = shoulderY + 7;
    let handX = shoulderX + dir * 3;
    let handY = shoulderY + 12;

    if (p.state === 'ON_FLOOR' && Math.abs(p.vx) > 10) {
      // Natural running arm pump in opposition to legs
      const armSwing = Math.sin(runCycle) * 7;
      elbowX = shoulderX - armSwing * dir * 0.7;
      elbowY = shoulderY + 5 + Math.abs(armSwing) * 0.3;
      handX = elbowX + dir * (4 + armSwing * 0.5);
      handY = elbowY + 4;
    } else if (isAirborne) {
      // Airborne stabilization arms
      elbowX = shoulderX - dir * 4;
      elbowY = shoulderY + 3;
      handX = elbowX - dir * 3;
      handY = elbowY + 3;
    } else {
      // Idle natural arm hang
      elbowX = shoulderX + dir * 1;
      elbowY = shoulderY + 6.5;
      handX = shoulderX + dir * 2;
      handY = shoulderY + 12;
    }

    // Upper sleeve (prison jumpsuit fabric)
    ctx.strokeStyle = pal.suitBase;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(elbowX, elbowY);
    ctx.stroke();

    // Sleeve cuff seam
    ctx.strokeStyle = pal.suitSeam;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(elbowX, elbowY, 2, 0, Math.PI * 2);
    ctx.stroke();

    // Bare Forearm (realistic skin tone with muscle contour)
    ctx.strokeStyle = pal.skinTone;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.stroke();

    // Hand with fingers/knuckles
    ctx.fillStyle = pal.skinTone;
    ctx.beginPath();
    ctx.arc(handX, handY, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Finger curl shadow
    ctx.fillStyle = pal.skinDark;
    ctx.fillRect(handX - 0.5, handY - 0.5, 1.2, 1.2);

    ctx.restore();
  }

  /**
   * Realistic climbing pose (ladders and vertical pipes): 3/4 rear-side angle with
   * alternating hand reach and foot push.
   */
  private drawClimbingCharacter(
    ctx: CanvasRenderingContext2D,
    p: Player,
    pal: TeammatePalette,
    now: number
  ): void {
    const climbPhase = (p.y * 0.08 + now * 0.005) % (Math.PI * 2);
    const leftArmUp = Math.sin(climbPhase) > 0;

    // Pelvis
    const pelvisY = -18;

    // Back-facing Torso (broad shoulders, visible shoulder blades and back seam)
    ctx.fillStyle = pal.suitBase;
    ctx.beginPath();
    ctx.moveTo(-6, pelvisY - 12);
    ctx.lineTo(6, pelvisY - 12);
    ctx.lineTo(4.5, pelvisY);
    ctx.lineTo(-4.5, pelvisY);
    ctx.closePath();
    ctx.fill();

    // Central back spinal seam line
    ctx.strokeStyle = pal.suitSeam;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, pelvisY - 12);
    ctx.lineTo(0, pelvisY);
    ctx.stroke();

    // Back of Head (crew cut buzzcut scalp)
    ctx.fillStyle = pal.hairTone;
    ctx.beginPath();
    ctx.arc(0, pelvisY - 18, 5, 0, Math.PI * 2);
    ctx.fill();

    // Neck
    ctx.fillStyle = pal.skinDark;
    ctx.fillRect(-2, pelvisY - 14, 4, 3);

    // Left Arm (Reaching up or gripping)
    const lHandY = leftArmUp ? pelvisY - 26 : pelvisY - 14;
    ctx.strokeStyle = pal.suitBase;
    ctx.lineWidth = 3.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-5, pelvisY - 11);
    ctx.lineTo(-8, pelvisY - 18);
    ctx.stroke();

    ctx.strokeStyle = pal.skinTone;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, pelvisY - 18);
    ctx.lineTo(-4, lHandY);
    ctx.stroke();

    // Left Hand gripping rung
    ctx.fillStyle = pal.skinTone;
    ctx.beginPath();
    ctx.arc(-4, lHandY, 2, 0, Math.PI * 2);
    ctx.fill();

    // Right Arm (Opposite phase)
    const rHandY = !leftArmUp ? pelvisY - 26 : pelvisY - 14;
    ctx.strokeStyle = pal.suitBase;
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.moveTo(5, pelvisY - 11);
    ctx.lineTo(8, pelvisY - 18);
    ctx.stroke();

    ctx.strokeStyle = pal.skinTone;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(8, pelvisY - 18);
    ctx.lineTo(4, rHandY);
    ctx.stroke();

    // Right Hand gripping rung
    ctx.fillStyle = pal.skinTone;
    ctx.beginPath();
    ctx.arc(4, rHandY, 2, 0, Math.PI * 2);
    ctx.fill();

    // Legs on Rungs (Alternating foot step)
    const lBootY = leftArmUp ? -2 : -8;
    const rBootY = !leftArmUp ? -2 : -8;

    // Left Leg
    ctx.strokeStyle = pal.suitDark;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(-3, pelvisY);
    ctx.lineTo(-5, (pelvisY + lBootY) / 2);
    ctx.lineTo(-3, lBootY - 3);
    ctx.stroke();
    this.drawBoot(ctx, -3, lBootY, 1, false);

    // Right Leg
    ctx.strokeStyle = pal.suitBase;
    ctx.beginPath();
    ctx.moveTo(3, pelvisY);
    ctx.lineTo(5, (pelvisY + rBootY) / 2);
    ctx.lineTo(3, rBootY - 3);
    ctx.stroke();
    this.drawBoot(ctx, 3, rBootY, -1, true);
  }

  /**
   * Hanging from horizontal overhead ceiling pipe.
   */
  private drawHangingCharacter(
    ctx: CanvasRenderingContext2D,
    p: Player,
    pal: TeammatePalette,
    dir: number,
    now: number
  ): void {
    const swing = Math.sin(now * 0.006) * 3;

    // Both hands reach up to pipe at y = -24
    ctx.fillStyle = pal.skinTone;
    ctx.fillRect(-3, -24, 6, 3); // Hands clutching pipe

    // Arms extended straight down to shoulders
    ctx.strokeStyle = pal.skinTone;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-2, -22);
    ctx.lineTo(-4, -14);
    ctx.moveTo(2, -22);
    ctx.lineTo(4, -14);
    ctx.stroke();

    // Head tilted up looking forward
    ctx.fillStyle = pal.hairTone;
    ctx.beginPath();
    ctx.arc(0, -18, 5, 0, Math.PI * 2);
    ctx.fill();

    // Hanging Torso swinging slightly
    ctx.save();
    ctx.translate(swing * 0.5, 0);

    ctx.fillStyle = pal.suitBase;
    ctx.fillRect(-5, -13, 10, 14);

    // Dangling Legs
    ctx.strokeStyle = pal.suitBase;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(-2, 1);
    ctx.lineTo(-2 + swing * 0.3, 10);
    ctx.moveTo(2, 1);
    ctx.lineTo(2 + swing * 0.3, 9);
    ctx.stroke();

    this.drawBoot(ctx, -2 + swing * 0.3, 12, dir, false);
    this.drawBoot(ctx, 2 + swing * 0.3, 11, dir, true);

    ctx.restore();
  }

  /**
   * Clean, high-legibility tactical overhead name tag and health indicator.
   */
  private drawNameTag(
    ctx: CanvasRenderingContext2D,
    p: Player,
    pal: TeammatePalette,
    isLocal: boolean
  ): void {
    const tagY = -48;
    const nameText = p.name || pal.name;

    ctx.font = 'bold 10px monospace';
    const textW = ctx.measureText(nameText).width;
    const badgeW = Math.max(36, textW + 12);

    // Pill background
    ctx.fillStyle = isLocal ? 'rgba(8, 47, 73, 0.88)' : 'rgba(15, 23, 42, 0.82)';
    ctx.fillRect(-badgeW / 2, tagY - 11, badgeW, 14);
    ctx.strokeStyle = isLocal ? '#38bdf8' : 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-badgeW / 2, tagY - 11, badgeW, 14);

    // Name text
    ctx.fillStyle = isLocal ? '#7dd3fc' : '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(nameText, 0, tagY);

    // Small health pip bar underneath
    const healthW = badgeW - 6;
    const healthPct = Math.max(0, Math.min(1, p.health / 100));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(-healthW / 2, tagY + 4, healthW, 2.5);
    ctx.fillStyle = healthPct > 0.5 ? '#22c55e' : healthPct > 0.25 ? '#eab308' : '#ef4444';
    ctx.fillRect(-healthW / 2, tagY + 4, healthW * healthPct, 2.5);
  }
}
