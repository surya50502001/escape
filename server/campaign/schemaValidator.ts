import {
  CampaignProjectSpec,
  RoomDefinition,
  GeometryElement,
  RoomItem,
  RoomBounds,
  TileRect,
  TilePoint,
  CampaignGraph,
  ValidationError,
  ValidationResult,
  GeometryType
} from './types.js';

export const VALID_GEOMETRY_TYPES: Set<GeometryType> = new Set([
  'platform',
  'safe_zone',
  'door',
  'anchor',
  'movable',
  'switch',
  'cover',
  'guard_spawn',
  'hazard_path',
  'movable_panel',
  'climbable',
  'patrol_path',
  'distraction',
  'shortcut',
  'item_spawn',
  'container',
  'hatch',
  'interaction_zone'
]);

/**
 * Validates that a rectangle conforms to strict [xMin, yMin, xMax, yMax] format
 * where xMin < xMax and yMin < yMax.
 */
export function validateTileRect(
  rect: unknown,
  context: string = 'rectangle',
  roomId?: number,
  elementId?: string
): ValidationError | null {
  if (!Array.isArray(rect) || rect.length !== 4) {
    return {
      roomId,
      elementId,
      code: 'INVALID_RECT_LENGTH',
      message: `${context} must be an array of exactly 4 numbers [xMin, yMin, xMax, yMax]. Received: ${JSON.stringify(rect)}`,
      severity: 'error'
    };
  }

  const [xMin, yMin, xMax, yMax] = rect;
  for (let i = 0; i < 4; i++) {
    const val = rect[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
      return {
        roomId,
        elementId,
        code: 'INVALID_COORDINATE_VALUE',
        message: `${context} index ${i} must be a finite number. Received: ${val}`,
        severity: 'error'
      };
    }
  }

  if (xMin >= xMax) {
    return {
      roomId,
      elementId,
      code: 'MALFORMED_RECT_X',
      message: `${context} xMin (${xMin}) must be strictly less than xMax (${xMax}) [xMin < xMax violation].`,
      severity: 'error'
    };
  }

  if (yMin >= yMax) {
    return {
      roomId,
      elementId,
      code: 'MALFORMED_RECT_Y',
      message: `${context} yMin (${yMin}) must be strictly less than yMax (${yMax}) [yMin < yMax violation].`,
      severity: 'error'
    };
  }

  return null;
}

/**
 * Validates that a point conforms to [x, y] format of finite numbers.
 */
export function validateTilePoint(
  point: unknown,
  context: string = 'point',
  roomId?: number,
  elementId?: string
): ValidationError | null {
  if (!Array.isArray(point) || point.length !== 2) {
    return {
      roomId,
      elementId,
      code: 'INVALID_POINT_LENGTH',
      message: `${context} must be an array of exactly 2 numbers [x, y]. Received: ${JSON.stringify(point)}`,
      severity: 'error'
    };
  }

  const [x, y] = point;
  if (typeof x !== 'number' || !Number.isFinite(x) || Number.isNaN(x) ||
      typeof y !== 'number' || !Number.isFinite(y) || Number.isNaN(y)) {
    return {
      roomId,
      elementId,
      code: 'INVALID_COORDINATE_VALUE',
      message: `${context} coordinates must be finite numbers. Received: [${x}, ${y}]`,
      severity: 'error'
    };
  }

  return null;
}

/**
 * Validates room bounds.
 */
export function validateRoomBounds(bounds: unknown, roomId: number): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!bounds || typeof bounds !== 'object') {
    errors.push({
      roomId,
      code: 'MISSING_BOUNDS',
      message: `Room ${roomId} missing bounds object.`,
      severity: 'error'
    });
    return errors;
  }

  const b = bounds as Record<string, unknown>;
  if (!Array.isArray(b.x) || b.x.length !== 2 || typeof b.x[0] !== 'number' || typeof b.x[1] !== 'number' || b.x[0] >= b.x[1]) {
    errors.push({
      roomId,
      code: 'MALFORMED_BOUNDS_X',
      message: `Room ${roomId} bounds.x must be [xMin, xMax] where xMin < xMax. Received: ${JSON.stringify(b.x)}`,
      severity: 'error'
    });
  }

  if (!Array.isArray(b.y) || b.y.length !== 2 || typeof b.y[0] !== 'number' || typeof b.y[1] !== 'number' || b.y[0] >= b.y[1]) {
    errors.push({
      roomId,
      code: 'MALFORMED_BOUNDS_Y',
      message: `Room ${roomId} bounds.y must be [yMin, yMax] where yMin < yMax. Received: ${JSON.stringify(b.y)}`,
      severity: 'error'
    });
  }

  return errors;
}

/**
 * Validates a single geometry element within room bounds.
 */
export function validateGeometryElement(
  elem: unknown,
  bounds: RoomBounds,
  roomId: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!elem || typeof elem !== 'object') {
    errors.push({
      roomId,
      code: 'MALFORMED_GEOMETRY',
      message: `Room ${roomId} has a non-object geometry element.`,
      severity: 'error'
    });
    return errors;
  }

  const g = elem as Record<string, unknown>;
  const elementId = typeof g.id === 'string' && g.id.trim().length > 0 ? g.id.trim() : '<unknown>';

  if (elementId === '<unknown>') {
    errors.push({
      roomId,
      elementId,
      code: 'MISSING_ELEMENT_ID',
      message: `Room ${roomId} geometry element is missing a non-empty string 'id'.`,
      severity: 'error'
    });
  }

  const geomType = g.type as GeometryType;
  if (!VALID_GEOMETRY_TYPES.has(geomType)) {
    errors.push({
      roomId,
      elementId,
      code: 'INVALID_GEOMETRY_TYPE',
      message: `Room ${roomId} element "${elementId}" has unrecognized type "${g.type}".`,
      severity: 'error'
    });
  }

  // Validate spatial location: element must provide rect, point, x_range/y, or start/end
  const hasRect = g.rect !== undefined;
  const hasPoint = g.point !== undefined;
  const hasXRange = g.x_range !== undefined;
  const hasStartEnd = g.start !== undefined && g.end !== undefined;

  if (!hasRect && !hasPoint && !hasXRange && !hasStartEnd) {
    errors.push({
      roomId,
      elementId,
      code: 'MISSING_SPATIAL_DEFINITION',
      message: `Room ${roomId} element "${elementId}" must declare a 'rect', 'point', 'x_range', or 'start'/'end'.`,
      severity: 'error'
    });
  }

  if (hasRect) {
    const rectErr = validateTileRect(g.rect, `Element "${elementId}" rect`, roomId, elementId);
    if (rectErr) {
      errors.push(rectErr);
    } else {
      const [rx1, ry1, rx2, ry2] = g.rect as TileRect;
      if (rx1 < bounds.x[0] || rx2 > bounds.x[1] || ry1 < bounds.y[0] || ry2 > bounds.y[1]) {
        errors.push({
          roomId,
          elementId,
          code: 'OUT_OF_BOUNDS_RECT',
          message: `Element "${elementId}" rect [${rx1}, ${ry1}, ${rx2}, ${ry2}] extends outside room bounds (X: ${bounds.x[0]}..${bounds.x[1]}, Y: ${bounds.y[0]}..${bounds.y[1]}).`,
          severity: 'error'
        });
      }

      // Semantic checks for doors and platforms
      if (geomType === 'door') {
        const width = rx2 - rx1;
        const height = ry2 - ry1;
        if (width < 1 || height < 2) {
          errors.push({
            roomId,
            elementId,
            code: 'INSUFFICIENT_DOOR_CLEARANCE',
            message: `Door "${elementId}" dimensions (${width}x${height} tiles) too small. Minimum door clearance is 1x2 tiles.`,
            severity: 'error'
          });
        }
      }
    }
  }

  if (hasPoint) {
    const ptErr = validateTilePoint(g.point, `Element "${elementId}" point`, roomId, elementId);
    if (ptErr) {
      errors.push(ptErr);
    } else {
      const [px, py] = g.point as TilePoint;
      if (px < bounds.x[0] || px > bounds.x[1] || py < bounds.y[0] || py > bounds.y[1]) {
        errors.push({
          roomId,
          elementId,
          code: 'OUT_OF_BOUNDS_POINT',
          message: `Element "${elementId}" point [${px}, ${py}] is outside room bounds (X: ${bounds.x[0]}..${bounds.x[1]}, Y: ${bounds.y[0]}..${bounds.y[1]}).`,
          severity: 'error'
        });
      }
    }
  }

  if (hasXRange) {
    if (!Array.isArray(g.x_range) || g.x_range.length !== 2 || g.x_range[0] >= g.x_range[1]) {
      errors.push({
        roomId,
        elementId,
        code: 'MALFORMED_X_RANGE',
        message: `Element "${elementId}" x_range must be [min, max] where min < max.`,
        severity: 'error'
      });
    } else if (g.x_range[0] < bounds.x[0] || g.x_range[1] > bounds.x[1]) {
      errors.push({
        roomId,
        elementId,
        code: 'OUT_OF_BOUNDS_X_RANGE',
        message: `Element "${elementId}" x_range [${g.x_range[0]}, ${g.x_range[1]}] extends outside room bounds.`,
        severity: 'error'
      });
    }
  }

  return errors;
}

/**
 * Validates all rooms, their geometry, identifiers, and puzzle structures.
 */
export function validateRoomDefinition(room: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!room || typeof room !== 'object') {
    errors.push({
      code: 'MALFORMED_ROOM',
      message: 'Room definition must be a non-null object.',
      severity: 'error'
    });
    return errors;
  }

  const r = room as Record<string, unknown>;
  const roomId = typeof r.id === 'number' ? r.id : 0;
  if (roomId < 1 || !Number.isInteger(roomId)) {
    errors.push({
      roomId,
      code: 'INVALID_ROOM_ID',
      message: `Room id must be a positive integer >= 1. Received: ${r.id}`,
      severity: 'error'
    });
  }

  if (typeof r.name !== 'string' || r.name.trim().length === 0) {
    errors.push({
      roomId,
      code: 'MISSING_ROOM_NAME',
      message: `Room ${roomId} must have a non-empty string name.`,
      severity: 'error'
    });
  }

  const boundsErrors = validateRoomBounds(r.bounds, roomId);
  errors.push(...boundsErrors);
  if (boundsErrors.length > 0) return errors;

  const bounds = r.bounds as RoomBounds;

  if (!Array.isArray(r.geometry) || r.geometry.length === 0) {
    errors.push({
      roomId,
      code: 'EMPTY_GEOMETRY',
      message: `Room ${roomId} has no geometry elements.`,
      severity: 'error'
    });
    return errors;
  }

  // Check unique geometry element IDs within the room
  const seenIds = new Set<string>();
  for (const g of r.geometry) {
    const gObj = g as Record<string, unknown>;
    const gId = typeof gObj?.id === 'string' ? gObj.id.trim() : '';
    if (gId) {
      if (seenIds.has(gId)) {
        errors.push({
          roomId,
          elementId: gId,
          code: 'DUPLICATE_ELEMENT_ID',
          message: `Room ${roomId} contains duplicate geometry identifier "${gId}".`,
          severity: 'error'
        });
      }
      seenIds.add(gId);
    }
    errors.push(...validateGeometryElement(g, bounds, roomId));
  }

  // Validate items if present
  if (Array.isArray(r.items)) {
    const seenItemIds = new Set<string>();
    for (const it of r.items) {
      const itObj = it as Record<string, unknown>;
      const itId = typeof itObj?.id === 'string' ? itObj.id.trim() : '';
      if (!itId) {
        errors.push({
          roomId,
          code: 'MISSING_ITEM_ID',
          message: `Room ${roomId} contains an item without a valid string 'id'.`,
          severity: 'error'
        });
      } else if (seenItemIds.has(itId)) {
        errors.push({
          roomId,
          elementId: itId,
          code: 'DUPLICATE_ITEM_ID',
          message: `Room ${roomId} contains duplicate item identifier "${itId}".`,
          severity: 'error'
        });
      }
      seenItemIds.add(itId);

      const ptErr = validateTilePoint(itObj?.point, `Item "${itId}" point`, roomId, itId);
      if (ptErr) {
        errors.push(ptErr);
      } else {
        const [ix, iy] = itObj.point as TilePoint;
        if (ix < bounds.x[0] || ix > bounds.x[1] || iy < bounds.y[0] || iy > bounds.y[1]) {
          errors.push({
            roomId,
            elementId: itId,
            code: 'OUT_OF_BOUNDS_ITEM',
            message: `Item "${itId}" point [${ix}, ${iy}] is outside room bounds.`,
            severity: 'error'
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validates cross-room puzzle dependencies and critical progression items.
 */
export function validatePuzzleDependencies(rooms: RoomDefinition[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const roomMap = new Map<number, RoomDefinition>();
  for (const r of rooms) roomMap.set(r.id, r);

  // 1. Room 2 movable crate must have a reset mechanism (anti-softlock)
  const room2 = roomMap.get(2);
  if (room2) {
    const hasCrate = room2.geometry.some(g => g.id === 'crate' && g.type === 'movable');
    const hasReset = room2.geometry.some(g => g.id === 'reset_lever' && g.type === 'switch');
    if (hasCrate && !hasReset) {
      errors.push({
        roomId: 2,
        code: 'MISSING_RESET_MECHANISM',
        message: 'Room 2 contains a movable crate but lacks an anti-softlock reset lever.',
        severity: 'error'
      });
    }
  }

  // 2. Room 6 must have vertical traversal and a recovery platform
  const room6 = roomMap.get(6);
  if (room6) {
    const hasClimbable = room6.geometry.some(g => g.type === 'climbable');
    const hasRecovery = room6.geometry.some(g => g.id === 'recovery_platform');
    if (!hasClimbable) {
      errors.push({
        roomId: 6,
        code: 'MISSING_VERTICAL_CLIMB',
        message: 'Room 6 (Vertical Shaft) lacks vertical climbable elements (pipe or ladder).',
        severity: 'error'
      });
    }
    if (!hasRecovery) {
      errors.push({
        roomId: 6,
        code: 'MISSING_RECOVERY_PLATFORM',
        message: 'Room 6 lacks an anti-softlock recovery platform to catch falling players.',
        severity: 'error'
      });
    }
  }

  // 3. Room 8 must have two switches and a reset lever
  const room8 = roomMap.get(8);
  if (room8) {
    const hasSwitchA = room8.geometry.some(g => g.id === 'switch_a' && g.type === 'switch');
    const hasSwitchB = room8.geometry.some(g => g.id === 'switch_b' && g.type === 'switch');
    const hasReset = room8.geometry.some(g => g.id === 'reset_lever' && g.type === 'switch');
    if (!hasSwitchA || !hasSwitchB) {
      errors.push({
        roomId: 8,
        code: 'MISSING_DUAL_SWITCHES',
        message: 'Room 8 must define both switch_a and switch_b for the two-switch puzzle.',
        severity: 'error'
      });
    }
    if (!hasReset) {
      errors.push({
        roomId: 8,
        code: 'MISSING_RESET_MECHANISM',
        message: 'Room 8 contains a puzzle crate but lacks a reset lever.',
        severity: 'error'
      });
    }
  }

  // 4. Room 9 must provide the guaranteed cutting tool in Box C
  const room9 = roomMap.get(9);
  if (room9) {
    const hasKeyNiche = room9.geometry.some(g => g.id === 'key_niche');
    const hasBoxC = room9.geometry.some(g => g.id === 'box_c');
    const hasCuttingTool = room9.items?.some(it => it.id === 'cutting_tool' && it.mandatory === true);

    if (!hasKeyNiche) {
      errors.push({
        roomId: 9,
        code: 'MISSING_KEY_NICHE',
        message: 'Room 9 must have a key_niche to spawn the master key.',
        severity: 'error'
      });
    }
    if (!hasBoxC) {
      errors.push({
        roomId: 9,
        code: 'MISSING_LOCKBOX',
        message: 'Room 9 must contain box_c to house the cutting tool.',
        severity: 'error'
      });
    }
    if (!hasCuttingTool) {
      errors.push({
        roomId: 9,
        code: 'MISSING_MANDATORY_CUTTING_TOOL',
        message: 'Room 9 must declare a mandatory cutting_tool item for the backtrack puzzle.',
        severity: 'error'
      });
    }
  }

  // 5. Room 10 must have sealed hatch, cutting interaction, and emergency ladder
  const room10 = roomMap.get(10);
  if (room10) {
    const hasHatch = room10.geometry.some(g => g.id === 'sealed_hatch' && g.type === 'hatch');
    const hasCutInteraction = room10.geometry.some(g => g.id === 'cut_interaction' && g.type === 'interaction_zone');
    const hasEmergencyLadder = room10.geometry.some(g => g.id === 'emergency_ladder' && g.type === 'climbable');

    if (!hasHatch) {
      errors.push({
        roomId: 10,
        code: 'MISSING_SEALED_HATCH',
        message: 'Room 10 must define sealed_hatch for campaign completion.',
        severity: 'error'
      });
    }
    if (!hasCutInteraction) {
      errors.push({
        roomId: 10,
        code: 'MISSING_CUT_ZONE',
        message: 'Room 10 must define cut_interaction zone for breaching the hatch.',
        severity: 'error'
      });
    }
    if (!hasEmergencyLadder) {
      errors.push({
        roomId: 10,
        code: 'MISSING_EMERGENCY_LADDER',
        message: 'Room 10 must define emergency_ladder to allow the returning solo player to climb directly to Platform C.',
        severity: 'error'
      });
    }
  }

  return errors;
}

/**
 * Validates the campaign transition graph, verifying that every exit connects
 * to a valid entry door and staging zone, and that the backtrack loop is present.
 */
export function validateCampaignGraph(
  graph: CampaignGraph,
  rooms: RoomDefinition[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const roomMap = new Map<number, RoomDefinition>();
  for (const r of rooms) roomMap.set(r.id, r);

  if (!Array.isArray(graph.main_path) || graph.main_path.length !== 10) {
    errors.push({
      code: 'INVALID_MAIN_PATH',
      message: `Campaign main_path must contain exactly 10 rooms [1..10]. Received: ${JSON.stringify(graph.main_path)}`,
      severity: 'error'
    });
  }

  // Validate backtrack edges
  const hasBacktrackTo9 = graph.backtrack_edges?.some(e => e[0] === 10 && e[1] === 9);
  const hasReturnTo10 = graph.backtrack_edges?.some(e => e[0] === 9 && e[1] === 10);
  if (!hasBacktrackTo9 || !hasReturnTo10) {
    errors.push({
      code: 'MISSING_BACKTRACK_EDGES',
      message: 'Campaign graph must define bidirectional backtrack edges [10, 9] and [9, 10].',
      severity: 'error'
    });
  }

  // Validate transition network edges
  if (!Array.isArray(graph.transition_network) || graph.transition_network.length === 0) {
    errors.push({
      code: 'EMPTY_TRANSITION_NETWORK',
      message: 'Campaign graph must have a non-empty transition_network.',
      severity: 'error'
    });
    return errors;
  }

  for (const edge of graph.transition_network) {
    const fromRoom = roomMap.get(edge.from);
    if (!fromRoom) {
      errors.push({
        roomId: edge.from,
        code: 'INVALID_TRANSITION_FROM_ROOM',
        message: `Transition edge starts from nonexistent room ${edge.from}.`,
        severity: 'error'
      });
      continue;
    }

    if (edge.to !== 'Surface') {
      const toRoom = roomMap.get(edge.to);
      if (!toRoom) {
        errors.push({
          roomId: edge.from,
          code: 'INVALID_TRANSITION_TO_ROOM',
          message: `Transition edge from Room ${edge.from} leads to nonexistent room ${edge.to}.`,
          severity: 'error'
        });
        continue;
      }

      // Entry rect must be valid
      const entryErr = validateTileRect(edge.entry, `Transition ${edge.from}->${edge.to} entry`, edge.from);
      if (entryErr) errors.push(entryErr);

      // Staging zone must be valid
      const stagingErr = validateTileRect(edge.staging, `Transition ${edge.from}->${edge.to} staging`, edge.from);
      if (stagingErr) errors.push(stagingErr);
    }

    const exitErr = validateTileRect(edge.exit, `Transition ${edge.from}->${edge.to} exit`, edge.from);
    if (exitErr) errors.push(exitErr);
  }

  return errors;
}

/**
 * Comprehensive campaign project specification validator.
 */
export function validateCampaignProjectSpec(spec: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!spec || typeof spec !== 'object') {
    return {
      valid: false,
      errors: [{ code: 'INVALID_SPEC', message: 'Specification must be a JSON object.', severity: 'error' }],
      warnings: []
    };
  }

  const root = spec as Record<string, unknown>;
  const project = root.project as Record<string, unknown> | undefined;

  if (!project || typeof project !== 'object') {
    return {
      valid: false,
      errors: [{ code: 'MISSING_PROJECT', message: 'Root object must contain a "project" property.', severity: 'error' }],
      warnings: []
    };
  }

  const roomsArr = Array.isArray(project.rooms) ? project.rooms : null;
  if (!roomsArr || roomsArr.length !== 10) {
    errors.push({
      code: 'INVALID_ROOM_COUNT',
      message: `Campaign specification must contain exactly 10 rooms. Received: ${roomsArr ? roomsArr.length : 0}`,
      severity: 'error'
    });
  }

  const typedRooms: RoomDefinition[] = [];
  if (Array.isArray(project.rooms)) {
    for (const r of project.rooms) {
      const roomErrors = validateRoomDefinition(r);
      errors.push(...roomErrors);
      if (roomErrors.length === 0) {
        typedRooms.push(r as RoomDefinition);
      }
    }
  }

  // Cross-room puzzle validation
  if (typedRooms.length > 0) {
    errors.push(...validatePuzzleDependencies(typedRooms));
  }

  // Campaign transition graph validation
  if (project.campaign_graph && typeof project.campaign_graph === 'object' && typedRooms.length > 0) {
    errors.push(...validateCampaignGraph(project.campaign_graph as CampaignGraph, typedRooms));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validates consistency between the authoritative JSON specification and the Markdown design document.
 * Reports discrepancies in room bounds, missing geometry elements, or malformed transition text.
 */
export function validateMarkdownConsistency(
  jsonSpec: CampaignProjectSpec,
  markdownContent: string
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const r of jsonSpec.project.rooms) {
    // 1. Check room bounds in Markdown
    const boundsRegex = new RegExp(`### Room ${r.id}[\\s\\S]*?- \\*\\*Bounds:\\*\\* X ([0-9]+)[–-]([0-9]+), Y ([0-9]+)[–-]([0-9]+)`);
    const match = markdownContent.match(boundsRegex);
    if (match) {
      const mdX1 = parseInt(match[1]);
      const mdX2 = parseInt(match[2]);
      const mdY1 = parseInt(match[3]);
      const mdY2 = parseInt(match[4]);

      if (r.bounds.x[0] !== mdX1 || r.bounds.x[1] !== mdX2 || r.bounds.y[0] !== mdY1 || r.bounds.y[1] !== mdY2) {
        errors.push({
          roomId: r.id,
          code: 'BOUNDS_MISMATCH_MD_JSON',
          message: `Room ${r.id} bounds mismatch: JSON specifies [${r.bounds.x[0]}..${r.bounds.x[1]}, ${r.bounds.y[0]}..${r.bounds.y[1]}], but Markdown specifies X ${mdX1}–${mdX2}, Y ${mdY1}–${mdY2}.`,
          severity: 'error'
        });
      }
    } else {
      warnings.push({
        roomId: r.id,
        code: 'MISSING_MD_BOUNDS',
        message: `Could not parse Bounds section for Room ${r.id} in Markdown.`,
        severity: 'warning'
      });
    }

    // 2. Check for literal 'undefined' string in Markdown transitions (catches Room 10 generator defect)
    const roomHeader = `### Room ${r.id} `;
    const nextRoomId = r.id + 1;
    const nextHeader = nextRoomId <= 10 ? `### Room ${nextRoomId} ` : '## Campaign progression graph';
    const startIdx = markdownContent.indexOf(roomHeader);
    const endIdx = markdownContent.indexOf(nextHeader, startIdx);
    if (startIdx !== -1 && endIdx !== -1) {
      const roomMd = markdownContent.slice(startIdx, endIdx);
      if (roomMd.includes('undefined')) {
        errors.push({
          roomId: r.id,
          code: 'UNDEFINED_FIELD_IN_MARKDOWN',
          message: `Room ${r.id} in Markdown contains literal 'undefined' text in transition mapping.`,
          severity: 'error'
        });
      }

      // Verify all geometry element IDs in JSON exist in Markdown
      for (const g of r.geometry) {
        if (!roomMd.includes(g.id)) {
          errors.push({
            roomId: r.id,
            elementId: g.id,
            code: 'MISSING_ELEMENT_IN_MD',
            message: `Room ${r.id} element "${g.id}" defined in JSON is missing from Markdown description.`,
            severity: 'error'
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
