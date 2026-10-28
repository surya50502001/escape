import * as THREE from 'three';
import { ClientCampaignSync } from '../../server/campaign/campaignSession.js';
import { GameState } from '../../server/types.js';
import { CharacterModelManager } from './characterModelManager.js';
import { CampaignRoomThreeEnvironment } from './campaignRoomThree.js';

export class ThreeGameRenderer {
  public static instance: ThreeGameRenderer | null = null;
  private canvas: HTMLCanvasElement;
  public renderer: THREE.WebGLRenderer | null = null;
  public scene: THREE.Scene;
  public camera: THREE.OrthographicCamera;
  public roomEnv: CampaignRoomThreeEnvironment;
  public charManager: CharacterModelManager;

  public cameraX: number = 500;
  public cameraY: number = 350;
  private targetCameraX: number = 500;
  private targetCameraY: number = 350;
  private width: number = 1000;
  private height: number = 700;

  private isInitialized: boolean = false;
  private initError: Error | null = null;
  private lastTime: number = performance.now();
  public onStatusChange?: () => void;

  public static getInstance(canvas?: HTMLCanvasElement): ThreeGameRenderer {
    if (!ThreeGameRenderer.instance) {
      if (!canvas) throw new Error('Canvas required to create ThreeGameRenderer');
      ThreeGameRenderer.instance = new ThreeGameRenderer(canvas);
    }
    return ThreeGameRenderer.instance;
  }

  constructor(canvas: HTMLCanvasElement) {
    (window as any).THREE = THREE;
    this.canvas = canvas;
    this.width = canvas.width || 1000;
    this.height = canvas.height || 700;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090d);

    // 2.5D Orthographic Camera — zoom factor 1.6 brings characters ~60% closer
    const zoom = 1.6;
    const halfW = (this.width / 2) / zoom;
    const halfH = (this.height / 2) / zoom;
    this.camera = new THREE.OrthographicCamera(
      -halfW, halfW,
      halfH, -halfH,
      0.1, 2500
    );
    this.camera.position.set(500, -350, 1000);
    this.camera.lookAt(500, -350, 0);

    // 3D Environment & Characters
    this.roomEnv = new CampaignRoomThreeEnvironment();
    this.scene.add(this.roomEnv.group);

    this.charManager = CharacterModelManager.getInstance();

    this.initWebGL();
  }

  private initWebGL(): void {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(this.width, this.height, false);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      this.charManager.init(this.scene)
        .then(() => {
          this.onStatusChange?.();
        })
        .catch((err) => {
          console.warn('[Three.js 2.5D] Character model loading error:', err);
          this.onStatusChange?.();
        });

      this.isInitialized = true;
      console.log('[Three.js 2.5D] WebGL2 Renderer initialized successfully');
      this.onStatusChange?.();
    } catch (err) {
      this.initError = err instanceof Error ? err : new Error(String(err));
      console.error('[Three.js 2.5D] WebGL initialization failed:', err);
      this.isInitialized = false;
      this.onStatusChange?.();
    }
  }

  public isWebGLSupported(): boolean {
    return this.isInitialized && this.renderer !== null && this.initError === null;
  }

  public isAssetLoading(): boolean {
    return this.isWebGLSupported() && this.charManager.getIsLoading();
  }

  public hasAssetError(): boolean {
    return !this.isWebGLSupported() || this.charManager.getLoadError() !== null;
  }

  public getAssetErrorMessage(): string | null {
    if (this.initError) return this.initError.message;
    if (this.charManager.getLoadError()) return this.charManager.getLoadError()!.message;
    return null;
  }

  public isReady(): boolean {
    return this.isWebGLSupported() && this.charManager.getIsReady();
  }

  public renderCampaign(campaign: ClientCampaignSync, localPlayerId: string): void {
    if (!this.isReady() || !this.renderer) return;

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const roomW = campaign.roomWidth || 1600;
    const roomH = campaign.roomHeight || 640;

    // 1. Camera Tracking (follows local player)
    const localPlayer = campaign.players.find(p => p.id === localPlayerId);
    if (localPlayer) {
      this.targetCameraX = localPlayer.x;
      this.targetCameraY = localPlayer.y - 40; // slightly above feet
    } else {
      this.targetCameraX = roomW / 2;
      this.targetCameraY = roomH / 2;
    }

    // Clamp camera within room bounds (respecting 1.6x zoom frustum)
    const zoom = 1.6;
    const halfW = (this.width / 2) / zoom;
    const halfH = (this.height / 2) / zoom;
    const minCamX = halfW;
    const maxCamX = Math.max(minCamX, roomW - halfW);
    const minCamY = halfH;
    const maxCamY = Math.max(minCamY, roomH - halfH);

    this.targetCameraX = Math.max(minCamX, Math.min(maxCamX, this.targetCameraX));
    this.targetCameraY = Math.max(minCamY, Math.min(maxCamY, this.targetCameraY));

    // Smooth camera lerp
    this.cameraX += (this.targetCameraX - this.cameraX) * 0.1;
    this.cameraY += (this.targetCameraY - this.cameraY) * 0.1;

    // Update camera in Three.js space (Y is inverted)
    this.camera.position.set(this.cameraX, -this.cameraY, 1000);
    this.camera.lookAt(this.cameraX, -this.cameraY, 0);

    // 2. Update 3D Prison Environment State (Supports all campaign rooms)
    this.roomEnv.update(campaign);

    // 3. Update & Animate 3D Human Characters
    this.charManager.updatePlayers(campaign.players, dt, campaign.teamRoster);

    // 4. Render 3D Scene
    this.renderer.render(this.scene, this.camera);
  }

  public renderSurvival(state: GameState, localPlayerId: string): void {
    if (!this.isReady() || !this.renderer) return;

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const localPlayer = state.players.find(p => p.id === localPlayerId);
    if (localPlayer) {
      this.targetCameraX = localPlayer.x;
      this.targetCameraY = localPlayer.y - 40;
    }

    this.cameraX += (this.targetCameraX - this.cameraX) * 0.1;
    this.cameraY += (this.targetCameraY - this.cameraY) * 0.1;

    this.camera.position.set(this.cameraX, -this.cameraY, 1000);
    this.camera.lookAt(this.cameraX, -this.cameraY, 0);

    this.charManager.updatePlayers(state.players, dt);
    this.renderer.render(this.scene, this.camera);
  }

  public getCameraX(): number {
    return this.cameraX - this.width / 2;
  }

  public getCameraY(): number {
    return this.cameraY - this.height / 2;
  }
}
