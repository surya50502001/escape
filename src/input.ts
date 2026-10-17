import { ClientInput } from '../server/types.js';

export function clientToCanvasCoordinates(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

export class InputManager {
  public input: ClientInput = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    interact: false,
    attack: false,
    tackle: false,
    pull: false,
    climbKick: false,
    climbGrab: false,
    struggle: false,
    aimAngle: 0
  };

  public mouseX: number = 0;
  public mouseY: number = 0;
  private rawClientX: number = 0;
  private rawClientY: number = 0;
  private canvas: HTMLCanvasElement;

  private attackRequested: boolean = false;
  private pullRequested: boolean = false;
  private tackleRequested: boolean = false;
  private interactRequested: boolean = false;
  private jumpRequested: boolean = false;
  private struggleRequested: boolean = false;

  private isSpaceDown: boolean = false;
  private spacePressTime: number = 0;
  private spaceTapRequested: boolean = false;
  private isMouseDown: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bindEvents();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (code === 'KeyA' || code === 'ArrowLeft') this.input.left = true;
      if (code === 'KeyD' || code === 'ArrowRight') this.input.right = true;
      if (code === 'KeyW' || code === 'ArrowUp') {
        this.input.up = true;
        this.jumpRequested = true;
        this.struggleRequested = true;
      }
      if (code === 'KeyS' || code === 'ArrowDown') {
        this.input.down = true;
      }

      if (code === 'KeyE') {
        this.interactRequested = true;
      }

      if (code === 'Space') {
        e.preventDefault();
        if (!this.isSpaceDown) {
          this.isSpaceDown = true;
          this.spacePressTime = performance.now();
          this.struggleRequested = true;
        }
      }

      if (code === 'KeyF') {
        this.tackleRequested = true;
        this.pullRequested = true;
        this.struggleRequested = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      if (code === 'KeyA' || code === 'ArrowLeft') this.input.left = false;
      if (code === 'KeyD' || code === 'ArrowRight') this.input.right = false;
      if (code === 'KeyW' || code === 'ArrowUp') this.input.up = false;
      if (code === 'KeyS' || code === 'ArrowDown') this.input.down = false;

      if (code === 'Space') {
        this.isSpaceDown = false;
        const holdDuration = performance.now() - this.spacePressTime;
        if (holdDuration < 220) {
          this.spaceTapRequested = true;
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      this.rawClientX = e.clientX;
      this.rawClientY = e.clientY;
      const coords = clientToCanvasCoordinates(e.clientX, e.clientY, this.canvas);
      const cameraX = (window as unknown as { cameraX?: number }).cameraX ?? 0;
      const cameraY = (window as unknown as { cameraY?: number }).cameraY ?? 0;
      this.mouseX = coords.x + cameraX;
      this.mouseY = coords.y + cameraY;

      const px = (window as unknown as { localPlayerX?: number }).localPlayerX;
      const py = (window as unknown as { localPlayerY?: number }).localPlayerY;
      if (px !== undefined && py !== undefined) {
        this.input.aimAngle = Math.atan2(this.mouseY - py, this.mouseX - px);
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        const isRopeAttached = (window as unknown as { isRopeAttachedToMe?: boolean }).isRopeAttachedToMe;
        if (isRopeAttached) {
          this.pullRequested = true;
        } else {
          this.attackRequested = true;
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isMouseDown = false;
      }
    });
  }

  public poll(localPlayerX?: number, localPlayerY?: number): ClientInput {
    // Recalculate aim direction using latest player & mouse position
    const px = localPlayerX ?? (window as unknown as { localPlayerX?: number }).localPlayerX;
    const py = localPlayerY ?? (window as unknown as { localPlayerY?: number }).localPlayerY;
    if (px !== undefined && py !== undefined) {
      if (this.rawClientX !== 0 || this.rawClientY !== 0) {
        const coords = clientToCanvasCoordinates(this.rawClientX, this.rawClientY, this.canvas);
        const cameraX = (window as unknown as { cameraX?: number }).cameraX ?? 0;
        const cameraY = (window as unknown as { cameraY?: number }).cameraY ?? 0;
        this.mouseX = coords.x + cameraX;
        this.mouseY = coords.y + cameraY;
      }
      this.input.aimAngle = Math.atan2(this.mouseY - py, this.mouseX - px);
    }

    const isRopeAttached = (window as unknown as { isRopeAttachedToMe?: boolean }).isRopeAttachedToMe;
    const holdingGrab = this.isSpaceDown && (performance.now() - this.spacePressTime >= 180);

    const payload: ClientInput = {
      ...this.input,
      attack: this.attackRequested,
      tackle: this.spaceTapRequested || this.tackleRequested,
      pull: this.pullRequested || (this.isMouseDown && Boolean(isRopeAttached)),
      climbKick: this.spaceTapRequested,
      climbGrab: holdingGrab,
      struggle: this.struggleRequested,
      interact: this.interactRequested,
      jump: this.jumpRequested
    };

    this.attackRequested = false;
    this.pullRequested = false;
    this.tackleRequested = false;
    this.spaceTapRequested = false;
    this.interactRequested = false;
    this.jumpRequested = false;
    this.struggleRequested = false;

    return payload;
  }
}
