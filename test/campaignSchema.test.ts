import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateTileRect,
  validateTilePoint,
  validateRoomDefinition,
  validatePuzzleDependencies,
  validateCampaignGraph,
  validateCampaignProjectSpec,
  validateMarkdownConsistency
} from '../server/campaign/schemaValidator.js';
import {
  CampaignProjectSpec,
  RoomDefinition,
  CampaignGraph
} from '../server/campaign/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const jsonPath = path.join(rootDir, 'the_pit_level_spec_v1.json');
const mdPath = path.join(rootDir, 'the_pit_level_spec_v1.md');

const rawJson = fs.readFileSync(jsonPath, 'utf8');
const campaignSpec = JSON.parse(rawJson) as CampaignProjectSpec;
const rawMarkdown = fs.readFileSync(mdPath, 'utf8');

describe('Campaign Specification & Schema Validation', () => {

  it('validates the complete the_pit_level_spec_v1.json with zero schema errors', () => {
    const result = validateCampaignProjectSpec(campaignSpec);
    if (!result.valid) {
      console.error('Validation errors:', result.errors);
    }
    assert.equal(result.valid, true, 'the_pit_level_spec_v1.json must be 100% valid against the campaign schema');
    assert.equal(result.errors.length, 0, 'Must have zero schema errors on valid specification');
    assert.equal(campaignSpec.project.rooms.length, 10, 'Must contain all 10 campaign rooms');
  });

  describe('Strict Rectangle Convention [xMin, yMin, xMax, yMax]', () => {
    it('accepts valid rectangles with xMin < xMax and yMin < yMax', () => {
      const err = validateTileRect([0, 2, 50, 3], 'valid_platform');
      assert.equal(err, null);
    });

    it('rejects rectangles where xMin >= xMax (inverted or zero-width)', () => {
      const err1 = validateTileRect([10, 2, 5, 4], 'inverted_x');
      assert.ok(err1);
      assert.equal(err1.code, 'MALFORMED_RECT_X');
      assert.match(err1.message, /xMin \(10\) must be strictly less than xMax \(5\)/);

      const err2 = validateTileRect([10, 2, 10, 4], 'zero_width');
      assert.ok(err2);
      assert.equal(err2.code, 'MALFORMED_RECT_X');
    });

    it('rejects rectangles where yMin >= yMax (inverted or zero-height)', () => {
      const err1 = validateTileRect([0, 8, 10, 5], 'inverted_y');
      assert.ok(err1);
      assert.equal(err1.code, 'MALFORMED_RECT_Y');
      assert.match(err1.message, /yMin \(8\) must be strictly less than yMax \(5\)/);

      const err2 = validateTileRect([0, 5, 10, 5], 'zero_height');
      assert.ok(err2);
      assert.equal(err2.code, 'MALFORMED_RECT_Y');
    });

    it('rejects rectangles with non-numeric, NaN, or non-finite values', () => {
      const errNaN = validateTileRect([0, 2, NaN, 5], 'nan_rect');
      assert.ok(errNaN);
      assert.equal(errNaN.code, 'INVALID_COORDINATE_VALUE');

      const errStr = validateTileRect([0, 2, '50' as unknown as number, 5], 'string_rect');
      assert.ok(errStr);
      assert.equal(errStr.code, 'INVALID_COORDINATE_VALUE');

      const errLength = validateTileRect([0, 2, 50], 'short_rect');
      assert.ok(errLength);
      assert.equal(errLength.code, 'INVALID_RECT_LENGTH');
    });
  });

  describe('Point and Coordinate Convention', () => {
    it('accepts valid 2D points', () => {
      assert.equal(validateTilePoint([12, 3], 'valid_point'), null);
    });

    it('rejects points with invalid dimensions or non-finite numbers', () => {
      assert.ok(validateTilePoint([12], 'too_short'));
      assert.ok(validateTilePoint([12, 3, 5], 'too_long'));
      assert.ok(validateTilePoint([12, Infinity], 'infinity_val'));
    });
  });

  describe('Room Geometry & Boundary Validation', () => {
    it('rejects geometry extending outside room boundary', () => {
      const invalidRoom: RoomDefinition = {
        id: 99,
        name: 'Out of Bounds Room',
        bounds: { x: [0, 50], y: [0, 20] },
        geometry: [
          {
            id: 'overflow_platform',
            type: 'platform',
            rect: [40, 2, 55, 3] // Extends past x=50
          }
        ]
      };

      const errors = validateRoomDefinition(invalidRoom);
      assert.ok(errors.some(e => e.code === 'OUT_OF_BOUNDS_RECT'));
    });

    it('rejects point items placed outside room boundary', () => {
      const invalidRoom: RoomDefinition = {
        id: 98,
        name: 'Out of Bounds Item Room',
        bounds: { x: [0, 50], y: [0, 20] },
        geometry: [
          { id: 'floor', type: 'platform', rect: [0, 2, 50, 3] }
        ],
        items: [
          { id: 'lost_key', type: 'key', point: [60, 3] } // Extends past x=50
        ]
      };

      const errors = validateRoomDefinition(invalidRoom);
      assert.ok(errors.some(e => e.code === 'OUT_OF_BOUNDS_ITEM'));
    });

    it('rejects duplicate geometry element identifiers within a room', () => {
      const duplicateRoom: RoomDefinition = {
        id: 97,
        name: 'Duplicate Id Room',
        bounds: { x: [0, 50], y: [0, 20] },
        geometry: [
          { id: 'door_exit', type: 'door', rect: [47, 3, 49, 6] },
          { id: 'door_exit', type: 'door', rect: [0, 3, 2, 6] }
        ]
      };

      const errors = validateRoomDefinition(duplicateRoom);
      assert.ok(errors.some(e => e.code === 'DUPLICATE_ELEMENT_ID'));
    });

    it('rejects duplicate item identifiers within a room', () => {
      const duplicateItemRoom: RoomDefinition = {
        id: 96,
        name: 'Duplicate Item Room',
        bounds: { x: [0, 50], y: [0, 20] },
        geometry: [{ id: 'floor', type: 'platform', rect: [0, 2, 50, 3] }],
        items: [
          { id: 'tool_key', type: 'key', point: [5, 3] },
          { id: 'tool_key', type: 'key', point: [15, 3] }
        ]
      };

      const errors = validateRoomDefinition(duplicateItemRoom);
      assert.ok(errors.some(e => e.code === 'DUPLICATE_ITEM_ID'));
    });

    it('rejects doors with insufficient clearance (< 1 tile width or < 2 tiles height)', () => {
      const narrowDoorRoom: RoomDefinition = {
        id: 95,
        name: 'Narrow Door Room',
        bounds: { x: [0, 50], y: [0, 20] },
        geometry: [
          { id: 'crushed_door', type: 'door', rect: [47, 3, 47.5, 4] } // width 0.5, height 1
        ]
      };

      const errors = validateRoomDefinition(narrowDoorRoom);
      assert.ok(errors.some(e => e.code === 'INSUFFICIENT_DOOR_CLEARANCE'));
    });
  });

  describe('Cross-Room Puzzle Dependency Validation', () => {
    it('detects missing reset lever in rooms with movable crates (anti-softlock rule)', () => {
      const roomsWithoutReset: RoomDefinition[] = [
        {
          id: 2,
          name: 'First Climb (Unsafe)',
          bounds: { x: [0, 50], y: [0, 20] },
          geometry: [
            { id: 'crate', type: 'movable', rect: [16, 3, 19, 5] }
            // Missing reset_lever
          ]
        }
      ];

      const errors = validatePuzzleDependencies(roomsWithoutReset);
      assert.ok(errors.some(e => e.code === 'MISSING_RESET_MECHANISM' && e.roomId === 2));
    });

    it('detects missing cutting tool in Room 9', () => {
      const roomsWithoutTool: RoomDefinition[] = [
        {
          id: 9,
          name: 'Locked Storage (No Tool)',
          bounds: { x: [0, 50], y: [0, 20] },
          geometry: [
            { id: 'key_niche', type: 'item_spawn', point: [8, 3] },
            { id: 'box_c', type: 'container', point: [36, 3] }
          ],
          items: [] // Missing cutting_tool!
        }
      ];

      const errors = validatePuzzleDependencies(roomsWithoutTool);
      assert.ok(errors.some(e => e.code === 'MISSING_MANDATORY_CUTTING_TOOL' && e.roomId === 9));
    });

    it('detects missing emergency ladder in Room 10', () => {
      const roomsWithoutLadder: RoomDefinition[] = [
        {
          id: 10,
          name: 'False Escape (Trapped)',
          bounds: { x: [0, 50], y: [0, 20] },
          geometry: [
            { id: 'sealed_hatch', type: 'hatch', rect: [38, 14, 41, 17] },
            { id: 'cut_interaction', type: 'interaction_zone', rect: [36, 14, 42, 16] }
            // Missing emergency_ladder
          ]
        }
      ];

      const errors = validatePuzzleDependencies(roomsWithoutLadder);
      assert.ok(errors.some(e => e.code === 'MISSING_EMERGENCY_LADDER' && e.roomId === 10));
    });

    it('detects missing dual switches in Room 8', () => {
      const roomsWithoutSwitches: RoomDefinition[] = [
        {
          id: 8,
          name: 'Two-Switch Puzzle (Missing Switch)',
          bounds: { x: [0, 50], y: [0, 20] },
          geometry: [
            { id: 'switch_a', type: 'switch', point: [12, 3] }
            // Missing switch_b
          ]
        }
      ];

      const errors = validatePuzzleDependencies(roomsWithoutSwitches);
      assert.ok(errors.some(e => e.code === 'MISSING_DUAL_SWITCHES' && e.roomId === 8));
    });
  });

  describe('Campaign Graph & Transition Network Validation', () => {
    it('detects transition edge pointing to nonexistent destination room', () => {
      const invalidGraph: CampaignGraph = {
        main_path: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        backtrack_edges: [[10, 9], [9, 10]],
        transition_network: [
          {
            from: 1,
            to: 99, // Nonexistent!
            exit: [47, 8, 49, 11],
            entry: [0, 3, 2, 6],
            type: 'Corridor',
            staging: [2, 3, 6, 5]
          }
        ],
        rules: []
      };

      const errors = validateCampaignGraph(invalidGraph, campaignSpec.project.rooms);
      assert.ok(errors.some(e => e.code === 'INVALID_TRANSITION_TO_ROOM'));
    });

    it('detects missing backtrack edges in campaign graph', () => {
      const noBacktrackGraph: CampaignGraph = {
        main_path: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        backtrack_edges: [], // Missing [10, 9] and [9, 10]
        transition_network: campaignSpec.project.campaign_graph.transition_network,
        rules: []
      };

      const errors = validateCampaignGraph(noBacktrackGraph, campaignSpec.project.rooms);
      assert.ok(errors.some(e => e.code === 'MISSING_BACKTRACK_EDGES'));
    });
  });

  describe('Approved Level Specification Updates & Safeguards', () => {
    it('verifies Room 1 upper_ledge updated to [18, 7, 36, 8] with pending physical landing note', () => {
      const room1 = campaignSpec.project.rooms.find(r => r.id === 1)!;
      const ledge = room1.geometry.find(g => g.id === 'upper_ledge')!;
      assert.deepEqual(ledge.rect, [18, 7, 36, 8]);
      assert.ok(room1.open_questions?.some(q => q.includes('physical landing validation remains pending')));
    });

    it('verifies Room 3 bypass_pipe added at [21, 3, 22, 8] with climbable object note', () => {
      const room3 = campaignSpec.project.rooms.find(r => r.id === 3)!;
      const pipe = room3.geometry.find(g => g.id === 'bypass_pipe')!;
      assert.ok(pipe, 'bypass_pipe must exist in Room 3');
      assert.equal(pipe.type, 'climbable');
      assert.deepEqual(pipe.rect, [21, 3, 22, 8]);
      assert.ok(room3.open_questions?.some(q => q.includes('bypass_pipe')));
    });

    it('verifies Room 6 catwalk_exit added at [21, 14, 25, 15] with verification note', () => {
      const room6 = campaignSpec.project.rooms.find(r => r.id === 6)!;
      const catwalk = room6.geometry.find(g => g.id === 'catwalk_exit')!;
      assert.ok(catwalk, 'catwalk_exit must exist in Room 6');
      assert.equal(catwalk.type, 'platform');
      assert.deepEqual(catwalk.rect, [21, 14, 25, 15]);
      assert.ok(room6.open_questions?.some(q => q.includes('catwalk_exit')));
    });

    it('verifies Room 6 bounds are X 0-25 in both JSON and Markdown', () => {
      const room6 = campaignSpec.project.rooms.find(r => r.id === 6)!;
      assert.deepEqual(room6.bounds.x, [0, 25]);
      assert.match(rawMarkdown, /### Room 6[\s\S]*?- \*\*Bounds:\*\* X 0[–-]25, Y 0[–-]20\./);
    });

    it('verifies independent room presence rule added to global rules and graph', () => {
      assert.ok(campaignSpec.project.global_rules.some(r => r.includes('Independent Room Presence During Backtracking')));
      assert.match(rawMarkdown, /Independent Room Presence During Backtracking/);
      assert.ok(campaignSpec.project.campaign_graph.rules.some(r => r.includes('Independent Room Presence')));
    });
  });

  describe('Markdown vs JSON Specification Consistency', () => {
    it('asserts 100% consistency between JSON and Markdown specifications without errors', () => {
      const result = validateMarkdownConsistency(campaignSpec, rawMarkdown);
      assert.equal(result.errors.length, 0, `Expected 0 consistency errors, received: ${JSON.stringify(result.errors)}`);
      assert.equal(result.valid, true);
    });

    it('negative test: validator catches a deliberately introduced Room 6 bounds mismatch', () => {
      const tamperedMarkdown = rawMarkdown.replace(
        /- \*\*Bounds:\*\* X 0[–-]25, Y 0[–-]20\./,
        '- **Bounds:** X 0–50, Y 0–20.'
      );
      const result = validateMarkdownConsistency(campaignSpec, tamperedMarkdown);
      const room6Err = result.errors.find(e => e.roomId === 6 && e.code === 'BOUNDS_MISMATCH_MD_JSON');
      assert.ok(room6Err, 'Validator must catch tampered Room 6 bounds');
      assert.match(room6Err.message, /Room 6 bounds mismatch/);
    });

    it('negative test: validator catches a deliberately introduced "undefined" transition defect', () => {
      const tamperedMarkdown = rawMarkdown.replace(
        /- \*\*Exit Mapping:\*\* None/,
        '- **Exit Mapping:** undefined'
      );
      const result = validateMarkdownConsistency(campaignSpec, tamperedMarkdown);
      const undefinedErr = result.errors.find(e => e.roomId === 10 && e.code === 'UNDEFINED_FIELD_IN_MARKDOWN');
      assert.ok(undefinedErr, 'Validator must catch "undefined" transition artifact');
    });

    it('confirms all 85 geometry element identifiers in JSON exist in Markdown', () => {
      const result = validateMarkdownConsistency(campaignSpec, rawMarkdown);
      const missingElemErrors = result.errors.filter(e => e.code === 'MISSING_ELEMENT_IN_MD');
      assert.equal(missingElemErrors.length, 0, 'Every geometry element in JSON must be documented in Markdown');
      const totalGeom = campaignSpec.project.rooms.reduce((acc, r) => acc + r.geometry.length, 0);
      assert.equal(totalGeom, 85, 'Total geometry elements should now be 85');
    });
  });
});
