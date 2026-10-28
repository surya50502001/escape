/**
 * IntroSequence — server-authoritative opening cinematic for the campaign.
 *
 * States (linear, timed):
 *   ARRIVE   (0–3s)   Jailer escorts prisoners into cell, prisoners take positions.
 *   LOCK     (3–5s)   Jailer closes and locks the cell door. Key ring visible.
 *   STEAL    (5–8s)   Jailer turns away. Ghost steals key. Key appears on ghost.
 *   SIGNAL   (8–10s)  Ghost signals prisoners. Door unlocks. Prisoners move to door.
 *   PLAY     (10s+)   Cinematic ends. Player input restored.
 *
 * The server broadcasts the current phase and elapsed time so all clients
 * render the same cinematic frame. No client can trigger phase transitions
 * independently — only the server timer advances the sequence.
 */

export type IntroPhase = 'ARRIVE' | 'LOCK' | 'STEAL' | 'SIGNAL' | 'PLAY';

export interface IntroSequenceState {
  phase: IntroPhase;
  elapsed: number;       // seconds since sequence started
  keyStolen: boolean;    // authoritative: ghost has the key
  doorUnlocked: boolean; // authoritative: cell door is open
  inputLocked: boolean;  // true while cinematic is playing
}

const PHASE_DURATIONS: Record<IntroPhase, number> = {
  ARRIVE: 3.0,
  LOCK:   2.0,
  STEAL:  3.0,
  SIGNAL: 2.0,
  PLAY:   Infinity
};

const PHASE_ORDER: IntroPhase[] = ['ARRIVE', 'LOCK', 'STEAL', 'SIGNAL', 'PLAY'];

export class IntroSequence {
  public state: IntroSequenceState = {
    phase: 'ARRIVE',
    elapsed: 0,
    keyStolen: false,
    doorUnlocked: false,
    inputLocked: false  // not locked until start() is called
  };

  private phaseTimer: number = 0;
  private started: boolean = false;

  public start(): void {
    this.started = true;
    this.state.phase = 'ARRIVE';
    this.state.elapsed = 0;
    this.state.keyStolen = false;
    this.state.doorUnlocked = false;
    this.state.inputLocked = true;
    this.phaseTimer = 0;
  }

  public hasStarted(): boolean {
    return this.started;
  }

  public isComplete(): boolean {
    return this.started && this.state.phase === 'PLAY';
  }

  public isInputLocked(): boolean {
    return this.started && this.state.inputLocked;
  }

  /** Advance the sequence by dt seconds. Returns true if phase changed. */
  public update(dt: number): boolean {
    if (!this.started || this.state.phase === 'PLAY') return false;

    this.state.elapsed += dt;
    this.phaseTimer += dt;

    // Absolute fail-safe timeout: sequence cannot exceed 10.5 seconds under any circumstance
    if (this.state.elapsed >= 10.5) {
      this.skip();
      return true;
    }

    let changed = false;
    while (this.phaseTimer >= PHASE_DURATIONS[this.state.phase]) {
      this.phaseTimer -= PHASE_DURATIONS[this.state.phase];
      this.advancePhase();
      changed = true;
      if ((this.state.phase as IntroPhase) === 'PLAY') break;
    }
    return changed;
  }

  private advancePhase(): boolean {
    const currentIdx = PHASE_ORDER.indexOf(this.state.phase);
    if (currentIdx < 0 || currentIdx >= PHASE_ORDER.length - 1) return false;

    const nextPhase = PHASE_ORDER[currentIdx + 1];
    this.state.phase = nextPhase;
    this.phaseTimer = 0;

    // Apply authoritative state changes on phase entry
    if (nextPhase === 'STEAL') {
      this.state.keyStolen = true;
    }
    if (nextPhase === 'SIGNAL') {
      this.state.doorUnlocked = true;
    }
    if (nextPhase === 'PLAY') {
      this.state.inputLocked = false;
    }

    return true;
  }

  /** Skip to gameplay immediately (e.g. on player skip request or reconnect). */
  public skip(): void {
    this.started = true;
    this.state.phase = 'PLAY';
    this.state.keyStolen = true;
    this.state.doorUnlocked = true;
    this.state.inputLocked = false;
    this.phaseTimer = 0;
  }
}
