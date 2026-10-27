import crypto from 'crypto';
import { Player, ClientInput, Ladder, WallRect } from '../types.js';
import { CampaignProjectSpec, TransitionNetworkEdge } from './types.js';
import { loadCampaignSpec, loadRoomFromSpec, DoorTrigger, SafeZone } from './roomLoader.js';
import { RoomRuntime, RoomPersistentState, CampaignItem, InteractionResult } from './roomRuntime.js';
import { IntroSequence, IntroSequenceState } from './introSequence.js';

export interface CampaignPlayerSession {
  playerId: string;
  name: string;
  resumeToken: string;
}

export interface ClientCampaignSync {
  mode: 'campaign';
  sessionCode: string;
  roomId: number;
  roomName: string;
  roomWidth: number;
  roomHeight: number;
  floorY: number;
  walls: WallRect[];
  doors: DoorTrigger[];
  safeZones: SafeZone[];
  ladders: Ladder[];
  groundItems: CampaignItem[];
  carriedItem: CampaignItem | null;
  players: Player[];
  puzzleState: {
    activatedSwitches: string[];
    deployedMechanisms: string[];
    cutHatches: string[];
    unlockedContainers: string[];
    searchlightX?: number;
    guardX?: number;
    switchTimers?: Record<string, number>;
    campaignComplete: boolean;
  };
  interactionPrompt: string | null;
  teamRoster: Array<{ id: string; name: string; roomId: number }>;
  intro: IntroSequenceState | null;
}

/**
 * CampaignSession manages the authoritative multiplayer campaign run:
 * - Coordinates 1-5 players progressing across 10 rooms.
 * - Tracks player-to-room memberships.
 * - Enforces independent room presence during backtracking (Room 10 -> Room 9).
 * - Manages atomic item pickup, drop, and handoff transactions (max 1 item per player).
 * - Preserves room puzzle state across leaving and returning.
 */
export class CampaignSession {
  public id: string;
  public projectSpec: CampaignProjectSpec;
  public players: Map<string, Player> = new Map();
  public playerSessions: Map<string, CampaignPlayerSession> = new Map();
  public playerRoomMap: Map<string, number> = new Map();
  public playerItems: Map<string, CampaignItem> = new Map();
  public activeRooms: Map<number, RoomRuntime> = new Map();
  public persistentStates: Map<number, RoomPersistentState> = new Map();
  public lastInteractPressed: Map<string, boolean> = new Map();
  public campaignComplete: boolean = false;
  public intro: IntroSequence = new IntroSequence();

  constructor(id?: string, spec?: CampaignProjectSpec) {
    this.id = id || `CAMP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    this.projectSpec = spec || loadCampaignSpec();
  }

  /**
   * Get or instantiate a RoomRuntime for a given room ID.
   * Restores any previously saved persistent state if players visited before.
   */
  public getOrCreateRoomRuntime(roomId: number): RoomRuntime {
    let runtime = this.activeRooms.get(roomId);
    if (!runtime) {
      const loaded = loadRoomFromSpec(roomId, this.projectSpec);
      const savedState = this.persistentStates.get(roomId);
      runtime = new RoomRuntime(loaded, savedState);
      this.activeRooms.set(roomId, runtime);
    }
    return runtime;
  }

  /**
   * Add a player to the campaign session and place them into an initial room.
   */
  public addPlayer(player: Player, initialRoomId: number = 1, resumeToken?: string): boolean {
    if (this.players.has(player.id)) return false;

    const token = resumeToken || crypto.randomUUID();
    this.players.set(player.id, player);
    this.playerSessions.set(player.id, {
      playerId: player.id,
      name: player.name,
      resumeToken: token
    });

    const room = this.getOrCreateRoomRuntime(initialRoomId);
    this.playerRoomMap.set(player.id, initialRoomId);

    // Place player at first safe zone / spawn point if available
    if (room.loadedRoom.safeZones.length > 0) {
      const spawn = room.loadedRoom.safeZones[0].spawnPoint;
      player.x = spawn.x;
      player.y = spawn.y;
    } else {
      player.x = 100;
      player.y = room.loadedRoom.floorYPx;
    }
    player.isGrounded = true;
    player.state = 'ON_FLOOR';

    room.addPlayer(player);

    // Start intro sequence when first player joins room 1
    if (initialRoomId === 1 && !this.intro.hasStarted() && !this.intro.isComplete()) {
      this.intro.start();
    }

    return true;
  }

  /**
   * Get which room a player currently occupies.
   */
  public getPlayerRoomId(playerId: string): number | undefined {
    return this.playerRoomMap.get(playerId);
  }

  /**
   * Get the RoomRuntime currently occupied by a player.
   */
  public getPlayerRoom(playerId: string): RoomRuntime | undefined {
    const roomId = this.playerRoomMap.get(playerId);
    return roomId !== undefined ? this.activeRooms.get(roomId) : undefined;
  }

  /**
   * Checks whether a proposed transition from currentRoomId to targetRoomId is valid
   * according to the campaign graph (forward transition or legal backtrack edge).
   */
  public isLegalTransition(fromRoomId: number, toRoomId: number | 'Surface'): boolean {
    if (toRoomId === 'Surface') {
      return fromRoomId === 10;
    }

    const network = this.projectSpec.project.campaign_graph?.transition_network || [];
    const directEdge = network.some(e => e.from === fromRoomId && e.to === toRoomId);
    if (directEdge) return true;

    // Check main path forward step (e.g. 1 -> 2, 2 -> 3)
    const mainPath = this.projectSpec.project.campaign_graph?.main_path || [];
    const fromIdx = mainPath.indexOf(fromRoomId);
    if (fromIdx !== -1 && fromIdx + 1 < mainPath.length && mainPath[fromIdx + 1] === toRoomId) {
      return true;
    }

    // Check backtrack edges (e.g. [10, 9])
    const backtrackEdges = this.projectSpec.project.campaign_graph?.backtrack_edges || [];
    const isBacktrack = backtrackEdges.some(([f, t]) => f === fromRoomId && t === toRoomId);
    if (isBacktrack) return true;

    return false;
  }

  /**
   * Transition a player to target room.
   * Guarantees:
   * 1. Independent room presence: other players in fromRoom remain completely undisturbed.
   * 2. Authoritative validation: player must touch a door and transition must be in campaign graph.
   * 3. Carried item moves with player.
   * 4. Source room state persists.
   */
  public transitionPlayer(playerId: string, targetRoomId: number): boolean {
    const currentRoomId = this.playerRoomMap.get(playerId);
    if (currentRoomId === undefined) return false;
    if (currentRoomId === targetRoomId) return false;

    const sourceRoom = this.activeRooms.get(currentRoomId);
    if (!sourceRoom) return false;

    const player = sourceRoom.getPlayer(playerId);
    if (!player) return false;

    // Check door proximity
    const touchingDoor = sourceRoom.getTouchingDoor(player);
    if (!touchingDoor) {
      return false; // Player is not at an exit door
    }

    // Check campaign graph legality
    if (!this.isLegalTransition(currentRoomId, targetRoomId)) {
      return false; // Not a valid transition edge
    }

    // Atomically transfer player
    sourceRoom.removePlayer(playerId);

    // Save source room persistent state
    this.persistentStates.set(currentRoomId, sourceRoom.capturePersistentState());

    // Prepare target room
    const targetRoom = this.getOrCreateRoomRuntime(targetRoomId);

    // Position player at entry staging / spawn
    if (touchingDoor.stagingRect) {
      player.x = touchingDoor.stagingRect.x + touchingDoor.stagingRect.width / 2;
      player.y = touchingDoor.stagingRect.y + touchingDoor.stagingRect.height;
    } else if (targetRoom.loadedRoom.safeZones.length > 0) {
      const sp = targetRoom.loadedRoom.safeZones[0].spawnPoint;
      player.x = sp.x;
      player.y = sp.y;
    } else {
      player.x = 100;
      player.y = targetRoom.loadedRoom.floorYPx;
    }

    player.vx = 0;
    player.vy = 0;
    player.isGrounded = true;
    player.state = 'ON_FLOOR';
    player.stunnedTimer = 0;
    player.tackleCooldown = 0;
    player.attackCooldown = 0;

    // Snap player Y to the target room's floor if staging rect places them above it
    const targetFloor = targetRoom.loadedRoom.floorYPx;
    if (player.y < targetFloor - 10) {
      // Keep Y as set by staging rect (they may be on an elevated platform)
    } else {
      player.y = targetFloor;
    }

    // Move carried item with player
    const carried = this.playerItems.get(playerId);
    if (carried) {
      carried.roomId = targetRoomId;
      carried.x = player.x;
      carried.y = player.y;
    }

    // Update player room map and add to target room
    this.playerRoomMap.set(playerId, targetRoomId);
    targetRoom.addPlayer(player);

    return true;
  }

  /**
   * Atomic item pickup:
   * Rule: A player may carry at most one item.
   */
  public pickupItem(playerId: string, itemId?: string): boolean {
    if (this.playerItems.has(playerId)) {
      return false; // Already carrying an item!
    }

    const room = this.getPlayerRoom(playerId);
    if (!room) return false;

    const player = room.getPlayer(playerId);
    if (!player) return false;

    const item = room.pickupGroundItem(player, itemId);
    if (!item) return false;

    this.playerItems.set(playerId, item);
    return true;
  }

  /**
   * Atomic item drop:
   * Drops carried item to the floor at the player's feet.
   */
  public dropItem(playerId: string): boolean {
    const item = this.playerItems.get(playerId);
    if (!item) return false;

    const room = this.getPlayerRoom(playerId);
    if (!room) return false;

    const player = room.getPlayer(playerId);
    if (!player) return false;

    this.playerItems.delete(playerId);
    room.dropItem(item, player.x, player.y);
    return true;
  }

  /**
   * Atomic item handoff between two players in the same room.
   */
  public handoffItem(giverId: string, receiverId: string): boolean {
    const giverRoomId = this.playerRoomMap.get(giverId);
    const receiverRoomId = this.playerRoomMap.get(receiverId);

    if (giverRoomId === undefined || giverRoomId !== receiverRoomId) {
      return false; // Players must be in the same room
    }

    const item = this.playerItems.get(giverId);
    if (!item) return false; // Giver has no item

    if (this.playerItems.has(receiverId)) {
      return false; // Receiver already carrying an item
    }

    const room = this.activeRooms.get(giverRoomId)!;
    const giver = room.getPlayer(giverId);
    const receiver = room.getPlayer(receiverId);

    if (!giver || !receiver) return false;

    const HANDOFF_MAX_DIST = 64; // 2 tiles reach
    const dist = Math.hypot(giver.x - receiver.x, giver.y - receiver.y);
    if (dist > HANDOFF_MAX_DIST) {
      return false; // Too far apart
    }

    // Atomic transfer
    this.playerItems.delete(giverId);
    item.carriedByPlayerId = receiverId;
    this.playerItems.set(receiverId, item);
    return true;
  }

  /**
   * Safe disconnect drop:
   * "Items held by a disconnecting player return to the nearest valid grounded platform
   * directly below them; items are never destroyed or duplicated."
   */
  public handlePlayerDisconnect(playerId: string): void {
    const item = this.playerItems.get(playerId);
    const room = this.getPlayerRoom(playerId);

    if (item && room) {
      const player = room.getPlayer(playerId);
      const dropX = player ? player.x : item.x;
      const dropY = player ? player.y : item.y;
      this.playerItems.delete(playerId);
      room.dropItem(item, dropX, dropY);
    }

    if (room) {
      room.removePlayer(playerId);
      const roomId = this.playerRoomMap.get(playerId)!;
      this.persistentStates.set(roomId, room.capturePersistentState());
    }

    this.players.delete(playerId);
    this.playerRoomMap.delete(playerId);
  }

  /**
   * Advance physics in all active rooms.
   */
  public update(): void {
    const DT = 1 / 30;
    this.intro.update(DT);
    for (const room of this.activeRooms.values()) {
      room.update();
    }
  }

  /**
   * Process client input and authoritative room interactions.
   */
  public handleInput(playerId: string, input: ClientInput): void {
    // Block all player input during the opening cinematic
    if (this.intro.isInputLocked()) return;

    const room = this.getPlayerRoom(playerId);
    if (!room) return;

    const player = room.getPlayer(playerId);
    if (!player) return;

    // Advance engine input
    room.handleInput(playerId, input);

    // Track interact key edge (rising edge)
    const wasPressed = this.lastInteractPressed.get(playerId) || false;
    const isPressed = Boolean(input.interact);
    this.lastInteractPressed.set(playerId, isPressed);

    if (isPressed && !wasPressed) {
      const carriedItem = this.playerItems.get(playerId);

      // 1. Try context room interaction first (cutting hatch, unlocking container, switches, rope anchor)
      const interResult = room.interact(player, carriedItem);
      if (interResult) {
        if (interResult.transitionTarget === 'Surface') {
          player.hasEscaped = true;
          player.state = 'ESCAPED';
          this.campaignComplete = true;
          return;
        }
        return;
      }

      // 2. Try atomic handoff if holding item and near teammate (and not consumed by room interaction)
      if (carriedItem) {
        for (const other of room.getPlayers()) {
          if (other.id !== playerId && Math.hypot(player.x - other.x, player.y - other.y) <= 60) {
            if (!this.playerItems.has(other.id)) {
              this.handoffItem(playerId, other.id);
              return;
            }
          }
        }
      }

      // 3. Try ground item pickup if not holding anything
      if (!carriedItem) {
        if (this.pickupItem(playerId)) {
          return;
        }
      }

      // 4. Try door transition
      const door = room.getTouchingDoor(player);
      if (door && door.targetRoomId) {
        // Room 8 check: door must be unlocked
        if (room.roomId === 8 && !room.deployedMechanisms.has('door_unlocked')) {
          return; // Still locked
        }
        // Room 10 check: hatch must be cut
        if (door.targetRoomId === 'Surface') {
          if (room.cutHatches.has('sealed_hatch')) {
            player.hasEscaped = true;
            player.state = 'ESCAPED';
            this.campaignComplete = true;
          }
          return;
        }
        if (typeof door.targetRoomId === 'number') {
          this.transitionPlayer(playerId, door.targetRoomId);
          return;
        }
      }

      // 5. If holding item and no interaction consumed it, drop item
      if (carriedItem) {
        this.dropItem(playerId);
        return;
      }
    }
  }

  /**
   * Generate state synchronization packet for a specific player.
   */
  public getClientSync(playerId: string): ClientCampaignSync | null {
    const roomId = this.playerRoomMap.get(playerId);
    if (roomId === undefined) return null;

    const room = this.activeRooms.get(roomId);
    if (!room) return null;

    const player = room.getPlayer(playerId);
    const carried = this.playerItems.get(playerId) || null;

    const switchTimersObj: Record<string, number> = {};
    for (const [k, v] of room.switchTimers.entries()) {
      switchTimersObj[k] = Math.ceil(v);
    }

    const teamRoster: Array<{ id: string; name: string; roomId: number }> = [];
    for (const [pId, p] of this.players.entries()) {
      teamRoster.push({
        id: pId,
        name: p.name,
        roomId: this.playerRoomMap.get(pId) || 1
      });
    }

    return {
      mode: 'campaign',
      sessionCode: this.id,
      roomId: room.roomId,
      roomName: room.loadedRoom.name,
      roomWidth: room.loadedRoom.widthPx,
      roomHeight: room.loadedRoom.heightPx,
      floorY: room.loadedRoom.floorYPx,
      walls: room.loadedRoom.walls,
      doors: room.loadedRoom.doors,
      safeZones: room.loadedRoom.safeZones,
      ladders: room.engine.state.ladders,
      groundItems: Array.from(room.groundItems.values()),
      carriedItem: carried,
      players: room.getPlayers(),
      puzzleState: {
        activatedSwitches: Array.from(room.activatedSwitches),
        deployedMechanisms: Array.from(room.deployedMechanisms),
        cutHatches: Array.from(room.cutHatches),
        unlockedContainers: Array.from(room.unlockedContainers),
        searchlightX: room.roomId === 4 ? room.searchlightX : undefined,
        guardX: room.roomId === 7 ? room.guardX : undefined,
        switchTimers: room.roomId === 8 ? switchTimersObj : undefined,
        campaignComplete: this.campaignComplete
      },
      interactionPrompt: player ? room.getPrompt(player, carried || undefined) : null,
      teamRoster,
      intro: (this.intro.hasStarted() && !this.intro.isComplete()) ? { ...this.intro.state } : null
    };
  }
}
