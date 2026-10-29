import { WebSocket } from 'ws';
import crypto from 'crypto';
import { CampaignSession, ClientCampaignSync } from './campaignSession.js';
import { Player } from '../types.js';

export interface CampaignClient {
  ws: WebSocket;
  playerId: string;
  resumeToken: string;
  campaignId: string;
  msgCount: number;
  lastResetTime: number;
}

export class CampaignManager {
  private campaigns: Map<string, CampaignSession> = new Map();
  private tokenToCampaignId: Map<string, string> = new Map();
  public clients: Map<WebSocket, CampaignClient> = new Map();

  constructor() {
    // Default public campaign room
    const defaultCamp = new CampaignSession('CAMP-PUBLIC');
    this.campaigns.set('CAMP-PUBLIC', defaultCamp);
  }

  public getDefaultCampaign(): CampaignSession {
    let camp = this.campaigns.get('CAMP-PUBLIC');
    if (!camp) {
      camp = new CampaignSession('CAMP-PUBLIC');
      this.campaigns.set('CAMP-PUBLIC', camp);
    }
    return camp;
  }

  public createCampaign(): CampaignSession {
    const code = `CAMP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const camp = new CampaignSession(code);
    this.campaigns.set(code, camp);
    return camp;
  }

  public getCampaign(code: string): CampaignSession | undefined {
    return this.campaigns.get(code.trim().toUpperCase());
  }

  public findCampaignByToken(token: string): CampaignSession | undefined {
    const campId = this.tokenToCampaignId.get(token);
    if (campId && this.campaigns.has(campId)) {
      return this.campaigns.get(campId);
    }
    for (const camp of this.campaigns.values()) {
      if (camp.playerSessions.has(token) || Array.from(camp.playerSessions.values()).some(s => s.resumeToken === token)) {
        this.tokenToCampaignId.set(token, camp.id);
        return camp;
      }
    }
    return undefined;
  }

  public associateTokenWithCampaign(token: string, campaignId: string): void {
    this.tokenToCampaignId.set(token, campaignId.trim().toUpperCase());
  }

  public findClientBySocket(ws: WebSocket): CampaignClient | undefined {
    return this.clients.get(ws);
  }

  public handleClientDisconnect(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (client) {
      this.clients.delete(ws);
      const camp = this.campaigns.get(client.campaignId);
      if (camp) {
        camp.handlePlayerDisconnect(client.playerId);
      }
    }
  }

  public updateAllCampaigns(): void {
    // Advance physics for all campaigns
    for (const camp of this.campaigns.values()) {
      camp.update();
    }

    // Broadcast campaign synchronization to each connected client
    for (const [ws, client] of this.clients.entries()) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) {
        const camp = this.campaigns.get(client.campaignId);
        if (camp) {
          const sync = camp.getClientSync(client.playerId);
          if (sync) {
            ws.send(JSON.stringify({
              type: 'SYNC',
              mode: 'campaign',
              campaign: sync
            }));
          }
        }
      }
    }
  }

  public static readonly CAMPAIGN_EXPIRY_GRACE_MS = 5 * 60 * 1000; // 5-minute disconnect grace period

  public cleanExpiredCampaigns(now: number = Date.now(), gracePeriodMs: number = CampaignManager.CAMPAIGN_EXPIRY_GRACE_MS): void {
    for (const [id, camp] of Array.from(this.campaigns.entries())) {
      if (id === 'CAMP-PUBLIC') continue;

      if (camp.players.size === 0) {
        if (camp.emptySince === null) {
          camp.emptySince = now;
        }
        // Only remove if it has remained empty past the defined grace period
        if (now - camp.emptySince >= gracePeriodMs) {
          // Clean up token-to-campaign association mappings
          for (const [token, cId] of Array.from(this.tokenToCampaignId.entries())) {
            if (cId === id) {
              this.tokenToCampaignId.delete(token);
            }
          }
          this.campaigns.delete(id);
        }
      } else {
        camp.emptySince = null;
      }
    }
  }
}

export const campaignManager = new CampaignManager();
