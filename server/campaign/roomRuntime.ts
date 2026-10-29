import { GameEngine, RectBounds } from '../gameEngine.js';
import { Player, ClientInput, Ladder, WallRect } from '../types.js';
import { LoadedRoom, DoorTrigger, LoadedCampaignItem } from './roomLoader.js';
import { RoomItemType } from './types.js';

export interface CampaignItem {
  id: string;
  type: RoomItemType;
  roomId: number;
  x: number;
  y: number;
  carriedByPlayerId: string | null;
}

export interface RoomPersistentState {
  roomId: number;
  visited: boolean;
  unlockedContainers: string[];
  activatedSwitches: string[];
  deployedMechanisms: string[];
  cutHatches: string[];
  groundItems: CampaignItem[];
}

export interface InteractionResult {
  action: string;
  message?: string;
  itemDropped?: CampaignItem;
  itemGiven?: CampaignItem;
  transitionTarget?: number | 'Surface';
}

/**
 * Checks whether point (px, py) is inside rectangle [x, y, width, height].
 */
export function pointInRect(px: number, py: number, r: { x: number; y: number; width: number; height: number }, margin: number = 0): boolean {
  return (
    px >= r.x - margin &&
    px <= r.x + r.width + margin &&
    py >= r.y - margin &&
    py <= r.y + r.height + margin
  );
}

/**
 * RoomRuntime encapsulates physics, players, and local items for one active campaign room.
 */
export const ITEM_PICKUP_RADIUS = 64;

export class RoomRuntime {
  public roomId: number;
  public loadedRoom: LoadedRoom;
  public engine: GameEngine;
  public groundItems: Map<string, CampaignItem> = new Map();
  public unlockedContainers: Set<string> = new Set();
  public activatedSwitches: Set<string> = new Set();
  public switchTimers: Map<string, number> = new Map();
  public deployedMechanisms: Set<string> = new Set();
  public cutHatches: Set<string> = new Set();
  public visited: boolean = false;

  // Dynamic room hazards & actors
  public searchlightX: number = 160;
  public searchlightDirection: number = 1;
  public guardX: number = 576;
  public guardDirection: number = 1;

  constructor(loadedRoom: LoadedRoom, savedState?: RoomPersistentState) {
    this.roomId = loadedRoom.id;
    this.loadedRoom = loadedRoom;

    // Initialize GameEngine with room-specific geometry and dimensions
    this.engine = new GameEngine({
      walls: loadedRoom.walls,
      worldWidth: loadedRoom.widthPx,
      worldHeight: loadedRoom.heightPx,
      floorY: loadedRoom.floorYPx
    });

    // Populate engine ladders from loadedRoom
    this.engine.state.ladders = loadedRoom.ladders.map(l => ({ ...l }));

    if (savedState) {
      this.restorePersistentState(savedState);
    } else {
      this.initDefaultState();
    }
  }

  private initDefaultState(): void {
    // Populate default ground items from room definition
    for (const itm of this.loadedRoom.items) {
      // In Room 5, optional rope is concealed behind the movable panel until opened
      if (this.roomId === 5 && itm.id === 'optional_rope' && !this.deployedMechanisms.has('movable_panel')) {
        continue;
      }
      this.groundItems.set(itm.id, {
        id: itm.id,
        type: itm.type,
        roomId: this.roomId,
        x: itm.x,
        y: itm.y,
        carriedByPlayerId: null
      });
    }
  }

  public restorePersistentState(saved: RoomPersistentState): void {
    this.visited = saved.visited;
    this.unlockedContainers = new Set(saved.unlockedContainers);
    this.activatedSwitches = new Set(saved.activatedSwitches);
    this.deployedMechanisms = new Set(saved.deployedMechanisms);
    this.cutHatches = new Set(saved.cutHatches);

    this.groundItems.clear();
    for (const item of saved.groundItems) {
      this.groundItems.set(item.id, { ...item });
    }

    // Reapply mechanism state to engine ladders
    if (this.roomId === 1 && this.deployedMechanisms.has('rope_anchor')) {
      this.ensureRopeDeployed();
    }
    if (this.roomId === 10 && this.deployedMechanisms.has('emergency_ladder')) {
      this.deployEmergencyLadder();
    }
  }

  public capturePersistentState(): RoomPersistentState {
    return {
      roomId: this.roomId,
      visited: this.visited,
      unlockedContainers: Array.from(this.unlockedContainers),
      activatedSwitches: Array.from(this.activatedSwitches),
      deployedMechanisms: Array.from(this.deployedMechanisms),
      cutHatches: Array.from(this.cutHatches),
      groundItems: Array.from(this.groundItems.values()).map(itm => ({ ...itm }))
    };
  }

  public addPlayer(player: Player): void {
    const existing = this.engine.state.players.find(p => p.id === player.id);
    if (!existing) {
      this.engine.state.players.push(player);
    }
    this.visited = true;
  }

  public removePlayer(playerId: string): Player | null {
    const idx = this.engine.state.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      return this.engine.state.players.splice(idx, 1)[0];
    }
    return null;
  }

  public getPlayer(playerId: string): Player | undefined {
    return this.engine.state.players.find(p => p.id === playerId);
  }

  public getPlayers(): Player[] {
    return this.engine.state.players;
  }

  public update(): void {
    const DT = 1 / 30;

    // Advance room physics
    this.engine.update();

    // 1. Room 1 Boost Zone Logic
    if (this.roomId === 1) {
      // Boost zone tile rect [8, 3, 14, 5] -> px: x 256..448, y: 480..544
      for (const p of this.engine.state.players) {
        if (p.x >= 256 && p.x <= 448 && p.y >= 460 && p.y <= 560) {
          // If jumping or pressing up in boost zone, apply cooperative boost
          if (p.vy < -50) {
            p.vy = -520;
            p.isGrounded = false;
            if (p.vx > 0 || p.facing === 'RIGHT') {
              p.vx = Math.max(p.vx, 260);
            }
          }
        }
      }
    }

    // 1.5 Room 3 Sleeping Guard detection
    if (this.roomId === 3) {
      for (const p of this.engine.state.players) {
        // Sleeping guard at point [24, 3] (x=768, y=544)
        // Detects un-occluded floor traversers within 45px
        if (p.y > 480 && Math.abs(p.x - 768) < 45) {
          const inCoverA = p.x >= 448 && p.x <= 576;
          const inCoverB = p.x >= 960 && p.x <= 1088;
          if (!inCoverA && !inCoverB && (!p.hazardCooldown || p.hazardCooldown <= 0)) {
            p.x = 96;
            p.y = 544;
            p.vx = 0;
            p.vy = 0;
            p.stunnedTimer = 1.0;
            p.hazardCooldown = 3.0;
            p.state = 'STUNNED';
            this.engine.emitSound({ type: 'TACKLE', x: 96, y: 544 });
          }
        }
      }
    }

    // 2. Room 4 Searchlight sweep
    if (this.roomId === 4) {
      this.searchlightX += this.searchlightDirection * 160 * DT;
      if (this.searchlightX >= 1440) {
        this.searchlightX = 1440;
        this.searchlightDirection = -1;
      } else if (this.searchlightX <= 160) {
        this.searchlightX = 160;
        this.searchlightDirection = 1;
      }

      // Detection check for players not behind cover
      for (const p of this.engine.state.players) {
        if (p.y > 480 && Math.abs(p.x - this.searchlightX) < 40) {
          // Check if behind Cover A [12, 3, 16, 6] (x 384..512) or Cover B [29, 3, 33, 6] (x 928..1056)
          const inCoverA = p.x >= 384 && p.x <= 512;
          const inCoverB = p.x >= 928 && p.x <= 1056;
          if (!inCoverA && !inCoverB && (!p.hazardCooldown || p.hazardCooldown <= 0)) {
            p.stunnedTimer = 0.5;
            p.hazardCooldown = 2.0;
            p.state = 'STUNNED';
          }
        }
      }
    }

    // 3. Room 7 Guard Patrol
    if (this.roomId === 7) {
      this.guardX += this.guardDirection * 90 * DT;
      if (this.guardX >= 992) {
        this.guardX = 992;
        this.guardDirection = -1;
      } else if (this.guardX <= 576) {
        this.guardX = 576;
        this.guardDirection = 1;
      }

      // Detection along floor
      for (const p of this.engine.state.players) {
        if (p.y > 500 && Math.abs(p.x - this.guardX) < 50) {
          const inCoverA = p.x >= 320 && p.x <= 448;
          const inCoverB = p.x >= 1056 && p.x <= 1184;
          if (!inCoverA && !inCoverB && (!p.hazardCooldown || p.hazardCooldown <= 0)) {
            // Guard sends player to holding safe zone without softlock
            p.x = 96;
            p.y = 544;
            p.vx = 0;
            p.vy = 0;
            p.stunnedTimer = 1.0;
            p.hazardCooldown = 3.0;
            p.state = 'STUNNED';
          }
        }
      }
    }

    // 4. Room 8 Switch Latch Timers
    if (this.roomId === 8) {
      for (const [sw, timer] of this.switchTimers.entries()) {
        const nextTimer = timer - DT;
        if (nextTimer <= 0) {
          this.switchTimers.delete(sw);
          this.activatedSwitches.delete(sw);
        } else {
          this.switchTimers.set(sw, nextTimer);
        }
      }
      if (this.activatedSwitches.has('switch_a') && this.activatedSwitches.has('switch_b')) {
        this.deployedMechanisms.add('door_unlocked');
      }
    }

    // 5. Room 10 Auto-Deploy Emergency Ladder when Platform C reached
    if (this.roomId === 10) {
      for (const p of this.engine.state.players) {
        if (p.x >= 832 && p.x <= 1408 && p.y <= 240) {
          if (!this.deployedMechanisms.has('emergency_ladder')) {
            this.deployEmergencyLadder();
          }
        }
      }
    }
  }

  public handleInput(playerId: string, input: ClientInput): void {
    this.engine.handleInput(playerId, input);
  }

  public ensureRopeDeployed(): void {
    this.deployedMechanisms.add('rope_anchor');
    const existing = this.engine.state.ladders.find(l => l.id === 'cell_rope');
    if (!existing) {
      this.engine.state.ladders.push({
        id: 'cell_rope',
        x: 992,
        y: 384,
        width: 24,
        height: 160,
        state: 'PLACED',
        carriedByPlayerId: null,
        isPlaced: true,
        leanAngle: 0
      });
    }
  }

  public deployEmergencyLadder(): void {
    this.deployedMechanisms.add('emergency_ladder');
    const ladder = this.engine.state.ladders.find(l => l.id === 'emergency_ladder');
    if (ladder) {
      ladder.state = 'PLACED';
      ladder.isPlaced = true;
    } else {
      this.engine.state.ladders.push({
        id: 'emergency_ladder',
        x: 912,
        y: 192,
        width: 28,
        height: 352,
        state: 'PLACED',
        carriedByPlayerId: null,
        isPlaced: true,
        leanAngle: 0
      });
    }
  }

  public deployShaftRope(): void {
    this.deployedMechanisms.add('shaft_rope');
    const existing = this.engine.state.ladders.find(l => l.id === 'shaft_rope');
    if (!existing) {
      this.engine.state.ladders.push({
        id: 'shaft_rope',
        x: 608,
        y: 160,
        width: 16,
        height: 352, // 512 - 160
        state: 'PLACED',
        carriedByPlayerId: null,
        isPlaced: true,
        leanAngle: 0
      });
    }
  }

  /**
   * Find a door trigger zone that the player is currently contacting.
   */
  public getTouchingDoor(player: Player): DoorTrigger | null {
    for (const door of this.loadedRoom.doors) {
      if (pointInRect(player.x, player.y, door.rect, 24)) {
        return door;
      }
    }
    return null;
  }

  /**
   * Authoritative item pickup within shared pickup radius (ITEM_PICKUP_RADIUS = 64 px).
   */
  public pickupGroundItem(player: Player, itemId?: string): CampaignItem | null {
    for (const [id, item] of this.groundItems.entries()) {
      if (itemId && id !== itemId) continue;
      const dist = Math.hypot(player.x - item.x, player.y - item.y);
      if (dist <= ITEM_PICKUP_RADIUS && item.carriedByPlayerId === null) {
        this.groundItems.delete(id);
        item.carriedByPlayerId = player.id;
        return item;
      }
    }
    return null;
  }

  /**
   * Drop an item onto the floor or highest platform directly below the player.
   */
  public dropItem(item: CampaignItem, x: number, y: number): void {
    item.carriedByPlayerId = null;
    item.roomId = this.roomId;
    item.x = x;

    // Platform snapping: find highest horizontal platform surface directly beneath player
    let dropY = this.loadedRoom.floorYPx;
    for (const wall of this.loadedRoom.walls) {
      if (x >= wall.x - 8 && x <= wall.x + wall.width + 8) {
        if (wall.y >= y - 10 && wall.y < dropY) {
          dropY = wall.y;
        }
      }
    }

    item.y = dropY;
    this.groundItems.set(item.id, item);
  }

  /**
   * Mark container (e.g. Room 9 Box C) as unlocked.
   */
  public unlockContainer(containerId: string): void {
    this.unlockedContainers.add(containerId);
  }

  public isContainerUnlocked(containerId: string): boolean {
    return this.unlockedContainers.has(containerId);
  }

  /**
   * Authoritative context interaction logic.
   */
  public interact(player: Player, carriedItem?: CampaignItem): InteractionResult | null {
    // 1. Room 1: Rope Anchor deployment
    if (this.roomId === 1) {
      const anchorDist = Math.hypot(player.x - 992, player.y - 384);
      if (anchorDist < 60) {
        this.ensureRopeDeployed();
        return { action: 'DEPLOY_ROPE', message: 'Rope lowered to floor!' };
      }
      // Boost zone prompt trigger
      if (player.x >= 256 && player.x <= 448 && player.y >= 460) {
        player.vy = -520;
        player.isGrounded = false;
        return { action: 'BOOST_JUMP', message: 'Cooperative launch boost!' };
      }
    }

    // 2. Room 2: Reset lever
    if (this.roomId === 2) {
      const leverDist = Math.hypot(player.x - 384, player.y - 544);
      if (leverDist < 50) {
        return { action: 'RESET_CRATE', message: 'Movable crate reset to initial position.' };
      }
    }

    // 3. Room 5: Movable panel
    if (this.roomId === 5) {
      if (player.x >= 780 && player.x <= 880 && player.y > 460) {
        this.deployedMechanisms.add('movable_panel');
        if (!this.groundItems.has('optional_rope') && carriedItem?.type !== 'rope') {
          this.groundItems.set('optional_rope', {
            id: 'optional_rope',
            type: 'rope',
            roomId: 5,
            x: 832,
            y: 544,
            carriedByPlayerId: null
          });
        }
        return { action: 'OPEN_PANEL', message: 'Secret panel opened! Optional rope revealed.' };
      }
    }

    // 3b. Room 6: Shaft rope anchor
    if (this.roomId === 6) {
      const anchorDist = Math.hypot(player.x - 608, player.y - 160);
      if (anchorDist < 60) {
        this.deployShaftRope();
        return { action: 'DEPLOY_SHAFT_ROPE', message: 'Rope deployed down shaft to platform!' };
      }
    }

    // 4. Room 8: Switches
    if (this.roomId === 8) {
      const distA = Math.hypot(player.x - 384, player.y - 544);
      if (distA < 50) {
        this.activatedSwitches.add('switch_a');
        this.switchTimers.set('switch_a', 12.0);
        if (this.activatedSwitches.has('switch_b')) {
          this.deployedMechanisms.add('door_unlocked');
        }
        return { action: 'ACTIVATE_SWITCH_A', message: 'Switch A activated (12s timer)!' };
      }
      const distB = Math.hypot(player.x - 1152, player.y - 544);
      if (distB < 50) {
        this.activatedSwitches.add('switch_b');
        this.switchTimers.set('switch_b', 12.0);
        if (this.activatedSwitches.has('switch_a')) {
          this.deployedMechanisms.add('door_unlocked');
        }
        return { action: 'ACTIVATE_SWITCH_B', message: 'Switch B activated (12s timer)!' };
      }
    }

    // 5. Room 9: Box C Unlock
    if (this.roomId === 9) {
      const boxDist = Math.hypot(player.x - 1160, player.y - 512);
      if (boxDist < 60) {
        if (this.isContainerUnlocked('box_c')) {
          return { action: 'BOX_ALREADY_OPEN', message: 'Box C is already open.' };
        }
        if (carriedItem && (carriedItem.type === 'key' || carriedItem.id === 'brass_key')) {
          this.unlockContainer('box_c');
          this.groundItems.set('cutting_tool', {
            id: 'cutting_tool',
            type: 'cutting_tool',
            roomId: 9,
            x: 1160,
            y: 544,
            carriedByPlayerId: null
          });
          return { action: 'UNLOCK_BOX', message: 'Box C unlocked! Cutting tool acquired!' };
        }
        return { action: 'BOX_LOCKED', message: 'Box C is locked. Find the brass key.' };
      }
    }

    // 6. Room 10: Hatch Cutting & Escape
    if (this.roomId === 10) {
      const hatchDist = Math.hypot(player.x - 1248, player.y - 144);
      if (hatchDist < 80) {
        if (!this.cutHatches.has('sealed_hatch')) {
          if (carriedItem && carriedItem.type === 'cutting_tool') {
            this.cutHatches.add('sealed_hatch');
            return { action: 'CUT_HATCH', message: 'Steel rebar cut! Escape hatch is open!' };
          }
          return { action: 'HATCH_LOCKED', message: 'Hatch is reinforced with steel bars. Requires cutting tool.' };
        }
        // If already cut, touching it completes campaign
        return { action: 'ESCAPE_SURFACE', transitionTarget: 'Surface' };
      }
    }

    return null;
  }

  /**
   * Helper to get human-readable prompt string for HUD.
   */
  public getPrompt(player: Player, carriedItem?: CampaignItem): string | null {
    // In Room 9, locked Box C container prompt takes precedence over its internal item
    if (this.roomId === 9 && Math.hypot(player.x - 1160, player.y - 512) < 60 && !this.isContainerUnlocked('box_c')) {
      return carriedItem?.type === 'key' ? '[E] Unlock Box C' : '[LOCKED] Requires Brass Key';
    }

    // Check ground items
    for (const item of this.groundItems.values()) {
      if (Math.hypot(player.x - item.x, player.y - item.y) <= ITEM_PICKUP_RADIUS) {
        return `[E] Pick up ${item.type.replace('_', ' ').toUpperCase()}`;
      }
    }

    // Check doors
    const door = this.getTouchingDoor(player);
    if (door) {
      if (this.roomId === 8 && !this.deployedMechanisms.has('door_unlocked')) {
        return '[LOCKED] Activate both switches to open';
      }
      if (door.targetRoomId === 'Surface' || door.id === 'sealed_hatch') {
        if (!this.cutHatches.has('sealed_hatch')) {
          return carriedItem?.type === 'cutting_tool' ? '[E] Cut Hatch Rebar' : '[SEALED] Requires Cutting Tool';
        }
        return '[E] Escape to Surface!';
      }
      return `[E] Enter Room ${door.targetRoomId}`;
    }

    // Check specific mechanisms
    if (this.roomId === 1) {
      if (Math.hypot(player.x - 992, player.y - 384) < 60 && !this.deployedMechanisms.has('rope_anchor')) {
        return '[E] Deploy Rope to Floor';
      }
      if (player.x >= 256 && player.x <= 448 && player.y >= 460) {
        return '[W / SPACE / E] Co-op Boost Jump';
      }
    }

    if (this.roomId === 5 && player.x >= 780 && player.x <= 880 && player.y > 460 && !this.deployedMechanisms.has('movable_panel')) {
      return '[E] Open Secret Panel';
    }

    if (this.roomId === 6 && Math.hypot(player.x - 608, player.y - 160) < 60 && !this.deployedMechanisms.has('shaft_rope')) {
      return '[E] Deploy Rope to Platform';
    }

    if (this.roomId === 8) {
      if (Math.hypot(player.x - 384, player.y - 544) < 50) return '[E] Activate Switch A';
      if (Math.hypot(player.x - 1152, player.y - 544) < 50) return '[E] Activate Switch B';
    }

    if (this.roomId === 9 && Math.hypot(player.x - 1160, player.y - 512) < 60 && !this.isContainerUnlocked('box_c')) {
      return carriedItem?.type === 'key' ? '[E] Unlock Box C' : '[LOCKED] Requires Brass Key';
    }

    if (this.roomId === 10 && Math.hypot(player.x - 1248, player.y - 144) < 80) {
      if (!this.cutHatches.has('sealed_hatch')) {
        return carriedItem?.type === 'cutting_tool' ? '[E] Cut Hatch Rebar' : '[SEALED] Requires Cutting Tool';
      }
      return '[E] Escape to Surface!';
    }

    if (carriedItem) {
      return `[G] Drop ${carriedItem.type.replace('_', ' ').toUpperCase()}`;
    }

    return null;
  }
}
