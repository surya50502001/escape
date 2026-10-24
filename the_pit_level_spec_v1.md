# The Pit — Technical Level Specification v1 (Corrected & Mapped)

**Status:** Corrected blueprint specification; validated against server physics integration ($v_{y0} = -340\text{ px/s}, g = 750\text{ px/s}^2, \Delta t = 1/30\text{ s}$).  
**Camera/style:** Clean 2D cartoon, side-scrolling with horizontal movement and vertical climbing.  
**Team:** 4–5 players, single cooperative team (with 1–3 player scalability).  
**Coordinate convention:** Room-local abstract tiles, origin at bottom-left ($Y=0$ is floor bottom, $Y=20$ is room ceiling), $X=0..50, Y=0..20$.  
**Rectangle format:** Strict `[xMin, yMin, xMax, yMax]` where $x_{\min} < x_{\max}$ and $y_{\min} < y_{\max}$.

---

## Non-negotiable global rules

1. **Server Authority:** Server is authoritative for movement, collision, interactions, inventory, guard states, puzzle logic, and transitions.
2. **One Carried Item:** A player may carry at most one item. Pickup, drop, and handoff operations are atomic server-side transactions.
3. **Safe Disconnect Drop:** Items held by a disconnecting player return to the nearest valid grounded platform directly below them; items are never destroyed or duplicated.
4. **Room Persistence:** Visited room states (opened boxes, moved panels, deployed ropes, cut hatches) persist throughout the campaign session.
5. **Guaranteed Critical Items:** Mandatory progression items (Room 9 cutting tool, keys) have fixed, non-randomized locations.
6. **No Irreversible Softlocks:** Every puzzle has an anti-softlock recovery route. No puzzle requires permanent capture, impossible sprint windows, or unrecoverable item loss.
7. **Multiplayer Transition Safety:** 15-second airlock evacuation warning auto-evacuates delayed, downed, or disconnected players into the safe staging zone of the new room without bypassing puzzle triggers.
8. **Physics Alignment:** 1 abstract tile $= 32\text{ px}$. Normal jump apex $= 71.5\text{ px}$ ($2.23\text{ tiles}$). Cooperative launch boost $= 171.7\text{ px}$ ($5.36\text{ tiles}$) with $v_{\text{boost}} = -520\text{ px/s}$.
9. **Independent Room Presence During Backtracking:** A Room 10 -> Room 9 transition must not move teammates out of Room 10. The 15-second airlock evacuation warning applies to forward progression only. Teammates remaining in Room 10 maintain independent room presence. Captured and disconnected player behavior is a documented rule requiring later runtime design and tests; leaving such players indefinitely in a room is not assumed to be automatically safe.

---

## Room transition mapping network

| From Room | Exit Mechanism / Rect | Destination Room | Entry Mechanism / Rect | Transition Type | Safe Staging Zone |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **Room 1** | `exit_door` `[47, 8, 49, 11]` | **Room 2** | `entry_door` `[0, 3, 2, 6]` | Airlock 1-2 (Stair descent) | `[2, 3, 6, 5]` |
| **Room 2** | `exit_door` `[47, 9, 49, 12]` | **Room 3** | `entry_door` `[0, 3, 2, 6]` | Airlock 2-3 (Stair descent) | `[2, 3, 6, 5]` |
| **Room 3** | `exit_door` `[47, 3, 49, 6]` | **Room 4** | `entry_door` `[0, 3, 2, 6]` | Horizontal corridor | `[2, 3, 6, 5]` |
| **Room 4** | `exit_door` `[47, 3, 49, 6]` | **Room 5** | `entry_door` `[0, 3, 2, 6]` | Horizontal corridor | `[2, 3, 6, 5]` |
| **Room 5** | `exit_door` `[47, 3, 49, 6]` | **Room 6** | `entry_door` `[0, 2, 2, 5]` | Shaft ground entry | `[2, 2, 5, 4]` |
| **Room 6** | `exit_door` `[23, 15, 25, 18]` | **Room 7** | `entry_door` `[0, 15, 2, 18]` | Upper catwalk bridge | `[3, 3, 7, 5]` (via `entry_ladder`) |
| **Room 7** | `exit_door` `[47, 3, 49, 6]` | **Room 8** | `entry_door` `[0, 3, 2, 6]` | Horizontal corridor | `[2, 3, 6, 5]` |
| **Room 8** | `exit_door` `[47, 3, 49, 6]` | **Room 9** | `entry_door` `[0, 3, 2, 6]` | Horizontal corridor | `[2, 3, 6, 5]` |
| **Room 9** | `exit_door` `[47, 3, 49, 6]` | **Room 10** | `entry_door` `[0, 3, 2, 6]` | Forward corridor | `[2, 3, 6, 5]` |
| **Room 10 (Backtrack)** | `entry_door` `[0, 3, 2, 6]` | **Room 9** | `exit_door` `[47, 3, 49, 6]` | Reverse corridor | `[43, 3, 47, 5]` |
| **Room 9 (Return)** | `exit_door` `[47, 3, 49, 6]` | **Room 10** | `entry_door` `[0, 3, 2, 6]` | Forward corridor | `[2, 3, 6, 5]` |
| **Room 10 (Final)** | `sealed_hatch` `[38, 14, 41, 17]` | **Surface** | N/A | Hatch Breach Escape | Campaign Complete |

---

## Room specifications

### Room 1 — Cell

- **Bounds:** X 0–50, Y 0–20.
- **Geometry:**
  - `main_floor` (platform): rect `[0, 2, 50, 3]`; mandatory. Full room floor prevents void falls. Top surface at Y=3.
  - `entry_spawn` (safe_zone): rect `[4, 3, 8, 5]`; mandatory. Campaign start spawn zone on main floor.
  - `boost_zone` (safe_zone): rect `[8, 3, 14, 5]`; mandatory. Designated area for cooperative boost action.
  - `upper_ledge` (platform): rect `[18, 7, 36, 8]`; mandatory. Top surface at Y=8 (160 px / 5 tiles above floor at Y=3). Reachable via boost from boost_zone [8, 3, 14, 5]. Note: Physical landing validation remains pending in Phase 2.
  - `walkway` (platform): rect `[36, 7, 50, 8]`; mandatory. Extends upper ledge to exit door.
  - `rope_anchor` (anchor): point `[31, 8]`; mandatory. Anchor to drop a climbable rope down to Y=3 floor.
  - `exit_door` (door): rect `[47, 8, 49, 11]`; mandatory. Clearance 2x3 tiles on upper walkway.
- **Transition:**
  - **Entry:** Initial campaign spawn at [4, 3, 8, 5]
  - **Exit Mapping:** Room 1 exit_door [47, 8, 49, 11] -> Airlock 1-2 (stair descent) -> Room 2 entry_door [0, 3, 2, 6]
- **Intended solution:**
  - In boost_zone, a player receives a cooperative boost (v_boost = -520 px/s) to reach the upper ledge at Y=8.
  - The elevated player moves to rope_anchor ([31, 8]) and deploys a climbable rope down to Y=3.
  - Remaining players climb the rope up to the walkway; all regroup at exit_door to transition.
- **Recovery / anti-softlock:**
  - Full-width floor catches missed jumps without fall hazard or void drop.
  - Failed boosts reset player positions to boost_zone.
  - Scalability: Works with 2-5 players.
- **Persisted state:** `anchor_secured`, `rope_deployed`, `players_in_exit_zone`.

### Room 2 — First Climb

- **Bounds:** X 0–50, Y 0–20.
- **Geometry:**
  - `main_floor` (platform): rect `[0, 2, 50, 3]`; mandatory. Full room floor at Y=3.
  - `entry_door` (door): rect `[0, 3, 2, 6]`; mandatory. Ground floor entry door from Airlock 1-2.
  - `safe_zone` (safe_zone): rect `[2, 3, 6, 5]`; mandatory. Safe arrival staging zone.
  - `crate` (movable): rect `[16, 3, 19, 5]`; mandatory. Movable 3x2 crate (surface Y=5). Pushable to mid_platform.
  - `chair` (movable): rect `[11, 3, 12, 4]`; optional. Optional 1x1 movable chair on floor.
  - `mid_platform` (platform): rect `[23, 6, 31, 7]`; mandatory. Intermediate stepping platform with top surface at Y=7.
  - `upper_ledge` (platform): rect `[33, 8, 50, 9]`; mandatory. Raised upper ledge with top surface at Y=9.
  - `reset_lever` (switch): point `[12, 3]`; mandatory. Reset switch returning crate to [16, 3, 19, 5].
  - `exit_door` (door): rect `[47, 9, 49, 12]`; mandatory. Upper exit door on raised ledge at Y=9.
- **Transition:**
  - **Entry:** Room 2 entry_door [0, 3, 2, 6] (arriving from Room 1)
  - **Exit Mapping:** Room 2 exit_door [47, 9, 49, 12] -> Airlock 2-3 (stair descent) -> Room 3 entry_door [0, 3, 2, 6]
- **Intended solution:**
  - Push crate rightward from [16, 3, 19, 5] against mid_platform [23, 6, 31, 7].
  - Jump from floor (Y=3) onto crate (Y=5, deltaY = 64 px <= 71.5 px).
  - Jump from crate (Y=5) onto mid_platform (Y=7, deltaY = 64 px <= 71.5 px).
  - Jump from mid_platform (Y=7) across 2-tile gap to upper_ledge (Y=9, deltaY = 64 px, deltaX = 64 px).
  - All players can traverse sequentially without team boosts or box stacking; regroup at exit door.
- **Recovery / anti-softlock:**
  - Full-width floor catches missed jumps.
  - Reset lever at [12, 3] restores crate position if wedged.
  - Crate position is persistent once placed, allowing all teammates to climb safely.
- **Persisted state:** `crate_transform`, `chair_transform`, `room_completed`.

### Room 3 — Sleeping Guard

- **Bounds:** X 0–50, Y 0–20.
- **Geometry:**
  - `main_floor` (platform): rect `[0, 2, 50, 3]`; mandatory. Floor at Y=3.
  - `entry_door` (door): rect `[0, 3, 2, 6]`; mandatory. Ground floor entry door from Airlock 2-3.
  - `safe_zone` (safe_zone): rect `[2, 3, 6, 5]`; mandatory. Safe arrival staging zone.
  - `cover_a` (cover): rect `[14, 3, 18, 5]`; mandatory. First solid cover block.
  - `cover_b` (cover): rect `[30, 3, 34, 5]`; mandatory. Second solid cover block.
  - `guard` (guard_spawn): point `[24, 3]`; mandatory. Sleeping guard position.
  - `noisy_crate` (movable): rect `[19, 3, 21, 4]`; optional. Crate that makes noise if pushed.
  - `bypass_ledge` (platform): rect `[21, 7, 31, 8]`; optional. High route bypass above sleeping guard.
  - `bypass_pipe` (climbable): rect `[21, 3, 22, 8]`; optional. Vertical climbable pipe providing direct access from floor (Y=3) to bypass_ledge (Y=8). Note: Interaction with existing climbable-object mechanics requires in-engine verification before claiming route is playable.
  - `exit_door` (door): rect `[47, 3, 49, 6]`; mandatory. Ground-level exit door.
- **Transition:**
  - **Entry:** Room 3 entry_door [0, 3, 2, 6] (arriving from Room 2)
  - **Exit Mapping:** Room 3 exit_door [47, 3, 49, 6] -> Horizontal corridor -> Room 4 entry_door [0, 3, 2, 6]
- **Intended solution:**
  - Sneak past sleeping guard using cover or the upper bypass ledge.
- **Recovery / anti-softlock:**
  - Captured players are placed in holding nook at [2, 3] and can be released by teammates or timeout.
- **Persisted state:** `guard_alert_state`, `guard_patrol_phase`, `capture_flags`.

### Room 4 — Sweeping Searchlight

- **Bounds:** X 0–50, Y 0–20.
- **Geometry:**
  - `main_floor` (platform): rect `[0, 2, 50, 3]`; mandatory. Floor at Y=3.
  - `entry_door` (door): rect `[0, 3, 2, 6]`; mandatory. Ground floor entry door from Room 3.
  - `safe_zone` (safe_zone): rect `[2, 3, 6, 5]`; mandatory. Safe arrival staging zone.
  - `cover_a` (cover): rect `[12, 3, 16, 6]`; mandatory. Tall solid cover blocking light.
  - `cover_b` (cover): rect `[29, 3, 33, 6]`; mandatory. Second tall solid cover.
  - `beam_sweep` (hazard_path): path/range `{'x_range': [5, 45], 'y': 3, 'cycle_seconds': 8}`; mandatory. Sweeping searchlight beam path across floor.
  - `exit_door` (door): rect `[47, 3, 49, 6]`; mandatory. Ground-level exit door.
- **Transition:**
  - **Entry:** Room 4 entry_door [0, 3, 2, 6] (arriving from Room 3)
  - **Exit Mapping:** Room 4 exit_door [47, 3, 49, 6] -> Horizontal corridor -> Room 5 entry_door [0, 3, 2, 6]
- **Intended solution:**
  - Move between cover positions during dark sweep intervals.
- **Recovery / anti-softlock:**
  - Detection raises alert timer but does not instant-kill; cover occlusion is verified server-side.
- **Persisted state:** `beam_phase`, `beam_timer`, `player_alert_state`.

### Room 5 — Hidden Compartment

- **Bounds:** X 0–50, Y 0–20.
- **Geometry:**
  - `main_floor` (platform): rect `[0, 2, 50, 3]`; mandatory. Floor at Y=3.
  - `entry_door` (door): rect `[0, 3, 2, 6]`; mandatory. Ground floor entry door from Room 4.
  - `safe_zone` (safe_zone): rect `[2, 3, 6, 5]`; mandatory. Safe arrival staging zone.
  - `movable_panel` (movable_panel): rect `[25, 3, 27, 6]`; optional. Sliding wall panel hiding secret recess.
  - `exit_door` (door): rect `[47, 3, 49, 6]`; mandatory. Ground-level exit door aligning with Room 6 entry.
- **Items:**
  - `optional_rope` (rope), optional, point `[26, 3]`. Optional rope item revealed behind panel.
- **Transition:**
  - **Entry:** Room 5 entry_door [0, 3, 2, 6] (arriving from Room 4)
  - **Exit Mapping:** Room 5 exit_door [47, 3, 49, 6] -> Direct ground passage -> Room 6 entry_door [0, 2, 2, 5]
- **Intended solution:**
  - Slide panel to reveal optional rope; proceed through ground exit door.
- **Recovery / anti-softlock:**
  - Panel movement is reversible; primary door is accessible without opening compartment.
- **Persisted state:** `panel_transform`, `compartment_revealed`, `optional_item_state`.

### Room 6 — Vertical Shaft

- **Bounds:** X 0–25, Y 0–20.
- **Geometry:**
  - `lower_floor` (platform): rect `[0, 1, 25, 2]`; mandatory. Lower foundation floor at Y=2.
  - `entry_door` (door): rect `[0, 2, 2, 5]`; mandatory. Ground-level entry door matching Room 5 exit.
  - `safe_zone` (safe_zone): rect `[2, 2, 5, 4]`; mandatory. Safe arrival staging zone at base of shaft.
  - `pipe` (climbable): rect `[8, 2, 9, 15]`; mandatory. Climbable pipe ascending the shaft.
  - `ladder` (climbable): rect `[13, 2, 14, 15]`; mandatory. Full vertical ladder.
  - `recovery_platform` (platform): rect `[7, 3, 18, 4]`; mandatory. Platform catching missed jumps at Y=4.
  - `rope_anchor` (anchor): point `[19, 15]`; mandatory. Upper anchor point to cross to shaft exit.
  - `catwalk_exit` (platform): rect `[21, 14, 25, 15]`; mandatory. Upper catwalk platform supporting players at exit door at Y=15. Note: Traversability, player collision box, ladder/rope access, and exit-door interaction require in-engine verification.
  - `exit_door` (door): rect `[23, 15, 25, 18]`; mandatory. Upper exit door leading to Room 7 entry.
- **Transition:**
  - **Entry:** Room 6 entry_door [0, 2, 2, 5] (arriving from Room 5)
  - **Exit Mapping:** Room 6 exit_door [23, 15, 25, 18] -> Upper catwalk bridge -> Room 7 entry_door [0, 15, 2, 18]
- **Intended solution:**
  - Enter at ground level, climb ladder and pipe up the shaft, use rope anchor to cross to upper-right exit.
- **Recovery / anti-softlock:**
  - Falls catch on recovery_platform (Y=3..4) with direct ladder access back up.
- **Persisted state:** `climb_state`, `recovery_trigger_state`.

### Room 7 — Patrol Route

- **Bounds:** X 0–50, Y 0–20.
- **Geometry:**
  - `main_floor` (platform): rect `[0, 2, 50, 3]`; mandatory. Floor at Y=3.
  - `entry_door` (door): rect `[0, 15, 2, 18]`; mandatory. Upper entry door from Room 6.
  - `entry_ladder` (climbable): rect `[2, 3, 3, 15]`; mandatory. Vertical ladder connecting upper entry down to main floor.
  - `safe_zone` (safe_zone): rect `[3, 3, 7, 5]`; mandatory. Safe arrival staging zone at base of entry ladder.
  - `cover_a` (cover): rect `[10, 3, 14, 5]`; mandatory. Cover on left patrol path.
  - `cover_b` (cover): rect `[34, 3, 38, 5]`; mandatory. Cover on right patrol path.
  - `guard_patrol` (patrol_path): path/range `{'x_range': [18, 31], 'y': 3}`; mandatory. Active guard patrol path.
  - `distraction_item` (distraction): point `[8, 3]`; optional. Noise-making throwable stone.
  - `vent_shortcut` (shortcut): path/range `{'start': [14, 8], 'end': [35, 8], 'noisy': true}`; optional. Overhead duct shortcut bypassing guard patrol.
  - `exit_door` (door): rect `[47, 3, 49, 6]`; mandatory. Ground-level exit door.
- **Transition:**
  - **Entry:** Room 7 entry_door [0, 15, 2, 18] (arriving from Room 6 upper exit; descent via entry_ladder)
  - **Exit Mapping:** Room 7 exit_door [47, 3, 49, 6] -> Horizontal corridor -> Room 8 entry_door [0, 3, 2, 6]
- **Intended solution:**
  - Descend entry ladder, sneak past patrolling guard or take high-risk vent shortcut to exit.
- **Recovery / anti-softlock:**
  - Vent shortcut has exits on both sides and cannot trap players.
- **Persisted state:** `guard_position`, `guard_alert_state`, `vent_state`.

### Room 8 — Two-Switch Puzzle

- **Bounds:** X 0–50, Y 0–20.
- **Geometry:**
  - `main_floor` (platform): rect `[0, 2, 50, 3]`; mandatory. Floor at Y=3.
  - `entry_door` (door): rect `[0, 3, 2, 6]`; mandatory. Ground floor entry door from Room 7.
  - `safe_zone` (safe_zone): rect `[2, 3, 6, 5]`; mandatory. Safe arrival staging zone.
  - `switch_a` (switch): point `[12, 3]`; mandatory. Pressure plate A (12s pneumatic latch in solo fallback).
  - `switch_b` (switch): point `[36, 3]`; mandatory. Pressure plate B.
  - `crate` (movable): rect `[24, 3, 26, 5]`; mandatory. Heavy crate to weigh down switch.
  - `reset_lever` (switch): point `[20, 3]`; mandatory. Reset lever returning crate to spawn.
  - `exit_door` (door): rect `[47, 3, 49, 6]`; mandatory. Exit door with persistent unlock.
- **Transition:**
  - **Entry:** Room 8 entry_door [0, 3, 2, 6] (arriving from Room 7)
  - **Exit Mapping:** Room 8 exit_door [47, 3, 49, 6] -> Horizontal corridor -> Room 9 entry_door [0, 3, 2, 6]
- **Intended solution:**
  - Cooperative Mode: Place crate on one switch; a teammate activates the second switch.
  - Persistent Unlock: Once both switches are simultaneously satisfied, exit_door permanently unlocks (exit_door_unlocked = true).
  - Solo Player Latch Fallback: If only 1 player is active, Switch A features a 12-second pneumatic latch delay, allowing the solo player to sprint across to Switch B in 6 seconds and achieve simultaneous activation.
- **Recovery / anti-softlock:**
  - Crate reset lever returns crate to spawn without resetting door progress. Door cannot crush players.
- **Persisted state:** `switch_a_active`, `switch_b_active`, `exit_door_unlocked`, `crate_transform`.

### Room 9 — Locked Storage

- **Bounds:** X 0–50, Y 0–20.
- **Geometry:**
  - `main_floor` (platform): rect `[0, 2, 50, 3]`; mandatory. Floor at Y=3.
  - `entry_door` (door): rect `[0, 3, 2, 6]`; mandatory. Ground floor entry door from Room 8.
  - `safe_zone` (safe_zone): rect `[2, 3, 6, 5]`; mandatory. Safe arrival staging zone.
  - `key_niche` (item_spawn): point `[8, 3]`; mandatory. Pedestal holding reusable master key.
  - `box_a` (container): point `[20, 3]`; optional. Empty locker/box A.
  - `box_b` (container): point `[28, 3]`; optional. Empty locker/box B.
  - `box_c` (container): point `[36, 3]`; mandatory. Heavy locker C containing cutting tool.
  - `exit_door` (door): rect `[47, 3, 49, 6]`; mandatory. Ground-level exit door to Room 10.
- **Items:**
  - `cutting_tool` (cutting_tool), mandatory, point `[36, 3]`. Guaranteed cutting tool inside Box C.
- **Transition:**
  - **Entry:** Room 9 entry_door [0, 3, 2, 6] (arriving from Room 8)
  - **Exit Mapping:** Room 9 exit_door [47, 3, 49, 6] -> Forward corridor -> Room 10 entry_door [0, 3, 2, 6]
  - **Backtrack Mapping:** Room 10 return_door [0, 3, 2, 6] -> Reverse corridor -> Room 9 exit_door [47, 3, 49, 6] (staging zone [43, 3, 47, 5])
- **Intended solution:**
  - Pick up key at niche, unlock Box C to obtain cutting tool. Key is reusable and box remains permanently unlocked.
- **Recovery / anti-softlock:**
  - Key cannot be destroyed; Box C state is server-persisted across visits and backtracking.
- **Persisted state:** `key_state`, `box_c_unlocked`, `cutting_tool_state`.

### Room 10 — False Escape & Backtrack Loop

- **Bounds:** X 0–50, Y 0–20.
- **Geometry:**
  - `main_floor` (platform): rect `[0, 2, 50, 3]`; mandatory. Floor at Y=3.
  - `entry_door` (door): rect `[0, 3, 2, 6]`; mandatory. Ground floor entry door from Room 9 (also acts as return_door).
  - `safe_zone` (safe_zone): rect `[2, 3, 6, 5]`; mandatory. Safe arrival staging zone.
  - `step_a` (platform): rect `[6, 3, 9, 4]`; mandatory. First intermediate step with surface at Y=4 (deltaY = 32 px from floor).
  - `platform_a` (platform): rect `[11, 5, 18, 6]`; mandatory. First elevated platform with surface at Y=6 (deltaY = 64 px from step_a).
  - `step_b` (platform): rect `[20, 7, 23, 8]`; mandatory. Second intermediate step with surface at Y=8 (deltaY = 64 px from platform_a).
  - `platform_b` (platform): rect `[25, 9, 32, 10]`; mandatory. Second elevated platform with surface at Y=10 (deltaY = 64 px from step_b).
  - `step_c` (platform): rect `[34, 11, 37, 12]`; mandatory. Third intermediate step with surface at Y=12 (deltaY = 64 px from platform_b).
  - `platform_c` (platform): rect `[26, 13, 44, 14]`; mandatory. Top scaffold platform holding the sealed hatch (surface Y=14, deltaY = 64 px from step_c).
  - `emergency_ladder` (climbable): rect `[28, 3, 29, 14]`; mandatory. Emergency ladder deployed once platform C is reached, connecting floor Y=3 directly to Y=14.
  - `sealed_hatch` (hatch): rect `[38, 14, 41, 17]`; mandatory. Final escape hatch reinforced with steel bars on Platform C.
  - `cut_interaction` (interaction_zone): rect `[36, 14, 42, 16]`; mandatory. Zone to interact with cutting tool to breach hatch.
- **Transition:**
  - **Entry:** Room 10 entry_door [0, 3, 2, 6] (arriving from Room 9)
  - **Exit Mapping:** None (terminal room; progression is via sealed_hatch escape or backtrack_mapping return)
  - **Backtrack Mapping:** Room 10 entry_door [0, 3, 2, 6] -> Reverse corridor -> Room 9 exit_door [47, 3, 49, 6]
  - **Final Exit:** sealed_hatch [38, 14, 41, 17] -> Surface breach -> Campaign complete
- **Intended solution:**
  - Initial climb: Jump step_a (Y=4) -> platform_a (Y=6) -> step_b (Y=8) -> platform_b (Y=10) -> step_c (Y=12) -> platform_c (Y=14). All deltaY <= 64 px <= 71.5 px.
  - Reach Platform C and inspect sealed_hatch at [38, 14, 41, 17]. Discover rebar requiring cutting tool.
  - Inspection deploys emergency_ladder at [28, 3, 29, 14], connecting platform_c (Y=14) straight to floor (Y=3).
  - Solo carrier drops to floor and backtracks via entry_door [0, 3, 2, 6] to Room 9.
  - Retrieve cutting_tool from Box C in Room 9 and return to Room 10.
  - Solo carrier climbs emergency_ladder straight from Y=3 to Y=14 without repeating jumps or needing boosts.
  - Interact with cut_interaction using cutting_tool to breach hatch and complete campaign.
- **Recovery / anti-softlock:**
  - Full-width floor catches missed jumps.
  - Emergency ladder remains permanently deployed once triggered, enabling unlimited safe ascents.
  - Return door to Room 9 remains unlocked throughout.
- **Persisted state:** `false_escape_discovered`, `emergency_ladder_deployed`, `hatch_cut`, `campaign_complete`.

---

## Campaign progression graph

```
Room 1 ──> Room 2 ──> Room 3 ──> Room 4 ──> Room 5 ──> Room 6 ──> Room 7 ──> Room 8 ──> Room 9 ──> Room 10
                                                                                         ▲           │
                                                                                         └───────────┘
                                                                                         (Backtrack)
```

* **Main Path:** $1 \rightarrow 2 \rightarrow 3 \rightarrow 4 \rightarrow 5 \rightarrow 6 \rightarrow 7 \rightarrow 8 \rightarrow 9 \rightarrow 10$
* **Backtrack Loop:** $10 \rightarrow 9 \rightarrow 10$

---

## Minimum acceptance tests (T01–T12)

| ID | Test | Pass condition | In-Engine Test Needed |
|---|---|---|:---:|
| **T01** | Room 1 Boost with 4 Players | Player reaches $Y=8$ upper ledge using boost; rope lowers; team exits | Yes |
| **T02** | Room 1 Small-Team Scaling | 2 and 3 player teams can complete boost/rope sequence | Yes |
| **T03** | 1-Carried-Item Invariant | Picking up second item drops currently carried item atomically | Yes |
| **T04** | Disconnect Carrying Critical Item | Item safely drops to floor underneath player; zero cloning or loss | Yes |
| **T05** | 15s Airlock Evacuation | Trailing/downed players caught up into safe staging area | Yes |
| **T06** | Room 8 Persistent Unlock | Simultaneous switches trigger permanent door open; reset lever functions | Yes |
| **T07** | Room 9 Key Safety | Key never consumed or destroyed; Box C remains unlocked | Yes |
| **T08** | Room 10 Backtrack Loop | $10 \rightarrow 9 \rightarrow 10$ loop permits solo re-climb via emergency ladder and hatch cut | Yes |
| **T09** | Room State Persistence | Visited room objects/switches/boxes maintain state across transitions | Yes |
| **T10** | Guard Capture & Recovery | Captured player in holding nook can be freed; zero transition deadlock | Yes |
| **T11** | Searchlight Occlusion | Solid cover blocks detection server-side | Yes |
| **T12** | Stuck Movable Reset | Crate/chair reset restores valid spawn position | Yes |
