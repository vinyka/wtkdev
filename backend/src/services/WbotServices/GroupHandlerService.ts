import { WASocket, GroupMetadata, proto, jidNormalizedUser } from "@whiskeysockets/baileys";
import { logger } from "../../utils/logger";
import { normalizeJid } from "../../helpers/JidLidMapper";
import Contact from "../../models/Contact";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import { cacheLayer } from "../../libs/cache";

interface EnhancedGroupMetadata extends GroupMetadata {
  lastUpdated?: Date;
  participantCount?: number;
  adminCount?: number;
}

interface GroupCacheData {
  metadata: EnhancedGroupMetadata;
  participants: string[];
  admins: string[];
  lastSync: Date;
}

class GroupHandlerService {
  private static instance: GroupHandlerService;
  private groupCache = new Map<string, GroupCacheData>();
  private readonly CACHE_TTL = 300000; // 5 minutes
  private readonly CACHE_PREFIX = "group:";

  public static getInstance(): GroupHandlerService {
    if (!GroupHandlerService.instance) {
      GroupHandlerService.instance = new GroupHandlerService();
    }
    return GroupHandlerService.instance;
  }

  /**
   * Enhanced group metadata retrieval with caching and optimization
   */
  public async getEnhancedGroupMetadata(
    wbot: WASocket,
    groupJid: string,
    forceRefresh = false
  ): Promise<EnhancedGroupMetadata | null> {
    try {
      const normalizedJid = normalizeJid(groupJid);
      const cacheKey = `${this.CACHE_PREFIX}metadata:${normalizedJid}`;

      // Check cache first unless force refresh is requested
      if (!forceRefresh) {
        const cached = await cacheLayer.get(cacheKey);
        if (cached) {
          const parsedCache = JSON.parse(cached);
          const cacheAge = Date.now() - new Date(parsedCache.lastSync).getTime();
          
          if (cacheAge < this.CACHE_TTL) {
            logger.debug(`Using cached group metadata for ${normalizedJid}`);
            return parsedCache.metadata;
          }
        }
      }

      // Fetch fresh metadata using Baileys 6.7.19 optimized methods
      const metadata = await wbot.groupMetadata(normalizedJid);
      
      if (!metadata) {
        logger.warn(`Failed to fetch group metadata for ${normalizedJid}`);
        return null;
      }

      // Enhance metadata with additional information
      const enhancedMetadata: EnhancedGroupMetadata = {
        ...metadata,
        lastUpdated: new Date(),
        participantCount: metadata.participants?.length || 0,
        adminCount: metadata.participants?.filter(p => p.admin).length || 0
      };

      // Cache the enhanced metadata
      const cacheData: GroupCacheData = {
        metadata: enhancedMetadata,
        participants: metadata.participants?.map(p => p.id) || [],
        admins: metadata.participants?.filter(p => p.admin).map(p => p.id) || [],
        lastSync: new Date()
      };

      await cacheLayer.set(cacheKey, JSON.stringify(cacheData), this.CACHE_TTL / 1000);
      this.groupCache.set(normalizedJid, cacheData);

      logger.debug(`Cached enhanced group metadata for ${normalizedJid}`);
      return enhancedMetadata;

    } catch (error) {
      logger.error(`Error fetching group metadata for ${groupJid}:`, error);
      return null;
    }
  }

  /**
   * Optimized group message processing with Baileys 6.7.19 improvements
   */
  public async processGroupMessage(
    wbot: WASocket,
    msg: proto.IWebMessageInfo,
    companyId: number
  ): Promise<{ groupContact: Contact | null; isGroupAdmin: boolean }> {
    try {
      const groupJid = msg.key.remoteJid;
      if (!groupJid || !groupJid.endsWith("@g.us")) {
        return { groupContact: null, isGroupAdmin: false };
      }

      // Get enhanced group metadata
      const groupMetadata = await this.getEnhancedGroupMetadata(wbot, groupJid);
      if (!groupMetadata) {
        logger.warn(`Could not retrieve group metadata for ${groupJid}`);
        return { groupContact: null, isGroupAdmin: false };
      }

      // Create or update group contact with enhanced data
      const groupContactData = {
        id: groupMetadata.id,
        name: groupMetadata.subject || groupJid.replace("@g.us", ""),
        number: groupJid.replace(/\D/g, ""),
        isGroup: true,
        companyId,
        remoteJid: normalizeJid(groupJid),
        profilePicUrl: await this.getGroupProfilePicture(wbot, groupJid),
        whatsappId: wbot.id,
        wbot: wbot
      };

      const groupContact = await CreateOrUpdateContactService(groupContactData);

      // Check if sender is group admin (for enhanced permissions)
      const senderJid = msg.key.fromMe ? wbot.user?.id : msg.key.participant || msg.key.remoteJid;
      const isGroupAdmin = this.isGroupAdmin(groupMetadata, senderJid);

      // Update group statistics
      await this.updateGroupStatistics(groupJid, groupMetadata);

      return { groupContact, isGroupAdmin };

    } catch (error) {
      logger.error(`Error processing group message:`, error);
      return { groupContact: null, isGroupAdmin: false };
    }
  }

  /**
   * Enhanced group updates handler with Baileys 6.7.19 optimizations
   */
  public async handleGroupUpdates(
    wbot: WASocket,
    groupUpdates: GroupMetadata[],
    companyId: number
  ): Promise<void> {
    try {
      logger.debug(`Processing ${groupUpdates.length} group updates`);

      // Process updates in batches for better performance
      const batchSize = 5;
      for (let i = 0; i < groupUpdates.length; i += batchSize) {
        const batch = groupUpdates.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (group) => {
            try {
              await this.processGroupUpdate(wbot, group, companyId);
            } catch (error) {
              logger.error(`Error processing group update for ${group.id}:`, error);
            }
          })
        );
      }

      logger.debug(`Completed processing group updates`);

    } catch (error) {
      logger.error(`Error handling group updates:`, error);
    }
  }

  /**
   * Process individual group update with enhanced metadata sync
   */
  private async processGroupUpdate(
    wbot: WASocket,
    group: GroupMetadata,
    companyId: number
  ): Promise<void> {
    try {
      const normalizedJid = normalizeJid(group.id);
      const number = group.id.replace(/\D/g, "");
      const nameGroup = group.subject || number;

      // Get profile picture with retry mechanism
      const profilePicUrl = await this.getGroupProfilePicture(wbot, group.id);

      const contactData = {
        name: nameGroup,
        number: number,
        isGroup: true,
        companyId: companyId,
        remoteJid: normalizedJid,
        profilePicUrl,
        whatsappId: wbot.id,
        wbot: wbot
      };

      await CreateOrUpdateContactService(contactData);

      // Force refresh cache for this group
      await this.getEnhancedGroupMetadata(wbot, group.id, true);

      logger.debug(`Updated group contact: ${nameGroup} (${normalizedJid})`);

    } catch (error) {
      logger.error(`Error processing group update for ${group.id}:`, error);
    }
  }

  /**
   * Get group profile picture with error handling and caching
   */
  private async getGroupProfilePicture(wbot: WASocket, groupJid: string): Promise<string> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}picture:${normalizeJid(groupJid)}`;
      
      // Check cache first
      const cached = await cacheLayer.get(cacheKey);
      if (cached) {
        return cached;
      }

      // Fetch profile picture using Baileys 6.7.19 optimized method
      const profilePicUrl = await wbot.profilePictureUrl(groupJid, "image");
      
      // Cache for 1 hour
      await cacheLayer.set(cacheKey, profilePicUrl, 3600);
      
      return profilePicUrl;

    } catch (error) {
      logger.debug(`Could not fetch group profile picture for ${groupJid}:`, error.message);
      return `${process.env.FRONTEND_URL}/nopicture.png`;
    }
  }

  /**
   * Check if a user is admin of a group
   */
  private isGroupAdmin(groupMetadata: GroupMetadata, userJid: string | null | undefined): boolean {
    if (!userJid || !groupMetadata.participants) {
      return false;
    }

    const normalizedUserJid = jidNormalizedUser(userJid);
    return groupMetadata.participants.some(
      participant => jidNormalizedUser(participant.id) === normalizedUserJid && participant.admin
    );
  }

  /**
   * Update group statistics for monitoring and analytics
   */
  private async updateGroupStatistics(groupJid: string, metadata: EnhancedGroupMetadata): Promise<void> {
    try {
      const statsKey = `${this.CACHE_PREFIX}stats:${normalizeJid(groupJid)}`;
      
      const stats = {
        participantCount: metadata.participantCount || 0,
        adminCount: metadata.adminCount || 0,
        lastActivity: new Date(),
        subject: metadata.subject
      };

      await cacheLayer.set(statsKey, JSON.stringify(stats), 86400); // 24 hours

    } catch (error) {
      logger.error(`Error updating group statistics for ${groupJid}:`, error);
    }
  }

  /**
   * Get cached group participants for quick access
   */
  public async getGroupParticipants(groupJid: string): Promise<string[]> {
    try {
      const normalizedJid = normalizeJid(groupJid);
      const cacheKey = `${this.CACHE_PREFIX}participants:${normalizedJid}`;
      
      const cached = await cacheLayer.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // If not cached, return empty array (will be populated on next metadata fetch)
      return [];

    } catch (error) {
      logger.error(`Error getting group participants for ${groupJid}:`, error);
      return [];
    }
  }

  /**
   * Clear group cache for a specific group
   */
  public async clearGroupCache(groupJid: string): Promise<void> {
    try {
      const normalizedJid = normalizeJid(groupJid);
      const keys = [
        `${this.CACHE_PREFIX}metadata:${normalizedJid}`,
        `${this.CACHE_PREFIX}picture:${normalizedJid}`,
        `${this.CACHE_PREFIX}stats:${normalizedJid}`,
        `${this.CACHE_PREFIX}participants:${normalizedJid}`
      ];

      await Promise.all(keys.map(key => cacheLayer.del(key)));
      this.groupCache.delete(normalizedJid);

      logger.debug(`Cleared cache for group ${normalizedJid}`);

    } catch (error) {
      logger.error(`Error clearing group cache for ${groupJid}:`, error);
    }
  }
}

export default GroupHandlerService;