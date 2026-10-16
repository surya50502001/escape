import { ClientInput } from '../server/types.js';

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
    aimAngle: 0
  };

  public mouseX: number = 0;
  public mouseY: number = 0;
  private canvas: HTMLCanvasElement;
  private attackRequested: boolean = false;
  private tackleRequested: boolean = false;
  private interactRequested: boolean = false;
  private jumpRequested: boolean = false;
  private struggleRequested: boolean = false;
  private isSpaceDown: boolean = false;

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
      if (code === 'KeyS' || code === 'ArrowDown') this.input.down = true;

      if (code === 'KeyE') {
        this.interactRequested = true;
      }

      if (code === 'Space') {
        e.preventDefault();
        this.isSpaceDown = true;
        this.tackleRequested = true;
        this.struggleRequested = true;
      }

      if (code === 'KeyF') {
        this.tackleRequested = true;
        this.struggleRequested = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      if (code === 'KeyA' || code === 'ArrowLeft') this.input.left = false;
      if (code === 'KeyD' || code === 'ArrowRight') this.input.right = false;
      if (code === 'KeyW' || code === 'ArrowUp') this.input.up = false;
      if (code === 'KeyS' || code === 'ArrowDown') this.input.down = false;
      if (code === 'Space') this.isSpaceDown = false;
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      this.mouseX = (e.clientX - rect.left) * scaleX;
      this.mouseY = (e.clientY - rect.top) * scaleY;

      if ((window as unknown as { localPlayerX?: number; localPlayerY?: number }).localPlayerX !== undefined) {
        const px = (window as unknown as { localPlayerX: number }).localPlayerX;
        const py = (window as unknown as { localPlayerY: number }).localPlayerY;
        this.input.aimAngle = Math.atan2(this.mouseY - py, this.mouseX - px);
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.attackRequested = true;
      }
    });
  }

  public poll(): ClientInput {
    const payload: ClientInput = {
      ...this.input,
      attack: this.attackRequested,
      tackle: this.tackleRequested,
      pull: this.attackRequested || this.tackleRequested,
      climbKick: this.tackleRequested,
      climbGrab: this.isSpaceDown,
      struggle: this.struggleRequested,
      interact: this.interactRequested,
      jump: this.jumpRequested
    };

    this.attackRequested = false;
    this.tackleRequested = false;
    this.interactRequested = false;
    this.jumpRequested = false;
    this.struggleRequested = false;

    return payload;
  }
}
