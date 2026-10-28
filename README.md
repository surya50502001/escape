# The Pit (Escape) — Multiplayer Co-op Prison Escape

A gritty, authoritative multiplayer co-op prison escape game featuring an underground 10-chamber facility, cooperative traversal mechanics, physics puzzles, stealth obstacles, and dual 3D (Three.js WebGL) / 2D (HTML5 Canvas) rendering pipelines.

---

## 🏛️ Game Modes

### 1. 10-Chamber Co-op Campaign
1 to 5 players work together to break out of the high-security subterranean prison facility. All progress, room states, unlocked containers, deployed ropes, cut hatches, and items persist authoritatively on the server.

- **Chamber 1 — The Dormitory Holding Block:** Co-op boost jump (`W` / `Space` in boost zone), high walkway access, rope anchor deployment to floor, and airlock transition. Includes opening prisoner arrival cinematic.
- **Chamber 2 — The Drainage Cistern:** Heavy pushable movable crate (`A`/`D` shove) bridging floor to mid platform, and reset lever if crate gets trapped.
- **Chamber 3 — The Guard Quarters:** Sleeping guard stealth evasion. Low floor crossing triggers alarm stun and returns prisoners to holding nook; players must use the high ceiling pipe and catwalk bypass.
- **Chamber 4 — Surveillance Gallery:** Sweeping searchlight spotlight. Players must dash between solid concrete pillars during dark intervals.
- **Chamber 5 — The Pipe Vault:** Movable secret panel concealing an optional climbable hemp rope.
- **Chamber 6 — The Vertical Shaft:** Multi-tier shaft traversal with a rope anchor deployable down to the recovery platform for full team climbability.
- **Chamber 7 — Patrol Corridor:** Armed patrolling sentry with visual flashlight cone.
- **Chamber 8 — Dual Switch Lock:** Simultaneous dual-switch pneumatic puzzle. Requires two switches within a 12-second window (co-op or solo sprint) to permanently unlock the blast door.
- **Chamber 9 — Secure Storage:** Key niche holding the brass key, used to unlock heavy industrial Box C and retrieve the mandatory steel cutting tool.
- **Chamber 10 — Surface Breach:** Platform climbing, emergency ladder deployment to the floor, solo backtracking to Room 9 to retrieve the cutting tool with independent room presence, reinforced steel rebar cutting, and surface breakthrough to freedom!

### 2. Survival Pit (Legacy Elimination Arena)
Up to 10 prisoners fight inside a single enclosed pit chamber for a limited escape quota overseen by an armed sniper. Pick up ropes, tackle rivals, kick or struggle on pipes, and throw rocks.

---

## 🕹️ Controls & Interaction

| Key / Input | Action |
| :--- | :--- |
| **`A` / `D`** or **`←` / `→`** | Move left / right (visually rotates character facing direction) |
| **`W` / `Space`** or **`↑`** | Jump / Climb up ladder, rope, or vertical pipe / Co-op boost in boost zone |
| **`S`** or **`↓`** | Crouch / Climb down ladder or rope / Drop from horizontal pipe |
| **`E`** | Contextual Interaction: pick up ground item, deploy ropes, activate switches, unlock Box C, cut hatch, push crate |
| **`G`** | Drop currently carried item onto the floor |
| **`F2` / Toggle Button** | Switch between 3D Three.js renderer and 2D Canvas fallback |
| **Mouse Aim & Click** | Throw rope or rock (Survival arena mode) |
| **Spacebar (in Cinematic)**| Skip opening sequence to jump straight into gameplay |

---

## 🛡️ Authoritative Architecture & Safety Features

1. **Authoritative 30 Hz Simulation:**
   Server runs the authoritative physics engine at 30 ticks/second, ensuring consistent collision detection, Swept AABB platform landing without tunneling, and multiplayer synchronization.
2. **15-Second Airlock Evacuation:**
   When lead players advance forward through an airlock door, a 15-second timer displays for trailing players. Once expired, delayed, downed, or disconnected players are automatically evacuated to the target room's safe staging area and revived, preventing softlocks.
3. **Independent Room Presence During Backtracking:**
   Backtracking (e.g. Room 10 $\to$ Room 9 to retrieve the cutting tool) does **not** trigger an evacuation or drag waiting teammates out of Room 10. Each room maintains independent player tracking.
4. **Seamless Reconnection:**
   Disconnecting players have their session preserved via `resumeToken`. Upon reconnecting, players rejoin directly into their last active room (`lastRoomId`) rather than restarting at Room 1.
5. **Dual 3D / 2D Presentation & GPU Memory Management:**
   All 10 chambers, procedural 3D ground items (keys, bolt cutters, ropes), and animated mechanisms (switches, spotlights, guards, ladders) render in Three.js WebGL with recursive GPU material/geometry disposal on room transitions. Individual player material clones prevent palette bleeding on disconnect.

---

## 🚀 Quickstart & Verification

### Prerequisites
- Node.js (v18+)
- npm

### Installation & Build
```bash
# Install dependencies
npm install

# Compile TypeScript and bundle production assets with Vite
npm run build
```

### Running Automated Test Suite
The repository includes a comprehensive 280-test suite verifying character facing direction, camera framing, platform collision, tunneling prevention, 10-room puzzles, airlock evacuations, and stealth mechanics:
```bash
npm test
```

### Running the Server
```bash
# Start the production Node server
npm start
```
Then navigate to `http://localhost:3001` in your browser.
