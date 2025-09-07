import { WASocket, GroupMetadata, proto, jidNormalizedUser } from "@whiskeysockets/baileys";
import { logger } from "../../utils/logger";
import { normalizeJid } from "../../helpers/JidLidMapper";
import { cacheLayer } from "../../libs/cache";
import GroupHandlerService from "./GroupHandlerService";

interface ParticipantInfo {
  jid: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  joinedAt?: Date;
  lastActivity?: Date;
}

interface GroupParticipantEvent {
  groupJid: string;
  participantJid: string;
  action: "add" | "remove" | "promote" | "demote";
  timestamp: Date;
  byAdmin?: string;
}

interface ParticipantStats {
  totalParticipants: number;
  adminCount: number;
  recentJoins: number;
  recentLeaves: number;
  lastUpdated: Date;
}

class GroupParticipantService {
  private static instance: GroupParticipantService;
  private groupHandlerService: GroupHandlerService;
  private readonly CACHE_TTL = 1800; // 30 minutes
  private readonly CACHE_PREFIX = "participants:";
  private readonly STATS_CACHE_TTL = 3600; // 1 hour

  constructor() {
    this.groupHandlerService = GroupHandlerService.getInstance();
  }

  public static getInstance(): GroupParticipantService {
    if (!GroupParticipantService.instance) {
      GroupParticipantService.instance = new GroupParticipantService();
    }
    return GroupParticipantService.instance;
  }

  /**
   * Enhanced participant list retrieval with caching
   */
  public async getGroupParticipants(
    wbot: WASocket,
    groupJid: string,
    forceRefresh = false
  ): Promise<ParticipantInfo[]> {
    try {
      const normalizedGroupJid = normalizeJid(groupJid);
      const cacheKey = `${this.CACHE_PREFIX}list:${normalizedGroupJid}`;

      // Check cache first unless force refresh is requested
      if (!forceRefresh) {
        const cached = await cacheLayer.get(cacheKey);
        if (cached) {
          const parsedCache = JSON.parse(cached);
          const cacheAge = Date.now() - new Date(parsedCache.timestamp).getTime();
          
          if (cacheAge < this.CACHE_TTL * 1000) {
            logger.debug(`Using cached participants for ${normalizedGroupJid}`);
            return parsedCache.participants;
          }
        }
      }

      // Fetch fresh group metadata
      const groupMetadata = await this.groupHandlerService.getEnhancedGroupMetadata(
        wbot,
        normalizedGroupJid,
        forceRefresh
      );

      if (!groupMetadata || !groupMetadata.participants) {
        logger.warn(`No participants found for group ${normalizedGroupJid}`);
        return [];
      }

      // Transform participants with enhanced information
      const participants: ParticipantInfo[] = groupMetadata.participants.map(participant => ({
        jid: participant.id,
        isAdmin: participant.admin === "admin" || participant.admin === "superadmin",
        isSuperAdmin: participant.admin === "superadmin",
        joinedAt: new Date(), // This would need to be tracked separately for accurate data
        lastActivity: new Date()
      }));

      // Cache the participants list
      const cacheData = {
        participants,
        timestamp: new Date(),
        groupJid: normalizedGroupJid
      };

      await cacheLayer.set(cacheKey, JSON.stringify(cacheData), this.CACHE_TTL);

      logger.debug(`Cached ${participants.length} participants for ${normalizedGroupJid}`);
      return participants;

    } catch (error) {
      logger.error(`Error getting group participants for ${groupJid}:`, error);
      return [];
    }
  }

  /**
   * Enhanced group events handling with optimized processing
   */
  public async handleGroupParticipantsUpdate(
    wbot: WASocket,
    update: {
      id: string;
      participants: string[];
      action: "add" | "remove" | "promote" | "demote";
      author?: string;
    }
  ): Promise<void> {
    try {
      const normalizedGroupJid = normalizeJid(update.id);
      logger.info(`Processing participants update for group ${normalizedGroupJid}: ${update.action}`);

      // Process each participant in the update
      const events: GroupParticipantEvent[] = update.participants.map(participantJid => ({
        groupJid: normalizedGroupJid,
        participantJid: jidNormalizedUser(participantJid),
        action: update.action,
        timestamp: new Date(),
        byAdmin: update.author ? jidNormalizedUser(update.author) : undefined
      }));

      // Process events in batches for better performance
      await this.processParticipantEvents(events);

      // Update participant statistics
      await this.updateParticipantStats(normalizedGroupJid, update.action, update.participants.length);

      // Clear cached participants to force refresh on next request
      await this.clearParticipantCache(normalizedGroupJid);

      // Log the event for analytics
      await this.logParticipantEvent(events);

      logger.debug(`Completed processing ${events.length} participant events for ${normalizedGroupJid}`);

    } catch (error) {
      logger.error(`Error handling group participants update:`, error);
    }
  }

  /**
   * Get participant statistics with caching
   */
  public async getParticipantStats(groupJid: string): Promise<ParticipantStats | null> {
    try {
      const normalizedGroupJid = normalizeJid(groupJid);
      const cacheKey = `${this.CACHE_PREFIX}stats:${normalizedGroupJid}`;

      // Check cache first
      const cached = await cacheLayer.get(cacheKey);
      if (cached) {
        const parsedCache = JSON.parse(cached);
        const cacheAge = Date.now() - new Date(parsedCache.lastUpdated).getTime();
        
        if (cacheAge < this.STATS_CACHE_TTL * 1000) {
          return parsedCache;
        }
      }

      // Calculate fresh stats (this would typically come from database in a real implementation)
      const stats: ParticipantStats = {
        totalParticipants: 0,
        adminCount: 0,
        recentJoins: 0,
        recentLeaves: 0,
        lastUpdated: new Date()
      };

      // Cache the stats
      await cacheLayer.set(cacheKey, JSON.stringify(stats), this.STATS_CACHE_TTL);

      return stats;

    } catch (error) {
      logger.error(`Error getting participant stats for ${groupJid}:`, error);
      return null;
    }
  }

  /**
   * Check if a participant is admin with caching
   */
  public async isParticipantAdmin(
    wbot: WASocket,
    groupJid: string,
    participantJid: string
  ): Promise<boolean> {
    try {
      const participants = await this.getGroupParticipants(wbot, groupJid);
      const normalizedParticipantJid = jidNormalizedUser(participantJid);
      
      const participant = participants.find(p => 
        jidNormalizedUser(p.jid) === normalizedParticipantJid
      );

      return participant?.isAdmin || false;

    } catch (error) {
      logger.error(`Error checking if participant is admin:`, error);
      return false;
    }
  }

  /**
   * Get participant activity information
   */
  public async getParticipantActivity(
    groupJid: string,
    participantJid: string
  ): Promise<{ lastSeen?: Date; messageCount?: number; isActive: boolean }> {
    try {
      const normalizedGroupJid = normalizeJid(groupJid);
      const normalizedParticipantJid = jidNormalizedUser(participantJid);
      const cacheKey = `${this.CACHE_PREFIX}activity:${normalizedGroupJid}:${normalizedParticipantJid}`;

      const cached = await cacheLayer.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Default activity data (would be populated from actual tracking)
      const activity = {
        lastSeen: new Date(),
        messageCount: 0,
        isActive: false
      };

      // Cache for 1 hour
      await cacheLayer.set(cacheKey, JSON.stringify(activity), 3600);

      return activity;

    } catch (error) {
      logger.error(`Error getting participant activity:`, error);
      return { isActive: false };
    }
  }

  /**
   * Batch update participant information
   */
  public async batchUpdateParticipants(
    wbot: WASocket,
    groupJid: string,
    updates: Array<{
      participantJid: string;
      action: "add" | "remove" | "promote" | "demote";
    }>
  ): Promise<{ success: string[]; failed: string[] }> {
    try {
      const normalizedGroupJid = normalizeJid(groupJid);
      logger.info(`Batch updating ${updates.length} participants for group ${normalizedGroupJid}`);

      const results = { success: [], failed: [] };

      // Group updates by action type for efficient processing
      const actionGroups = updates.reduce((acc, update) => {
        if (!acc[update.action]) acc[update.action] = [];
        acc[update.action].push(update.participantJid);
        return acc;
      }, {} as Record<string, string[]>);

      // Process each action type
      for (const [action, participantJids] of Object.entries(actionGroups)) {
        try {
          const normalizedJids = participantJids.map(jid => jidNormalizedUser(jid));
          
          const result = await wbot.groupParticipantsUpdate(
            normalizedGroupJid,
            normalizedJids,
            action as any
          );

          // Process results
          if (result) {
            Object.entries(result).forEach(([jid, status]) => {
              if (status === "200") {
                results.success.push(jid);
              } else {
                results.failed.push(jid);
              }
            });
          }

        } catch (error) {
          logger.error(`Error processing ${action} batch:`, error);
          actionGroups[action].forEach(jid => results.failed.push(jid));
        }
      }

      // Clear cache after batch update
      await this.clearParticipantCache(normalizedGroupJid);

      logger.info(`Batch update completed: ${results.success.length} success, ${results.failed.length} failed`);
      return results;

    } catch (error) {
      logger.error(`Error in batch participant update:`, error);
      throw error;
    }
  }

  /**
   * Private method to process participant events
   */
  private async processParticipantEvents(events: GroupParticipantEvent[]): Promise<void> {
    try {
      // Process events in chunks for better performance
      const chunkSize = 10;
      for (let i = 0; i < events.length; i += chunkSize) {
        const chunk = events.slice(i, i + chunkSize);
        
        await Promise.all(
          chunk.map(async (event) => {
            try {
              // Update participant activity cache
              await this.updateParticipantActivity(event);
              
              // Trigger any additional processing based on event type
              await this.handleSpecificParticipantEvent(event);
              
            } catch (error) {
              logger.error(`Error processing participant event:`, error);
            }
          })
        );
      }

    } catch (error) {
      logger.error(`Error processing participant events:`, error);
    }
  }

  /**
   * Update participant statistics
   */
  private async updateParticipantStats(
    groupJid: string,
    action: string,
    count: number
  ): Promise<void> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}stats:${groupJid}`;
      
      let stats = await this.getParticipantStats(groupJid);
      if (!stats) {
        stats = {
          totalParticipants: 0,
          adminCount: 0,
          recentJoins: 0,
          recentLeaves: 0,
          lastUpdated: new Date()
        };
      }

      // Update stats based on action
      switch (action) {
        case "add":
          stats.recentJoins += count;
          stats.totalParticipants += count;
          break;
        case "remove":
          stats.recentLeaves += count;
          stats.totalParticipants -= count;
          break;
        case "promote":
          stats.adminCount += count;
          break;
        case "demote":
          stats.adminCount -= count;
          break;
      }

      stats.lastUpdated = new Date();

      // Cache updated stats
      await cacheLayer.set(cacheKey, JSON.stringify(stats), this.STATS_CACHE_TTL);

    } catch (error) {
      logger.error(`Error updating participant stats:`, error);
    }
  }

  /**
   * Update participant activity information
   */
  private async updateParticipantActivity(event: GroupParticipantEvent): Promise<void> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}activity:${event.groupJid}:${event.participantJid}`;
      
      const activity = {
        lastSeen: event.timestamp,
        lastAction: event.action,
        isActive: event.action === "add",
        updatedAt: new Date()
      };

      await cacheLayer.set(cacheKey, JSON.stringify(activity), 3600);

    } catch (error) {
      logger.error(`Error updating participant activity:`, error);
    }
  }

  /**
   * Handle specific participant events
   */
  private async handleSpecificParticipantEvent(event: GroupParticipantEvent): Promise<void> {
    try {
      // This method can be extended to handle specific business logic
      // based on different participant events
      
      switch (event.action) {
        case "add":
          logger.debug(`Participant ${event.participantJid} joined group ${event.groupJid}`);
          break;
        case "remove":
          logger.debug(`Participant ${event.participantJid} left group ${event.groupJid}`);
          break;
        case "promote":
          logger.debug(`Participant ${event.participantJid} promoted in group ${event.groupJid}`);
          break;
        case "demote":
          logger.debug(`Participant ${event.participantJid} demoted in group ${event.groupJid}`);
          break;
      }

    } catch (error) {
      logger.error(`Error handling specific participant event:`, error);
    }
  }

  /**
   * Log participant events for analytics
   */
  private async logParticipantEvent(events: GroupParticipantEvent[]): Promise<void> {
    try {
      // This would typically log to a database or analytics service
      const logData = {
        timestamp: new Date(),
        events: events.map(event => ({
          groupJid: event.groupJid,
          participantJid: event.participantJid,
          action: event.action,
          byAdmin: event.byAdmin
        }))
      };

      // For now, just log to console (in production, this would go to proper logging/analytics)
      logger.info(`Participant events logged:`, JSON.stringify(logData, null, 2));

    } catch (error) {
      logger.error(`Error logging participant events:`, error);
    }
  }

  /**
   * Clear participant cache for a specific group
   */
  private async clearParticipantCache(groupJid: string): Promise<void> {
    try {
      const keys = [
        `${this.CACHE_PREFIX}list:${groupJid}`,
        `${this.CACHE_PREFIX}stats:${groupJid}`
      ];

      await Promise.all(keys.map(key => cacheLayer.del(key)));
      
      logger.debug(`Cleared participant cache for group ${groupJid}`);

    } catch (error) {
      logger.error(`Error clearing participant cache:`, error);
    }
  }

  /**
   * Get participant change history (if tracking is implemented)
   */
  public async getParticipantHistory(
    groupJid: string,
    limit = 50
  ): Promise<GroupParticipantEvent[]> {
    try {
      // This would typically fetch from a database
      // For now, return empty array as placeholder
      return [];

    } catch (error) {
      logger.error(`Error getting participant history:`, error);
      return [];
    }
  }
}

export default GroupParticipantService;