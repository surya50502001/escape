# THE PIT (ESCAPE) - 2D Side-View Prison Escape Survival

A dark, claustrophobic 2D side-view cross-sectional multiplayer prison escape survival game. Ten prisoners are locked inside an enclosed underground chamber.

The camera shows a **side-on, cross-sectional view of the room** like a gritty 2D survival platformer. The physical environment and traversal route are the central focus.

---

## 🗺️ Exact Level Layout & Traversal Route

```
┌────────────────────────────────────────────────────────────────────────┐
│ [OVERSEER & HATCH]  ══════ HORIZONTAL CEILING PIPE ═══════╗            │
│  (Upper-Left duct)   (Hand-over-hand traversal to left)    ║            │
│                                                           ║            │
│                                                           ║ VERTICAL   │
│                                                           ║ WALL PIPE  │
│                                                           ║ (Climb up) │
│                                                           ║            │
│                                                           ║            │
│               [SINGLE ROPE ON FLOOR]                      ║            │
│═══════════════════════════════════════════════════════════╩════════════│
│                     DIRTY CONCRETE PIT FLOOR                           │
└────────────────────────────────────────────────────────────────────────┘
```

The traversal path is:
**Floor ➔ Climb right-wall pipe ➔ Hang underneath ceiling pipe ➔ Traverse hand-over-hand to the left ➔ Reach upper-left escape hatch.**

---

## 💀 Game Mechanics

1. **One Enclosed Underground Chamber:**
   - Tall rough concrete/rock walls with industrial grime, steel girders, water seepage, and harsh lighting.
   - Floor at bottom ($Y = 620$) where all prisoners initially stand.
2. **The Pipe Traversal:**
   - **Right-Wall Vertical Pipe ($X = 920$):** Shinny and climb upward with `W/Up` or down with `S/Down`.
   - **Ceiling Horizontal Pipe ($Y = 90$):** Hang underneath with both arms and traverse hand-over-hand toward the escape opening with `A/Left`.
   - Players can lose grip, get pulled down, or be knocked off by rocks or tackles.
3. **The Single Floor Rope:**
   - A single coiled rope sits on the concrete floor.
   - Any prisoner can walk to it and press `E` to pick it up.
   - Aim with mouse and Click to throw the rope toward climbing or hanging prisoners.
   - If attached, press `Spacebar` to violently jerk the victim off the pipe down to the concrete floor!
4. **The Anonymous Overseer at Upper-Left:**
   - Shadowy silhouette standing in the upper-left escape duct with a scoped sniper rifle.
   - Periodically announces the escape quota (e.g. *"I WILL TAKE 1 PRISONER"*).
   - If multiple prisoners touch the hatch simultaneously or violate quota, the Overseer snipes them.
5. **Realistic 2D Human Prisoner Silhouettes:**
   - Proportionate human bodies with articulated limbs, prison clothing, realistic walk/run cycles, vertical pipe climbing, and ceiling hanging animations.
   - Not colorful cartoons, spacesuits, or Among Us astronauts.

---

## 🕹️ Controls

| Key | Action |
| :--- | :--- |
| **`A` / `D`** or Left / Right | Run left / right across the floor |
| **`W`** or Up | Jump / Grab and climb up the right-wall pipe |
| **`S`** or Down | Climb down / Drop off pipe into the pit |
| **`E`** | Pick up rope from floor / Drop rope |
| **Mouse Cursor** | Aim throw angle |
| **Left Click** | Throw rope / Throw rock |
| **`Spacebar`** | Yank attached rope / Tackle dash on floor |
| **Audio Toggle** | Toggle procedural sound effects |

---

## 🚀 Quickstart
```bash
npm install
npm run build
npm start
```
Open [http://localhost:3001](http://localhost:3001) in your browser.
