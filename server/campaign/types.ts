/**
 * The Pit — 10-Room Cooperative Campaign Specification Types
 *
 * Defines strictly typed interfaces for room definitions, tile geometry,
 * item ownership, transition networks, puzzle dependencies, and validation.
 *
 * Standard coordinate conventions:
 * - Units: Abstract tiles (1 tile = 32 px)
 * - Origin: Bottom-left of each room (Y=0 is floor bottom, Y=20 is room ceiling)
 * - Standard room dimensions: X in [0, 50], Y in [0, 20] (except Room 6: X in [0, 25])
 * - Standard rectangle convention: [xMin, yMin, xMax, yMax] where xMin < xMax and yMin < yMax
 */

/** Standard strict rectangle format: [xMin, yMin, xMax, yMax] where xMin < xMax and yMin < yMax */
export type TileRect = [number, number, number, number];

/** Standard 2D point format: [x, y] */
export type TilePoint = [number, number];

/** Bounding interval for coordinates: [min, max] */
export type TileRange = [number, number];

export interface RoomBounds {
  x: TileRange;
  y: TileRange;
}

export type GeometryType =
  | 'platform'
  | 'safe_zone'
  | 'door'
  | 'anchor'
  | 'movable'
  | 'switch'
  | 'cover'
  | 'guard_spawn'
  | 'hazard_path'
  | 'movable_panel'
  | 'climbable'
  | 'patrol_path'
  | 'distraction'
  | 'shortcut'
  | 'item_spawn'
  | 'container'
  | 'hatch'
  | 'interaction_zone';

export interface GeometryElement {
  id: string;
  type: GeometryType;
  mandatory?: boolean;
  description?: string;
  rect?: TileRect;
  point?: TilePoint;
  x_range?: TileRange;
  y?: number;
  cycle_seconds?: number;
  start?: TilePoint;
  end?: TilePoint;
  noisy?: boolean;
}

export type RoomItemType = 'rope' | 'cutting_tool' | 'key' | 'distraction' | string;

export interface RoomItem {
  id: string;
  type: RoomItemType;
  mandatory?: boolean;
  point: TilePoint;
  description?: string;
}

export interface RoomTransition {
  entry: string;
  exit_mapping?: string;
  backtrack_mapping?: string;
  final_exit?: string;
}

export interface RoomDefinition {
  id: number;
  name: string;
  bounds: RoomBounds;
  geometry: GeometryElement[];
  transition?: RoomTransition;
  transitions?: RoomTransition;
  items?: RoomItem[];
  solution?: string[];
  recovery?: string[];
  state?: string[];
  open_questions?: string[];
}

export interface TransitionNetworkEdge {
  from: number;
  to: number | 'Surface';
  exit: TileRect;
  entry: TileRect | null;
  type: string;
  staging: TileRect | null;
}

export interface CampaignGraph {
  main_path: number[];
  backtrack_edges: [number, number][];
  transition_network: TransitionNetworkEdge[];
  rules: string[];
}

export interface CampaignTestPlanItem {
  id: string;
  name: string;
  assertion?: string;
  pass_condition?: string;
  in_engine_needed: boolean;
}

export interface CoordinateSystemSpec {
  units: string;
  origin: string;
  x_range: TileRange;
  y_range: TileRange;
  rect_convention: string;
  validation_rule: string;
  physics_scale: string;
}

export interface MovementAssumptionsSpec {
  player_hitbox_tiles: {
    width: number;
    height: number;
  };
  small_item_footprint_tiles: TileRange;
  crate_footprint_tiles: TileRange;
  door_clearance_tiles: TileRange;
  measured_physics: {
    gravity: string;
    normal_jump_vy: string;
    normal_jump_apex: string;
    boost_jump_vy: string;
    boost_jump_apex: string;
    walk_speed: string;
  };
}

export interface ProjectMetadata {
  title: string;
  document: string;
  status: string;
  camera: string;
  style: string;
  team: {
    min_players: number;
    max_players: number;
    mode: string;
  };
  coordinate_system: CoordinateSystemSpec;
  global_rules: string[];
  movement_assumptions_to_tune: MovementAssumptionsSpec;
  rooms: RoomDefinition[];
  campaign_graph: CampaignGraph;
  test_plan: CampaignTestPlanItem[];
}

export interface CampaignProjectSpec {
  project: ProjectMetadata;
}

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationError {
  roomId?: number;
  elementId?: string;
  field?: string;
  code: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}
