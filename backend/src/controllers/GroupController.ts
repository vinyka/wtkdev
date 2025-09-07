import { Request, Response } from "express";
import { getWbot } from "../libs/wbot";
import GroupHandlerService from "../services/WbotServices/GroupHandlerService";
import GroupAdminService from "../services/WbotServices/GroupAdminService";
import GroupParticipantService from "../services/WbotServices/GroupParticipantService";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";

interface GroupRequest extends Request {
  user: {
    id: string;
    companyId: number;
  };
}

class GroupController {
  /**
   * Get enhanced group information
   */
  public async getGroupInfo(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { whatsappId, groupJid } = req.params;
      const { forceRefresh } = req.query;

      if (!whatsappId || !groupJid) {
        throw new AppError("WhatsApp ID and Group JID are required", 400);
      }

      const wbot = await getWbot(parseInt(whatsappId));
      const groupAdminService = GroupAdminService.getInstance();

      const groupInfo = await groupAdminService.getGroupInfo(
        wbot,
        groupJid,
        forceRefresh === "true"
      );

      if (!groupInfo) {
        throw new AppError("Group not found or inaccessible", 404);
      }

      return res.json({
        success: true,
        data: groupInfo
      });

    } catch (error) {
      logger.error("Error getting group info:", error);
      throw new AppError(error.message || "Failed to get group information", 500);
    }
  }

  /**
   * Get group participants with enhanced information
   */
  public async getGroupParticipants(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { whatsappId, groupJid } = req.params;
      const { forceRefresh } = req.query;

      if (!whatsappId || !groupJid) {
        throw new AppError("WhatsApp ID and Group JID are required", 400);
      }

      const wbot = await getWbot(parseInt(whatsappId));
      const groupParticipantService = GroupParticipantService.getInstance();

      const participants = await groupParticipantService.getGroupParticipants(
        wbot,
        groupJid,
        forceRefresh === "true"
      );

      return res.json({
        success: true,
        data: {
          participants,
          count: participants.length
        }
      });

    } catch (error) {
      logger.error("Error getting group participants:", error);
      throw new AppError(error.message || "Failed to get group participants", 500);
    }
  }

  /**
   * Get participant statistics
   */
  public async getParticipantStats(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { groupJid } = req.params;

      if (!groupJid) {
        throw new AppError("Group JID is required", 400);
      }

      const groupParticipantService = GroupParticipantService.getInstance();
      const stats = await groupParticipantService.getParticipantStats(groupJid);

      return res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error("Error getting participant stats:", error);
      throw new AppError(error.message || "Failed to get participant statistics", 500);
    }
  }

  /**
   * Manage group participants (add, remove, promote, demote)
   */
  public async manageParticipants(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { whatsappId, groupJid } = req.params;
      const { actions } = req.body;

      if (!whatsappId || !groupJid) {
        throw new AppError("WhatsApp ID and Group JID are required", 400);
      }

      if (!actions || !Array.isArray(actions) || actions.length === 0) {
        throw new AppError("Actions array is required", 400);
      }

      const wbot = await getWbot(parseInt(whatsappId));
      const groupAdminService = GroupAdminService.getInstance();

      // Validate admin permissions
      const isAdmin = await groupAdminService.validateGroupAdmin(wbot, groupJid);
      if (!isAdmin) {
        throw new AppError("Admin permissions required for this action", 403);
      }

      const result = await groupAdminService.manageParticipants(wbot, groupJid, actions);

      return res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error("Error managing participants:", error);
      throw new AppError(error.message || "Failed to manage participants", 500);
    }
  }

  /**
   * Update group settings
   */
  public async updateGroupSettings(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { whatsappId, groupJid } = req.params;
      const settings = req.body;

      if (!whatsappId || !groupJid) {
        throw new AppError("WhatsApp ID and Group JID are required", 400);
      }

      const wbot = await getWbot(parseInt(whatsappId));
      const groupAdminService = GroupAdminService.getInstance();

      // Validate admin permissions
      const isAdmin = await groupAdminService.validateGroupAdmin(wbot, groupJid);
      if (!isAdmin) {
        throw new AppError("Admin permissions required for this action", 403);
      }

      const updated = await groupAdminService.updateGroupSettings(wbot, groupJid, settings);

      return res.json({
        success: true,
        data: { updated }
      });

    } catch (error) {
      logger.error("Error updating group settings:", error);
      throw new AppError(error.message || "Failed to update group settings", 500);
    }
  }

  /**
   * Create a new group
   */
  public async createGroup(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { whatsappId } = req.params;
      const { subject, participants, description, profilePicture } = req.body;

      if (!whatsappId) {
        throw new AppError("WhatsApp ID is required", 400);
      }

      if (!subject || !participants || !Array.isArray(participants)) {
        throw new AppError("Subject and participants array are required", 400);
      }

      const wbot = await getWbot(parseInt(whatsappId));
      const groupAdminService = GroupAdminService.getInstance();

      const options: any = {};
      if (description) options.description = description;
      if (profilePicture) options.profilePicture = Buffer.from(profilePicture, 'base64');

      const result = await groupAdminService.createGroup(wbot, subject, participants, options);

      return res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error("Error creating group:", error);
      throw new AppError(error.message || "Failed to create group", 500);
    }
  }

  /**
   * Manage group invite
   */
  public async manageGroupInvite(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { whatsappId, groupJid } = req.params;
      const { action } = req.body;

      if (!whatsappId || !groupJid) {
        throw new AppError("WhatsApp ID and Group JID are required", 400);
      }

      if (!action || !["get", "revoke"].includes(action)) {
        throw new AppError("Valid action (get or revoke) is required", 400);
      }

      const wbot = await getWbot(parseInt(whatsappId));
      const groupAdminService = GroupAdminService.getInstance();

      // Validate admin permissions for revoke action
      if (action === "revoke") {
        const isAdmin = await groupAdminService.validateGroupAdmin(wbot, groupJid);
        if (!isAdmin) {
          throw new AppError("Admin permissions required for this action", 403);
        }
      }

      const result = await groupAdminService.manageGroupInvite(wbot, groupJid, action);

      return res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error("Error managing group invite:", error);
      throw new AppError(error.message || "Failed to manage group invite", 500);
    }
  }

  /**
   * Leave group
   */
  public async leaveGroup(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { whatsappId, groupJid } = req.params;

      if (!whatsappId || !groupJid) {
        throw new AppError("WhatsApp ID and Group JID are required", 400);
      }

      const wbot = await getWbot(parseInt(whatsappId));
      const groupAdminService = GroupAdminService.getInstance();

      const result = await groupAdminService.leaveGroup(wbot, groupJid);

      return res.json({
        success: true,
        data: { left: result }
      });

    } catch (error) {
      logger.error("Error leaving group:", error);
      throw new AppError(error.message || "Failed to leave group", 500);
    }
  }

  /**
   * Batch update participants
   */
  public async batchUpdateParticipants(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { whatsappId, groupJid } = req.params;
      const { updates } = req.body;

      if (!whatsappId || !groupJid) {
        throw new AppError("WhatsApp ID and Group JID are required", 400);
      }

      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        throw new AppError("Updates array is required", 400);
      }

      const wbot = await getWbot(parseInt(whatsappId));
      const groupParticipantService = GroupParticipantService.getInstance();
      const groupAdminService = GroupAdminService.getInstance();

      // Validate admin permissions
      const isAdmin = await groupAdminService.validateGroupAdmin(wbot, groupJid);
      if (!isAdmin) {
        throw new AppError("Admin permissions required for this action", 403);
      }

      const result = await groupParticipantService.batchUpdateParticipants(
        wbot,
        groupJid,
        updates
      );

      return res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error("Error batch updating participants:", error);
      throw new AppError(error.message || "Failed to batch update participants", 500);
    }
  }

  /**
   * Get participant activity
   */
  public async getParticipantActivity(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { groupJid, participantJid } = req.params;

      if (!groupJid || !participantJid) {
        throw new AppError("Group JID and Participant JID are required", 400);
      }

      const groupParticipantService = GroupParticipantService.getInstance();
      const activity = await groupParticipantService.getParticipantActivity(
        groupJid,
        participantJid
      );

      return res.json({
        success: true,
        data: activity
      });

    } catch (error) {
      logger.error("Error getting participant activity:", error);
      throw new AppError(error.message || "Failed to get participant activity", 500);
    }
  }

  /**
   * Get participant history
   */
  public async getParticipantHistory(req: GroupRequest, res: Response): Promise<Response> {
    try {
      const { groupJid } = req.params;
      const { limit } = req.query;

      if (!groupJid) {
        throw new AppError("Group JID is required", 400);
      }

      const groupParticipantService = GroupParticipantService.getInstance();
      const history = await groupParticipantService.getParticipantHistory(
        groupJid,
        limit ? parseInt(limit as string) : 50
      );

      return res.json({
        success: true,
        data: history
      });

    } catch (error) {
      logger.error("Error getting participant history:", error);
      throw new AppError(error.message || "Failed to get participant history", 500);
    }
  }
}

export default new GroupController();