import { ClientInput } from '../server/types.js';

export class InputManager {
  public input: ClientInput = {
    up: false,
    down: false,
    left: false,
    right: false,
    aimAngle: 0,
    attack: false,
    tackle: false,
    interact: false
  };

  private canvas: HTMLCanvasElement;
  private attackRequested: boolean = false;
  private tackleRequested: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bindEvents();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') this.input.up = true;
      if (code === 'KeyS' || code === 'ArrowDown') this.input.down = true;
      if (code === 'KeyA' || code === 'ArrowLeft') this.input.left = true;
      if (code === 'KeyD' || code === 'ArrowRight') this.input.right = true;
      if (code === 'Space') {
        e.preventDefault();
        this.tackleRequested = true;
        this.input.interact = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') this.input.up = false;
      if (code === 'KeyS' || code === 'ArrowDown') this.input.down = false;
      if (code === 'KeyA' || code === 'ArrowLeft') this.input.left = false;
      if (code === 'KeyD' || code === 'ArrowRight') this.input.right = false;
      if (code === 'Space') {
        this.input.interact = false;
      }
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      // Account for canvas scaling
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      // We need player's screen position to compute angle
      if ((window as unknown as { localPlayerX?: number; localPlayerY?: number }).localPlayerX !== undefined) {
        const px = (window as unknown as { localPlayerX: number }).localPlayerX;
        const py = (window as unknown as { localPlayerY: number }).localPlayerY;
        this.input.aimAngle = Math.atan2(mouseY - py, mouseX - px);
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
      tackle: this.tackleRequested
    };
    // Reset momentary triggers
    this.attackRequested = false;
    this.tackleRequested = false;
    return payload;
  }
}
