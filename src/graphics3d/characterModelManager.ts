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
  paletteIndex: number;
}

export interface UniformPalette {
  bodyColor: number;
  emissive: number;
  name: string;
}

export const UNIFORM_PALETTES: UniformPalette[] = [
  { bodyColor: 0x93c5fd, emissive: 0x051329, name: 'Denim Slate Blue' },      // Inmate 0 / Host
  { bodyColor: 0xfb923c, emissive: 0x220c02, name: 'Hazard Orange' },         // Inmate 1 / Partner
  { bodyColor: 0xfde047, emissive: 0x1c1704, name: 'Detention Khaki' },       // Inmate 2
  { bodyColor: 0x86efac, emissive: 0x051a0b, name: 'Prison Olive' },          // Inmate 3
  { bodyColor: 0xf87171, emissive: 0x220505, name: 'Maximum Security Red' },  // Inmate 4
  { bodyColor: 0xc084fc, emissive: 0x180528, name: 'Solitary Violet' },       // Inmate 5
  { bodyColor: 0x22d3ee, emissive: 0x041a20, name: 'Medical Cyan' },          // Inmate 6
  { bodyColor: 0xa3e635, emissive: 0x101a04, name: 'Sanitation Lime' },       // Inmate 7
];

export class CharacterModelManager {
  private static instance: CharacterModelManager | null = null;
  private loader: GLTFLoader;
  public baseGltf: any = null;
  public isLoaded: boolean = false;
  public isLoading: boolean = false;
  public loadError: Error | null = null;
  private loadPromise: Promise<void> | null = null;
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
    if (this.isLoading && this.loadPromise) return this.loadPromise;

    this.isLoading = true;
    this.loadPromise = new Promise((resolve, reject) => {
      this.loader.load(
        '/models/Soldier.glb',
        (gltf) => {
          this.baseGltf = gltf;
          this.isLoaded = true;
          this.isLoading = false;
          console.log('[Three.js 2.5D] Successfully loaded realistic humanoid character model (Soldier.glb)');
          resolve();
        },
        undefined,
        (err) => {
          this.loadError = err instanceof Error ? err : new Error(String(err));
          this.isLoaded = false;
          this.isLoading = false;
          console.error('[Three.js 2.5D] Failed to load 3D character model:', err);
          reject(this.loadError);
        }
      );
    });

    return this.loadPromise;
  }

  public getIsReady(): boolean {
    return this.isLoaded && this.baseGltf !== null && !this.loadError;
  }

  public getIsLoading(): boolean {
    return this.isLoading;
  }

  public getLoadError(): Error | null {
    return this.loadError;
  }

  /**
   * Deterministically assign a uniform palette index independently of display names.
   * Priority: team roster index (e.g. Inmate 1, Inmate 2) -> deterministic hash of player ID.
   */
  public static resolvePaletteIndex(p: Player, rosterIndex: number = -1): number {
    if (rosterIndex >= 0) {
      return rosterIndex % UNIFORM_PALETTES.length;
    }
    let hash = 0;
    const str = p.id || '';
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash % UNIFORM_PALETTES.length;
  }

  /**
   * Synchronize active 3D character instances with authoritative server players.
   */
  public updatePlayers(players: Player[], dt: number, teamRoster?: { id: string; name: string }[]): void {
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
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.state === 'DEAD' || p.hasEscaped) {
        const inst = this.playerInstances.get(p.id);
        if (inst) {
          inst.root.visible = false;
        }
        continue;
      }

      let rosterIdx = -1;
      if (teamRoster && Array.isArray(teamRoster)) {
        rosterIdx = teamRoster.findIndex(m => m.id === p.id);
      }
      if (rosterIdx < 0) {
        rosterIdx = i;
      }
      const paletteIndex = CharacterModelManager.resolvePaletteIndex(p, rosterIdx);

      let inst = this.playerInstances.get(p.id);
      if (!inst) {
        const created = this.createPlayerInstance(p, paletteIndex);
        if (created) {
          inst = created;
          this.playerInstances.set(p.id, inst);
          this.scene.add(inst.root);
        }
      }

      if (inst) {
        inst.root.visible = true;
        this.applyUniformPalette(inst, paletteIndex);
        this.updateInstancePhysicsAndAnimation(inst, p, dt);
      }
    }
  }

  /**
   * Apply uniform jumpsuit tinting to character mesh.
   */
  private applyUniformPalette(inst: Player3DInstance, paletteIndex: number): void {
    if (inst.paletteIndex === paletteIndex) return;
    inst.paletteIndex = paletteIndex;
    const palette = UNIFORM_PALETTES[paletteIndex % UNIFORM_PALETTES.length];

    inst.root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.name === 'vanguard_Mesh') {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && mat.color) {
          mat.color.setHex(palette.bodyColor);
          if (mat.emissive) mat.emissive.setHex(palette.emissive);
        }
      }
    });
  }

  /**
   * Instantiate and configure a rigged 3D character for a player.
   */
  private createPlayerInstance(p: Player, paletteIndex: number): Player3DInstance | null {
    try {
      const clonedScene = SkeletonUtils.clone(this.baseGltf.scene) as THREE.Group;

      // Scale model so height is precisely 42 pixels (server player collision envelope is 42 px tall)
      // Soldier.glb has a natural height of 1.8322 units with feet at Y=0 and head at Y=1.8322.
      const targetHeight = 42; // pixels
      const naturalHeight = 1.8322; // model units
      const scale = targetHeight / naturalHeight; // 22.923
      clonedScene.scale.set(scale, scale, scale);

      // Enable real-time shadow casting and receiving on all skinned meshes
      const palette = UNIFORM_PALETTES[paletteIndex % UNIFORM_PALETTES.length];

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

      // Safe initialization: resolve an available action (or Idle)
      let initialActionName = 'Idle';
      const initialAction = actions['Idle'] || actions['Walk'] || actions['Run'] || (Object.values(actions)[0] ?? null);
      if (initialAction) {
        initialAction.play();
        initialActionName = initialAction.getClip().name;
      }

      return {
        id: p.id,
        root: clonedScene,
        mixer,
        actions,
        currentActionName: initialActionName,
        visualX: p.x,
        visualY: p.y,
        targetX: p.x,
        targetY: p.y,
        paletteIndex
      };
    } catch (err) {
      console.error('[Three.js 2.5D] Error creating 3D character instance:', err);
      return null;
    }
  }

  /**
   * Safely resolve an action clip, falling back down the candidate hierarchy if requested clip is missing.
   */
  public resolveAction(inst: Player3DInstance, desired: string): { actionName: string; action: THREE.AnimationAction } | null {
    if (inst.actions[desired]) {
      return { actionName: desired, action: inst.actions[desired] };
    }

    const fallbacks: Record<string, string[]> = {
      Run: ['Walk', 'Idle'],
      Walk: ['Run', 'Idle'],
      Climb: ['Walk', 'Idle'],
      Jump: ['Run', 'Walk', 'Idle'],
      Fall: ['Walk', 'Run', 'Idle'],
      Idle: ['Walk', 'Run']
    };

    const candidates = fallbacks[desired] || ['Idle', 'Walk', 'Run'];
    for (const name of candidates) {
      if (inst.actions[name]) {
        return { actionName: name, action: inst.actions[name] };
      }
    }

    const keys = Object.keys(inst.actions);
    if (keys.length > 0 && inst.actions[keys[0]]) {
      return { actionName: keys[0], action: inst.actions[keys[0]] };
    }

    return null;
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
    // In Soldier.glb, the base mesh forward vector (visor/face) points along -Z.
    // Three.js Y-axis rotation: forward vector becomes (-sin(θ), 0, -cos(θ)).
    // - Facing RIGHT (+X): θ = -π/2  => (-sin(-π/2), 0, -cos(-π/2)) = (+1, 0, 0)
    // - Facing LEFT  (-X): θ = +π/2  => (-sin(+π/2), 0, -cos(+π/2)) = (-1, 0, 0)
    // - Climbing (inward into wall, -Z): θ = 0 => (-sin(0), 0, -cos(0)) = (0, 0, -1)
    if (p.state === 'CLIMBING_LADDER' || p.state === 'CLIMBING_V_PIPE') {
      inst.root.rotation.y = 0;
    } else if (p.facing === 'RIGHT') {
      inst.root.rotation.y = -Math.PI / 2;
    } else {
      inst.root.rotation.y = Math.PI / 2;
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
    } else if (p.state === 'HANGING_H_PIPE') {
      // Horizontal pipe locomotion
      desiredAction = absVx > 10 ? 'Walk' : 'Idle';
      playbackSpeed = Math.max(0.6, absVx / 90);
    } else if (p.state === 'STUNNED') {
      // Stunned on impact
      desiredAction = 'Idle';
      playbackSpeed = 0.5;
    } else if (isAirborne) {
      // Jump / Fall arc: Use forward leaping stride if moving horizontally, else dynamic ready stance
      if (absVx > 30) {
        desiredAction = 'Run';
        playbackSpeed = 0.8;
      } else if (p.vy > 50) {
        desiredAction = 'Walk';
        playbackSpeed = 0.5;
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

    // Safely cross-fade animation clips with fallback hierarchy
    const resolved = this.resolveAction(inst, desiredAction);
    if (resolved) {
      if (resolved.actionName !== inst.currentActionName) {
        const prevAction = inst.actions[inst.currentActionName];
        if (prevAction) {
          prevAction.fadeOut(0.2);
        }
        resolved.action.reset().fadeIn(0.2).play();
        inst.currentActionName = resolved.actionName;
      }

      resolved.action.setEffectiveTimeScale(playbackSpeed);
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
