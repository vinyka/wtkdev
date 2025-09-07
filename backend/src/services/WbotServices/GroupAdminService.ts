import { WASocket, GroupMetadata, jidNormalizedUser, proto } from "@whiskeysockets/baileys";
import logger from "../../utils/logger";
import { normalizeJid } from "../../helpers/JidLidMapper";
import GroupHandlerService from "./GroupHandlerService";
import AppError from "../../errors/AppError";

interface GroupParticipantAction {
  jid: string;
  action: "add" | "remove" | "promote" | "demote";
}

interface GroupSettingsUpdate {
  subject?: string;
  description?: string;
  restrict?: boolean; // Only admins can send messages
  announce?: boolean; // Only admins can edit group info
}

interface GroupInviteInfo {
  code: string;
  expiration?: number;
  revoked?: boolean;
}

class GroupAdminService {
  private static instance: GroupAdminService;
  private groupHandlerService: GroupHandlerService;

  constructor() {
    this.groupHandlerService = GroupHandlerService.getInstance();
  }

  public static getInstance(): GroupAdminService {
    if (!GroupAdminService.instance) {
      GroupAdminService.instance = new GroupAdminService();
    }
    return GroupAdminService.instance;
  }

  /**
   * Enhanced group creation with Baileys 6.7.19 optimizations
   */
  public async createGroup(
    wbot: WASocket,
    subject: string,
    participants: string[],
    options?: {
      description?: string;
      profilePicture?: Buffer;
    }
  ): Promise<{ groupJid: string; groupMetadata: GroupMetadata }> {
    try {
      logger.info(`Creating group "${subject}" with ${participants.length} participants`);

      // Normalize participant JIDs
      const normalizedParticipants = participants.map(p => jidNormalizedUser(p));

      // Create group using Baileys 6.7.19 optimized method
      const groupData = await wbot.groupCreate(subject, normalizedParticipants);
      
      if (!groupData || !groupData.id) {
        throw new AppError("Failed to create group", 500);
      }

      // Set group description if provided
      if (options?.description) {
        await this.updateGroupDescription(wbot, groupData.id, options.description);
      }

      // Set profile picture if provided
      if (options?.profilePicture) {
        await this.updateGroupProfilePicture(wbot, groupData.id, options.profilePicture);
      }

      // Get enhanced metadata
      const groupMetadata = await this.groupHandlerService.getEnhancedGroupMetadata(
        wbot, 
        groupData.id, 
        true
      );

      logger.info(`Successfully created group: ${groupData.id}`);

      return {
        groupJid: groupData.id,
        groupMetadata: groupMetadata || groupData
      };

    } catch (error) {
      logger.error(`Error creating group "${subject}":`, error as any);
      throw new AppError(`Failed to create group: ${error.message}`, 500);
    }
  }

  /**
   * Enhanced participant management with batch operations
   */
  public async manageParticipants(
    wbot: WASocket,
    groupJid: string,
    actions: GroupParticipantAction[]
  ): Promise<{ success: string[]; failed: string[] }> {
    try {
      const normalizedGroupJid = normalizeJid(groupJid);
      logger.info(`Managing ${actions.length} participant actions for group ${normalizedGroupJid}`);

      const results = { success: [], failed: [] };

      // Group actions by type for batch processing
      const actionGroups = actions.reduce((acc, action) => {
        if (!acc[action.action]) acc[action.action] = [];
        acc[action.action].push(jidNormalizedUser(action.jid));
        return acc;
      }, {} as Record<string, string[]>);

      // Process each action type in batches
      for (const [actionType, jids] of Object.entries(actionGroups)) {
        try {
          let result;
          
          switch (actionType) {
            case "add":
              result = await wbot.groupParticipantsUpdate(
                normalizedGroupJid,
                jids,
                "add"
              );
              break;
              
            case "remove":
              result = await wbot.groupParticipantsUpdate(
                normalizedGroupJid,
                jids,
                "remove"
              );
              break;
              
            case "promote":
              result = await wbot.groupParticipantsUpdate(
                normalizedGroupJid,
                jids,
                "promote"
              );
              break;
              
            case "demote":
              result = await wbot.groupParticipantsUpdate(
                normalizedGroupJid,
                jids,
                "demote"
              );
              break;
              
            default:
              logger.warn(`Unknown action type: ${actionType}`);
              continue;
          }

          // Process results
          if (result) {
            Object.entries(result).forEach(([jid, status]) => {
              if (status === "200") {
                results.success.push(jid);
              } else {
                results.failed.push(jid);
                logger.warn(`Failed to ${actionType} ${jid}: status ${status}`);
              }
            });
          }

        } catch (error) {
          logger.error(`Error processing ${actionType} actions:`, error as any);
          jids.forEach(jid => results.failed.push(jid));
        }
      }

      // Clear group cache to refresh metadata
      await this.groupHandlerService.clearGroupCache(normalizedGroupJid);

      logger.info(`Participant management completed: ${results.success.length} success, ${results.failed.length} failed`);
      return results;

    } catch (error) {
      logger.error(`Error managing participants for group ${groupJid}:`, error as any);
      throw new AppError(`Failed to manage participants: ${error.message}`, 500);
    }
  }

  /**
   * Enhanced group settings update with Baileys 6.7.19 features
   */
  public async updateGroupSettings(
    wbot: WASocket,
    groupJid: string,
    settings: GroupSettingsUpdate
  ): Promise<boolean> {
    try {
      const normalizedGroupJid = normalizeJid(groupJid);
      logger.info(`Updating settings for group ${normalizedGroupJid}`);

      let updated = false;

      // Update group subject
      if (settings.subject) {
        await wbot.groupUpdateSubject(normalizedGroupJid, settings.subject);
        updated = true;
        logger.debug(`Updated group subject to: ${settings.subject}`);
      }

      // Update group description
      if (settings.description !== undefined) {
        await this.updateGroupDescription(wbot, normalizedGroupJid, settings.description);
        updated = true;
        logger.debug(`Updated group description`);
      }

      // Update group restrictions
      if (settings.restrict !== undefined) {
        await wbot.groupSettingUpdate(
          normalizedGroupJid,
          settings.restrict ? "announcement" : "not_announcement"
        );
        updated = true;
        logger.debug(`Updated group restrict setting to: ${settings.restrict}`);
      }

      // Update group announcement setting
      if (settings.announce !== undefined) {
        await wbot.groupSettingUpdate(
          normalizedGroupJid,
          settings.announce ? "locked" : "unlocked"
        );
        updated = true;
        logger.debug(`Updated group announce setting to: ${settings.announce}`);
      }

      if (updated) {
        // Clear cache to refresh metadata
        await this.groupHandlerService.clearGroupCache(normalizedGroupJid);
      }

      return updated;

    } catch (error) {
      logger.error(`Error updating group settings for ${groupJid}:`, error as any);
      throw new AppError(`Failed to update group settings: ${error.message}`, 500);
    }
  }

  /**
   * Enhanced group invite management
   */
  public async manageGroupInvite(
    wbot: WASocket,
    groupJid: string,
    action: "get" | "revoke"
  ): Promise<GroupInviteInfo | null> {
    try {
      const normalizedGroupJid = normalizeJid(groupJid);
      logger.info(`Managing group invite for ${normalizedGroupJid}: ${action}`);

      let result: GroupInviteInfo | null = null;

      switch (action) {
        case "get":
          const inviteCode = await wbot.groupInviteCode(normalizedGroupJid);
          result = {
            code: inviteCode,
            expiration: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days default
            revoked: false
          };
          break;

        case "revoke":
          const newInviteCode = await wbot.groupRevokeInvite(normalizedGroupJid);
          result = {
            code: newInviteCode,
            expiration: Date.now() + (7 * 24 * 60 * 60 * 1000),
            revoked: true
          };
          break;

        default:
          throw new AppError(`Invalid invite action: ${action}`, 400);
      }

      logger.info(`Group invite ${action} completed for ${normalizedGroupJid}`);
      return result;

    } catch (error) {
      logger.error(`Error managing group invite for ${groupJid}:`, error as any);
      throw new AppError(`Failed to manage group invite: ${error.message}`, 500);
    }
  }

  /**
   * Leave group with cleanup
   */
  public async leaveGroup(wbot: WASocket, groupJid: string): Promise<boolean> {
    try {
      const normalizedGroupJid = normalizeJid(groupJid);
      logger.info(`Leaving group ${normalizedGroupJid}`);

      await wbot.groupLeave(normalizedGroupJid);

      // Clear all cached data for this group
      await this.groupHandlerService.clearGroupCache(normalizedGroupJid);

      logger.info(`Successfully left group ${normalizedGroupJid}`);
      return true;

    } catch (error) {
      logger.error(`Error leaving group ${groupJid}:`, error as any);
      throw new AppError(`Failed to leave group: ${error.message}`, 500);
    }
  }

  /**
   * Get enhanced group information
   */
  public async getGroupInfo(
    wbot: WASocket,
    groupJid: string,
    forceRefresh = false
  ): Promise<GroupMetadata | null> {
    try {
      const normalizedGroupJid = normalizeJid(groupJid);
      
      return await this.groupHandlerService.getEnhancedGroupMetadata(
        wbot,
        normalizedGroupJid,
        forceRefresh
      );

    } catch (error) {
      logger.error(`Error getting group info for ${groupJid}:`, error as any);
      return null;
    }
  }

  /**
   * Private helper to update group description
   */
  private async updateGroupDescription(
    wbot: WASocket,
    groupJid: string,
    description: string
  ): Promise<void> {
    try {
      await wbot.groupUpdateDescription(groupJid, description);
      logger.debug(`Updated group description for ${groupJid}`);
    } catch (error) {
      logger.error(`Error updating group description for ${groupJid}:`, error as any);
      throw error;
    }
  }

  /**
   * Private helper to update group profile picture
   */
  private async updateGroupProfilePicture(
    wbot: WASocket,
    groupJid: string,
    imageBuffer: Buffer
  ): Promise<void> {
    try {
      await wbot.updateProfilePicture(groupJid, imageBuffer);
      logger.debug(`Updated group profile picture for ${groupJid}`);
    } catch (error) {
      logger.error(`Error updating group profile picture for ${groupJid}:`, error as any);
      throw error;
    }
  }

  /**
   * Validate if user has admin permissions in group
   */
  public async validateGroupAdmin(
    wbot: WASocket,
    groupJid: string,
    userJid?: string
  ): Promise<boolean> {
    try {
      const groupMetadata = await this.getGroupInfo(wbot, groupJid);
      if (!groupMetadata) return false;

      const checkJid = userJid || wbot.user?.id;
      if (!checkJid) return false;

      const normalizedUserJid = jidNormalizedUser(checkJid);
      
      return groupMetadata.participants?.some(
        participant => 
          jidNormalizedUser(participant.id) === normalizedUserJid && 
          participant.admin
      ) || false;

    } catch (error) {
      logger.error(`Error validating group admin for ${groupJid}:`, error as any);
      return false;
    }
  }
}

export default GroupAdminService;
