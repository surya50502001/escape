import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Player } from '../../server/types.js';

export interface Player3DInstance {
  id: string;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  currentActionName: string;
  visualX: number;
  visualY: number;
  targetX: number;
  targetY: number;
}

const PLAYER_PALETTES: Record<string, { bodyColor: number; emissive: number }> = {
  atlas: { bodyColor: 0x93c5fd, emissive: 0x051329 },   // Slate / Denim blue prison uniform
  beacon: { bodyColor: 0xfb923c, emissive: 0x220c02 },  // Hazard orange prison jumpsuit
  carter: { bodyColor: 0xfde047, emissive: 0x1c1704 },  // Detention khaki
  davis: { bodyColor: 0x86efac, emissive: 0x051a0b },   // Prison olive green
  default: { bodyColor: 0x93c5fd, emissive: 0x051329 }
};

export class CharacterModelManager {
  private static instance: CharacterModelManager | null = null;
  private loader: GLTFLoader;
  public baseGltf: any = null;
  public isLoaded: boolean = false;
  public loadError: Error | null = null;
  public playerInstances: Map<string, Player3DInstance> = new Map();
  public scene: THREE.Scene | null = null;

  public static getInstance(): CharacterModelManager {
    if (!CharacterModelManager.instance) {
      CharacterModelManager.instance = new CharacterModelManager();
    }
    return CharacterModelManager.instance;
  }

  constructor() {
    this.loader = new GLTFLoader();
  }

  public init(scene: THREE.Scene): Promise<void> {
    this.scene = scene;
    if (this.isLoaded) return Promise.resolve();
    if (this.loadError) return Promise.reject(this.loadError);

    return new Promise((resolve, reject) => {
      this.loader.load(
        '/models/Soldier.glb',
        (gltf) => {
          this.baseGltf = gltf;
          this.isLoaded = true;
          console.log('[Three.js 2.5D] Successfully loaded realistic humanoid character model (Soldier.glb)');
          resolve();
        },
        undefined,
        (err) => {
          this.loadError = err instanceof Error ? err : new Error(String(err));
          console.error('[Three.js 2.5D] Failed to load 3D character model:', err);
          reject(this.loadError);
        }
      );
    });
  }

  public getIsReady(): boolean {
    return this.isLoaded && this.baseGltf !== null;
  }

  /**
   * Synchronize active 3D character instances with authoritative server players.
   */
  public updatePlayers(players: Player[], dt: number): void {
    if (!this.isLoaded || !this.scene || !this.baseGltf) return;

    const activeIds = new Set(players.map(p => p.id));

    // Remove disconnected players
    for (const [id, inst] of this.playerInstances.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(inst.root);
        this.playerInstances.delete(id);
      }
    }

    // Update or spawn each player
    for (const p of players) {
      if (p.state === 'DEAD' || p.hasEscaped) {
        const inst = this.playerInstances.get(p.id);
        if (inst) {
          inst.root.visible = false;
        }
        continue;
      }

      let inst = this.playerInstances.get(p.id);
      if (!inst) {
        const created = this.createPlayerInstance(p);
        if (created) {
          inst = created;
          this.playerInstances.set(p.id, inst);
          this.scene.add(inst.root);
        }
      }

      if (inst) {
        inst.root.visible = true;
        this.updateInstancePhysicsAndAnimation(inst, p, dt);
      }
    }
  }

  /**
   * Instantiate and configure a rigged 3D character for a player.
   */
  private createPlayerInstance(p: Player): Player3DInstance | null {
    try {
      const clonedScene = SkeletonUtils.clone(this.baseGltf.scene) as THREE.Group;

      // Scale model so height is precisely 42 pixels (server player collision envelope is 42 px tall)
      // Soldier.glb has a natural height of 1.8322 units with feet at Y=0 and head at Y=1.8322.
      const targetHeight = 42; // pixels
      const naturalHeight = 1.8322; // model units
      const scale = targetHeight / naturalHeight; // 22.923
      clonedScene.scale.set(scale, scale, scale);

      // Enable real-time shadow casting and receiving on all skinned meshes
      const palKey = (p.name || '').trim().toLowerCase();
      const palette = PLAYER_PALETTES[palKey] || PLAYER_PALETTES.default;

      clonedScene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          // Material configuration for distinct team uniforms and glossy visor
          if (mesh.name === 'vanguard_Mesh' && mesh.material) {
            const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            const newMat = origMat.clone() as THREE.MeshStandardMaterial;
            if (newMat.color) {
              newMat.color.setHex(palette.bodyColor);
            }
            if (newMat.emissive) {
              newMat.emissive.setHex(palette.emissive);
            }
            newMat.roughness = 0.65;
            newMat.metalness = 0.15;
            mesh.material = newMat;
          } else if (mesh.name === 'vanguard_visor' && mesh.material) {
            const origMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            const visorMat = origMat.clone() as THREE.MeshStandardMaterial;
            visorMat.color.setHex(0x334155);
            visorMat.roughness = 0.2;
            visorMat.metalness = 0.85;
            mesh.material = visorMat;
          }
        }
      });

      // Animation Mixer
      const mixer = new THREE.AnimationMixer(clonedScene);
      const actions: Record<string, THREE.AnimationAction> = {};

      if (this.baseGltf.animations) {
        for (const clip of this.baseGltf.animations) {
          const action = mixer.clipAction(clip, clonedScene);
          actions[clip.name] = action;
        }
      }

      // Start with Idle action
      let defaultActionName = 'Idle';
      if (actions[defaultActionName]) {
        actions[defaultActionName].play();
      }

      return {
        id: p.id,
        root: clonedScene,
        mixer,
        actions,
        currentActionName: defaultActionName,
        visualX: p.x,
        visualY: p.y,
        targetX: p.x,
        targetY: p.y
      };
    } catch (err) {
      console.error('[Three.js 2.5D] Error creating 3D character instance:', err);
      return null;
    }
  }

  /**
   * Smoothly interpolate position and blend skeletal animation based on authoritative state.
   */
  private updateInstancePhysicsAndAnimation(
    inst: Player3DInstance,
    p: Player,
    dt: number
  ): void {
    // 1. Smooth Visual Interpolation (eliminates network tick jitter)
    inst.targetX = p.x;
    inst.targetY = p.y;
    const lerpSpeed = Math.min(1.0, dt * 24);
    inst.visualX += (inst.targetX - inst.visualX) * lerpSpeed;
    inst.visualY += (inst.targetY - inst.visualY) * lerpSpeed;

    // Position root: Three.js coordinates (X = physicsX, Y = -physicsY, Z = 0)
    // Feet touch precisely at Y = -p.y
    inst.root.position.set(inst.visualX, -inst.visualY, 0);

    // 2. Character Facing / Rotation
    if (p.state === 'CLIMBING_LADDER' || p.state === 'CLIMBING_V_PIPE') {
      // Face inward toward the wall / ladder
      inst.root.rotation.y = Math.PI;
    } else if (p.facing === 'RIGHT') {
      inst.root.rotation.y = Math.PI / 2;
    } else {
      inst.root.rotation.y = -Math.PI / 2;
    }

    // 3. Animation State Selection & Cross-fading
    let desiredAction = 'Idle';
    let playbackSpeed = 1.0;

    const isAirborne = p.state === 'FALLING' || !p.isGrounded;
    const absVx = Math.abs(p.vx);
    const absVy = Math.abs(p.vy);

    if (p.state === 'CLIMBING_LADDER' || p.state === 'CLIMBING_V_PIPE') {
      // Climbing locomotion
      desiredAction = absVy > 10 ? 'Walk' : 'Idle';
      playbackSpeed = Math.max(0.6, absVy / 120);
    } else if (isAirborne) {
      // Jump / Fall arc: Use forward leaping stride if moving horizontally, else dynamic ready stance
      if (absVx > 30) {
        desiredAction = 'Run';
        playbackSpeed = 0.8;
      } else {
        desiredAction = 'Idle';
        playbackSpeed = 1.0;
      }
    } else if (p.state === 'ON_FLOOR') {
      if (absVx > 110) {
        desiredAction = 'Run';
        playbackSpeed = Math.max(0.8, absVx / 180);
      } else if (absVx > 10) {
        desiredAction = 'Walk';
        playbackSpeed = Math.max(0.6, absVx / 90);
      } else {
        desiredAction = 'Idle';
        playbackSpeed = 1.0;
      }
    }

    // Cross-fade animation clips
    if (desiredAction !== inst.currentActionName && inst.actions[desiredAction]) {
      const prevAction = inst.actions[inst.currentActionName];
      const nextAction = inst.actions[desiredAction];

      if (prevAction) {
        prevAction.fadeOut(0.2);
      }
      nextAction.reset().fadeIn(0.2).play();
      inst.currentActionName = desiredAction;
    }

    // Set playback rate on current active action
    const currentAction = inst.actions[inst.currentActionName];
    if (currentAction) {
      currentAction.setEffectiveTimeScale(playbackSpeed);
    }

    // Advance skeletal bone animation
    inst.mixer.update(dt);
  }

  public cleanup(): void {
    if (this.scene) {
      for (const inst of this.playerInstances.values()) {
        this.scene.remove(inst.root);
      }
    }
    this.playerInstances.clear();
  }
}
