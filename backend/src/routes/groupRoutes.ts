import express from "express";
import isAuth from "../middleware/isAuth";
import GroupController from "../controllers/GroupController";

const groupRoutes = express.Router();

// Get group information
groupRoutes.get(
  "/groups/:whatsappId/:groupJid/info",
  isAuth,
  GroupController.getGroupInfo
);

// Get group participants
groupRoutes.get(
  "/groups/:whatsappId/:groupJid/participants",
  isAuth,
  GroupController.getGroupParticipants
);

// Get participant statistics
groupRoutes.get(
  "/groups/:groupJid/stats",
  isAuth,
  GroupController.getParticipantStats
);

// Manage participants (add, remove, promote, demote)
groupRoutes.post(
  "/groups/:whatsappId/:groupJid/participants/manage",
  isAuth,
  GroupController.manageParticipants
);

// Update group settings
groupRoutes.put(
  "/groups/:whatsappId/:groupJid/settings",
  isAuth,
  GroupController.updateGroupSettings
);

// Create new group
groupRoutes.post(
  "/groups/:whatsappId/create",
  isAuth,
  GroupController.createGroup
);

// Manage group invite
groupRoutes.post(
  "/groups/:whatsappId/:groupJid/invite",
  isAuth,
  GroupController.manageGroupInvite
);

// Leave group
groupRoutes.post(
  "/groups/:whatsappId/:groupJid/leave",
  isAuth,
  GroupController.leaveGroup
);

// Batch update participants
groupRoutes.post(
  "/groups/:whatsappId/:groupJid/participants/batch",
  isAuth,
  GroupController.batchUpdateParticipants
);

// Get participant activity
groupRoutes.get(
  "/groups/:groupJid/participants/:participantJid/activity",
  isAuth,
  GroupController.getParticipantActivity
);

// Get participant history
groupRoutes.get(
  "/groups/:groupJid/history",
  isAuth,
  GroupController.getParticipantHistory
);

export default groupRoutes;