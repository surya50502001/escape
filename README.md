# THE PIT (ESCAPE) - 10-Player Prison Break Survival

A real-time multiplayer 2D top-down prison break survival game. 10 thieves are trapped in a subterranean cell. At the top of the iron ladder stands an Anonymous Overseer with a sniper rifle.

Over the course of a persistent 10-minute survival match, the Overseer periodically unlatches the hatch and announces how many prisoners can leave (e.g., *"I WILL TAKE 1 PRISONER"*). If excess prisoners attempt to climb at once, the Overseer executes them. The remaining prisoners wait in agony between signals... but the Overseer may stop speaking at any time. When the 10-minute timer hits 0:00, all prisoners remaining in the pit are purged.

---

## 🎮 Features
- **10-Player Real-Time Multiplayer:** Built on WebSockets (30 Hz authoritative tick server).
- **Realistic 2D Human Top-Down Anatomy:** Detailed inmate vests, muscular arms, alternating footstep boots, hand-over-hand ladder climbing, and sprawling fallen bodies.
- **Physical Sabotage Mechanics:**
  - **Tackle (`Spacebar`):** Dash and slam into climbing prisoners to stun them and reset their climb progress.
  - **Throw Rocks (`Left Click`):** Chuck jagged stones from a distance to interrupt escapes.
- **The Anonymous Overseer:** Announces dynamic quotas, monitors ladder rungs, and snipes quota violators.
- **Procedural Web Audio:** Zero-dependency realistic gunfire, alarms, metallic clangs, and horns using Web Audio API synthesis.
- **Smart Bot AI:** 9 unique AI prisoners (*Rusty Pete*, *Mad Dog Boris*, *Shiv Miller*, etc.) that brawl, sabotage climbers, and sprint for open ladders.

---

## 🕹️ Controls
- **`WASD` / Arrows:** Move
- **Mouse:** Aim
- **Left Click:** Throw Rock / Attack
- **Spacebar:** Tackle Lunge / Hold on ladder to climb out
- **Audio Toggle:** Enable/disable sounds

---

## 🚀 Quickstart
```bash
# Install dependencies
npm install

# Build client
npm run build

# Start authoritative server & client
npm start
```
Open [http://localhost:3001](http://localhost:3001) in your browser.
