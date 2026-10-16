import { GameState, Player, ClientInput } from './types.js';

interface BotProfile {
  personality: 'RUSHER' | 'AGGRESSIVE' | 'PATIENT' | 'SABOTEUR';
  bravery: number;
}

export class BotController {
  private botProfiles: Map<string, BotProfile> = new Map();

  public getBotInput(bot: Player, state: GameState): ClientInput {
    const input: ClientInput = {
      up: false,
      down: false,
      left: false,
      right: false,
      aimAngle: bot.angle,
      attack: false,
      tackle: false,
      interact: false
    };

    if (bot.state === 'DEAD' || bot.hasEscaped || bot.stunnedTimer > 0) {
      return input;
    }

    if (!this.botProfiles.has(bot.id)) {
      const personalities: BotProfile['personality'][] = ['RUSHER', 'AGGRESSIVE', 'PATIENT', 'SABOTEUR'];
      const personality = personalities[Math.floor(Math.random() * personalities.length)];
      this.botProfiles.set(bot.id, {
        personality,
        bravery: 0.3 + Math.random() * 0.7
      });
    }

    const profile = this.botProfiles.get(bot.id)!;
    const ladderCenter = {
      x: state.ladder.x + state.ladder.width / 2,
      y: state.ladder.y + state.ladder.height / 2
    };

    // If waiting for signal, pace around cell or brawl lightly
    if (state.phase !== 'SIGNAL_ACTIVE') {
      // Find nearest living prisoner
      const peers = state.players.filter(p => p.id !== bot.id && !p.hasEscaped && p.state !== 'DEAD');
      if (peers.length > 0 && Math.random() < 0.03) {
        const target = peers[Math.floor(Math.random() * peers.length)];
        this.navigateTowards(bot, target.x, target.y, input);
      }
      return input;
    }

    // SIGNAL IS ACTIVE! HATCH IS OPEN!
    const currentClimbers = state.players.filter(p => p.state === 'CLIMBING' && p.id !== bot.id && !p.hasEscaped);
    const closestClimber = currentClimbers[0];
    const quotaLeft = state.signalQuota - state.signalEscapedCount;

    // 1. Sabotage: If someone is on the ladder
    if (closestClimber) {
      const distToClimber = Math.hypot(closestClimber.x - bot.x, closestClimber.y - bot.y);
      input.aimAngle = Math.atan2(closestClimber.y - bot.y, closestClimber.x - bot.x);

      // Throw rock at climber
      if (bot.rocks > 0 && distToClimber < 350 && Math.random() < 0.09) {
        input.attack = true;
        return input;
      }

      // Tackle climber off ladder
      if (distToClimber < 130 && bot.tackleCooldown <= 0 && Math.random() < 0.12) {
        input.tackle = true;
        return input;
      }

      // If quota is 1, DO NOT climb alongside them (or Overseer shoots you!)
      if (quotaLeft === 1) {
        this.navigateTowards(bot, closestClimber.x, closestClimber.y + 40, input);
        return input;
      }
    }

    // 2. Dash for the ladder if quota remains
    if (quotaLeft > 0) {
      this.navigateTowards(bot, ladderCenter.x, ladderCenter.y, input);
      input.interact = true;

      const distToLadder = Math.hypot(ladderCenter.x - bot.x, ladderCenter.y - bot.y);
      if (distToLadder > 120 && distToLadder < 260 && bot.tackleCooldown <= 0 && Math.random() < 0.06) {
        input.aimAngle = Math.atan2(ladderCenter.y - bot.y, ladderCenter.x - bot.x);
        input.tackle = true;
      }
    }

    return input;
  }

  private navigateTowards(bot: Player, targetX: number, targetY: number, input: ClientInput): void {
    const dx = targetX - bot.x;
    const dy = targetY - bot.y;
    const threshold = 15;

    if (dx > threshold) input.right = true;
    else if (dx < -threshold) input.left = true;

    if (dy > threshold) input.down = true;
    else if (dy < -threshold) input.up = true;

    input.aimAngle = Math.atan2(dy, dx);
  }
}
