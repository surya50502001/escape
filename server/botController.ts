import { GameState, Player, ClientInput, V_PIPE_X } from './types.js';

interface BotProfile {
  personality: 'RUSHER' | 'AGGRESSIVE' | 'PATIENT' | 'SABOTEUR';
  bravery: number;
}

export class BotController {
  private botProfiles: Map<string, BotProfile> = new Map();

  public getBotInput(bot: Player, state: GameState): ClientInput {
    const input: ClientInput = {
      left: false,
      right: false,
      up: false,
      down: false,
      jump: false,
      interact: false,
      attack: false,
      tackle: false,
      aimAngle: bot.angle
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
    const rope = state.rope;

    // 1. ROPE SABOTAGE LOGIC
    // If holding attached rope, pull the target!
    if (rope.heldByPlayerId === bot.id) {
      if (rope.state === 'ATTACHED') {
        input.tackle = true;
        return input;
      } else if (rope.state === 'HELD') {
        // Find anyone climbing vertical pipe or hanging from ceiling pipe
        const climber = state.players.find(p => 
          p.id !== bot.id && 
          !p.hasEscaped && 
          (p.state === 'CLIMBING_V_PIPE' || p.state === 'HANGING_H_PIPE')
        );

        if (climber) {
          const angle = Math.atan2(climber.y - bot.y, climber.x - bot.x);
          input.aimAngle = angle;
          if (Math.random() < 0.15) {
            input.attack = true; // Throw rope
            return input;
          }
        }
      }
    } else if (rope.state === 'ON_FLOOR' && bot.state === 'ON_FLOOR') {
      // If close to rope on floor, try to pick it up
      const distToRope = Math.hypot(bot.x - rope.x, bot.y - rope.y);
      if (distToRope < 45 && Math.random() < 0.25) {
        input.interact = true;
        return input;
      } else if (profile.personality === 'SABOTEUR' && distToRope < 180) {
        // Move towards rope
        if (rope.x > bot.x) input.right = true;
        else input.left = true;
        return input;
      }
    }

    // 2. ROCK THROW SABOTAGE (if not holding rope)
    if (bot.rocks > 0 && Math.random() < 0.08) {
      const climber = state.players.find(p => 
        p.id !== bot.id && 
        !p.hasEscaped && 
        (p.state === 'CLIMBING_V_PIPE' || p.state === 'HANGING_H_PIPE')
      );
      if (climber) {
        input.aimAngle = Math.atan2(climber.y - bot.y, climber.x - bot.x);
        input.attack = true;
        return input;
      }
    }

    // 3. TRAVERSAL & ESCAPE PATH: Floor -> Right Wall Pipe -> Ceiling Pipe -> Upper-Left
    if (state.phase === 'SIGNAL_ACTIVE') {
      const quotaLeft = state.signalQuota - state.signalEscapedCount;

      if (quotaLeft > 0) {
        if (bot.state === 'ON_FLOOR') {
          // Sprint toward right wall pipe (x = 920)
          if (bot.x < V_PIPE_X - 15) {
            input.right = true;
          } else {
            // At vertical pipe, grab and climb up!
            input.up = true;
          }
        } else if (bot.state === 'CLIMBING_V_PIPE') {
          // Climb up towards ceiling
          input.up = true;
        } else if (bot.state === 'HANGING_H_PIPE') {
          // Traverse left across ceiling pipe toward escape opening!
          input.left = true;
        }
        return input;
      }
    }

    // Idle or wander on floor during wait
    if (bot.state === 'ON_FLOOR') {
      if (Math.random() < 0.04) {
        if (Math.random() < 0.5) input.left = true;
        else input.right = true;
      }
    } else if (bot.state === 'HANGING_H_PIPE' && state.phase !== 'SIGNAL_ACTIVE') {
      // Drop down if hatch is closed
      input.down = true;
    }

    return input;
  }
}
