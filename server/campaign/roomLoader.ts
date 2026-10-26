import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CampaignProjectSpec,
  RoomDefinition,
  TileRect,
  TilePoint
} from './types.js';
import { WallRect, Ladder } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultSpecPath = path.join(__dirname, '../../the_pit_level_spec_v1.json');

export const TILE_SIZE = 32;
export const STANDARD_ROOM_HEIGHT_TILES = 20;

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DoorTrigger {
  id: string;
  rect: PixelRect;
  type: string;
  targetRoomId?: number | 'Surface';
  targetEntryDoorId?: string;
  stagingRect?: PixelRect;
}

export interface SafeZone {
  id: string;
  rect: PixelRect;
  spawnPoint: { x: number; y: number };
}

export interface LoadedCampaignItem {
  id: string;
  type: string;
  x: number;
  y: number;
}

export interface LoadedRoom {
  id: number;
  name: string;
  widthTiles: number;
  heightTiles: number;
  widthPx: number;
  heightPx: number;
  floorYPx: number;
  walls: WallRect[];
  doors: DoorTrigger[];
  safeZones: SafeZone[];
  items: LoadedCampaignItem[];
  ladders: Ladder[];
  anchors: Array<{ id: string; x: number; y: number }>;
  switches: string[];
  containers: string[];
  rawDefinition: RoomDefinition;
}

/**
 * Convert abstract tile rectangle [xMin, yMin, xMax, yMax] into engine pixel rect { x, y, width, height }.
 * Tile coordinate system origin is bottom-left (Y=0 bottom, Y=heightTiles ceiling).
 * Engine coordinate system origin is top-left (Y=0 ceiling, Y increases downward).
 */
export function tileRectToPixel(rect: TileRect, roomHeightTiles: number = STANDARD_ROOM_HEIGHT_TILES): PixelRect {
  const [xMin, yMin, xMax, yMax] = rect;
  const x = xMin * TILE_SIZE;
  const width = (xMax - xMin) * TILE_SIZE;
  const y = (roomHeightTiles - yMax) * TILE_SIZE;
  const height = (yMax - yMin) * TILE_SIZE;
  return { x, y, width, height };
}

/**
 * Convert tile point [x, y] to engine pixel point { x, y }.
 */
export function tilePointToPixel(point: TilePoint, roomHeightTiles: number = STANDARD_ROOM_HEIGHT_TILES): { x: number; y: number } {
  return {
    x: point[0] * TILE_SIZE,
    y: (roomHeightTiles - point[1]) * TILE_SIZE
  };
}

let cachedSpec: CampaignProjectSpec | null = null;

export function loadCampaignSpec(specFilePath: string = defaultSpecPath): CampaignProjectSpec {
  if (cachedSpec && specFilePath === defaultSpecPath) {
    return cachedSpec;
  }
  const content = fs.readFileSync(specFilePath, 'utf8');
  const parsed = JSON.parse(content) as CampaignProjectSpec;
  if (specFilePath === defaultSpecPath) {
    cachedSpec = parsed;
  }
  return parsed;
}

/**
 * Convert a RoomDefinition from the specification into runtime room geometry and triggers.
 */
export function loadRoomFromSpec(roomId: number, spec?: CampaignProjectSpec): LoadedRoom {
  const projectSpec = spec || loadCampaignSpec();
  const roomDef = projectSpec.project.rooms.find(r => r.id === roomId);
  if (!roomDef) {
    throw new Error(`Room ID ${roomId} not found in campaign specification`);
  }

  const widthTiles = roomDef.bounds.x[1] - roomDef.bounds.x[0];
  const heightTiles = roomDef.bounds.y[1] - roomDef.bounds.y[0];
  const widthPx = widthTiles * TILE_SIZE;
  const heightPx = heightTiles * TILE_SIZE;

  const walls: WallRect[] = [];
  const doors: DoorTrigger[] = [];
  const safeZones: SafeZone[] = [];
  const items: LoadedCampaignItem[] = [];
  const ladders: Ladder[] = [];
  const anchors: Array<{ id: string; x: number; y: number }> = [];
  const switches: string[] = [];
  const containers: string[] = [];

  // Default floor Y: look for main_floor or floor platform
  let floorYPx = heightPx - (3 * TILE_SIZE); // Default to tile Y=3 (544 px for 20-tile room)

  // 1. Boundary walls (solid left, right, ceiling)
  walls.push({ x: 0, y: 0, width: 16, height: heightPx, solid: true });
  walls.push({ x: widthPx - 16, y: 0, width: 16, height: heightPx, solid: true });
  walls.push({ x: 0, y: 0, width: widthPx, height: 16, solid: true });

  // 2. Geometry elements
  for (const elem of roomDef.geometry) {
    if (elem.rect) {
      const pRect = tileRectToPixel(elem.rect, heightTiles);

      if (elem.type === 'platform') {
        walls.push({
          x: pRect.x,
          y: pRect.y,
          width: pRect.width,
          height: pRect.height,
          isPlatform: true
        });

        if (elem.id === 'main_floor' || elem.id === 'lower_floor' || elem.id === 'floor') {
          floorYPx = pRect.y;
        }
      } else if (elem.type === 'cover' || elem.type === 'movable' || elem.type === 'movable_panel') {
        walls.push({
          x: pRect.x,
          y: pRect.y,
          width: pRect.width,
          height: pRect.height,
          solid: true,
          isPlatform: true
        });
      } else if (elem.type === 'door' || elem.type === 'hatch') {
        doors.push({
          id: elem.id,
          rect: pRect,
          type: elem.type
        });
      } else if (elem.type === 'safe_zone') {
        safeZones.push({
          id: elem.id,
          rect: pRect,
          spawnPoint: {
            x: pRect.x + pRect.width / 2,
            y: pRect.y + pRect.height // feet at bottom of safe zone
          }
        });
      } else if (elem.type === 'climbable') {
        // Room 3, 6, 7 pipes/ladders start placed; Room 10 emergency_ladder starts unplaced until deployed
        const isEmergency = elem.id === 'emergency_ladder';
        ladders.push({
          id: elem.id,
          x: pRect.x + pRect.width / 2,
          y: pRect.y,
          width: Math.max(20, pRect.width),
          height: pRect.height,
          state: isEmergency ? 'CARRIED' : 'PLACED',
          carriedByPlayerId: null,
          isPlaced: !isEmergency,
          leanAngle: 0
        });
      } else if (elem.type === 'switch') {
        switches.push(elem.id);
      } else if (elem.type === 'container') {
        containers.push(elem.id);
      }
    } else if (elem.point) {
      const pt = tilePointToPixel(elem.point, heightTiles);
      if (elem.type === 'anchor') {
        anchors.push({ id: elem.id, x: pt.x, y: pt.y });
      } else if (elem.type === 'switch') {
        switches.push(elem.id);
      } else if (elem.type === 'container') {
        containers.push(elem.id);
      } else if (elem.type === 'item_spawn') {
        const itemType = elem.id.includes('key') ? 'key' : 'optional_rope';
        items.push({
          id: elem.id === 'key_niche' ? 'brass_key' : elem.id,
          type: itemType,
          x: pt.x,
          y: pt.y
        });
      }
    }
  }

  // 3. Populate transition targets from campaign graph matching exit rects
  const transitionEdges = projectSpec.project.campaign_graph?.transition_network || [];
  for (const door of doors) {
    // Find edge where from === roomId and exit bounds match
    const matchingEdge = transitionEdges.find(e => {
      if (e.from !== roomId) return false;
      if (e.exit) {
        const exitPx = tileRectToPixel(e.exit, heightTiles);
        return Math.abs(door.rect.x - exitPx.x) < 8 && Math.abs(door.rect.y - exitPx.y) < 8;
      }
      return false;
    }) || transitionEdges.find(e => e.from === roomId);

    if (matchingEdge) {
      door.targetRoomId = matchingEdge.to;
      if (matchingEdge.staging) {
        door.stagingRect = tileRectToPixel(matchingEdge.staging, heightTiles);
      }
    }
  }

  // 4. Room items
  if (roomDef.items) {
    for (const itm of roomDef.items) {
      const pt = tilePointToPixel(itm.point, heightTiles);
      items.push({
        id: itm.id,
        type: itm.type,
        x: pt.x,
        y: pt.y
      });
    }
  }

  return {
    id: roomDef.id,
    name: roomDef.name,
    widthTiles,
    heightTiles,
    widthPx,
    heightPx,
    floorYPx,
    walls,
    doors,
    safeZones,
    items,
    ladders,
    anchors,
    switches,
    containers,
    rawDefinition: roomDef
  };
}
