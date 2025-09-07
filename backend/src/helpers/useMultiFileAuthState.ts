import { proto } from "@whiskeysockets/baileys";
import {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
  BufferJSON,
  initAuthCreds
} from "@whiskeysockets/baileys";
import cacheLayer from "../libs/cache";
import Whatsapp from "../models/Whatsapp";
import logger from "../utils/logger";

export const useMultiFileAuthState = async (
  whatsapp: Whatsapp
): Promise<{ 
  state: AuthenticationState; 
  saveCreds: () => Promise<void>;
  clearCredentials: () => Promise<void>;
  validateAuthState: () => Promise<boolean>;
}> => {
  const sessionPrefix = `sessions:${whatsapp.id}`;

  const writeData = async (data: any, file: string): Promise<void> => {
    try {
      const serializedData = JSON.stringify(data, BufferJSON.replacer);
      await cacheLayer.set(`${sessionPrefix}:${file}`, serializedData);
      logger.debug(`Successfully wrote auth data for file: ${file}`);
    } catch (error) {
      logger.error(`Error writing auth data for file ${file}: ${error}`);
      throw new Error(`Failed to write authentication data: ${error.message}`);
    }
  };

  const readData = async (file: string): Promise<any> => {
    try {
      const data = await cacheLayer.get(`${sessionPrefix}:${file}`);
      if (!data) {
        logger.debug(`No data found for auth file: ${file}`);
        return null;
      }
      return JSON.parse(data, BufferJSON.reviver);
    } catch (error) {
      logger.error(`Error reading auth data for file ${file}: ${error}`);
      return null;
    }
  };

  const removeData = async (file: string): Promise<void> => {
    try {
      await cacheLayer.del(`${sessionPrefix}:${file}`);
      logger.debug(`Successfully removed auth data for file: ${file}`);
    } catch (error) {
      logger.error(`Error removing auth data for file ${file}: ${error}`);
    }
  };

  // Enhanced credential cleanup method
  const clearCredentials = async (): Promise<void> => {
    try {
      logger.info(`Clearing all credentials for WhatsApp session ${whatsapp.id}`);
      
      // Clear all session-related keys from cache
      await cacheLayer.delFromPattern(`${sessionPrefix}:*`);
      
      // Additional cleanup for specific auth files
      const authFiles = [
        'creds',
        'pre-key-*',
        'sender-key-*',
        'session-*',
        'app-state-sync-key-*',
        'app-state-sync-version-*'
      ];
      
      const cleanupTasks = authFiles.map(async (pattern) => {
        if (pattern.includes('*')) {
          await cacheLayer.delFromPattern(`${sessionPrefix}:${pattern}`);
        } else {
          await removeData(pattern);
        }
      });
      
      await Promise.all(cleanupTasks);
      logger.info(`Successfully cleared all credentials for session ${whatsapp.id}`);
    } catch (error) {
      logger.error(`Error clearing credentials for session ${whatsapp.id}: ${error}`);
      throw new Error(`Failed to clear credentials: ${error.message}`);
    }
  };

  // Enhanced authentication state validation
  const validateAuthState = async (): Promise<boolean> => {
    try {
      const creds = await readData("creds");
      
      if (!creds) {
        logger.debug(`No credentials found for session ${whatsapp.id}`);
        return false;
      }

      // Validate essential credential fields
      const requiredFields = ['noiseKey', 'pairingEphemeralKeyPair', 'signedIdentityKey', 'signedPreKey', 'registrationId'];
      const hasRequiredFields = requiredFields.every(field => creds[field] !== undefined);
      
      if (!hasRequiredFields) {
        logger.warn(`Invalid credentials structure for session ${whatsapp.id}`);
        return false;
      }

      // Additional validation for key integrity
      if (creds.signedPreKey && (!creds.signedPreKey.keyPair || !creds.signedPreKey.signature)) {
        logger.warn(`Invalid signed pre-key structure for session ${whatsapp.id}`);
        return false;
      }

      logger.debug(`Authentication state validation passed for session ${whatsapp.id}`);
      return true;
    } catch (error) {
      logger.error(`Error validating auth state for session ${whatsapp.id}: ${error}`);
      return false;
    }
  };

  // Initialize credentials with enhanced error handling
  let creds: AuthenticationCreds;
  try {
    const existingCreds = await readData("creds");
    if (existingCreds && await validateAuthState()) {
      creds = existingCreds;
      logger.info(`Loaded existing credentials for session ${whatsapp.id}`);
    } else {
      creds = initAuthCreds();
      await writeData(creds, "creds");
      logger.info(`Initialized new credentials for session ${whatsapp.id}`);
    }
  } catch (error) {
    logger.error(`Error initializing credentials for session ${whatsapp.id}: ${error}`);
    creds = initAuthCreds();
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};
          
          try {
            await Promise.all(
              ids.map(async id => {
                let value = await readData(`${type}-${id}`);
                
                // Enhanced handling for app-state-sync-key with better error handling
                if (type === "app-state-sync-key" && value) {
                  try {
                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                  } catch (protoError) {
                    logger.error(`Error parsing app-state-sync-key ${id}: ${protoError}`);
                    value = null;
                  }
                }

                data[id] = value;
              })
            );
          } catch (error) {
            logger.error(`Error getting keys for type ${type}: ${error}`);
          }

          return data;
        },
        set: async data => {
          const tasks: Promise<void>[] = [];
          
          try {
            for (const category in data) {
              for (const id in data[category]) {
                const value = data[category][id];
                const file = `${category}-${id}`;
                
                if (value) {
                  tasks.push(writeData(value, file));
                } else {
                  tasks.push(removeData(file));
                }
              }
            }

            await Promise.all(tasks);
            logger.debug(`Successfully updated ${tasks.length} key entries`);
          } catch (error) {
            logger.error(`Error setting keys: ${error}`);
            throw error;
          }
        }
      }
    },
    saveCreds: async () => {
      try {
        await writeData(creds, "creds");
        logger.debug(`Successfully saved credentials for session ${whatsapp.id}`);
      } catch (error) {
        logger.error(`Error saving credentials for session ${whatsapp.id}: ${error}`);
        throw error;
      }
    },
    clearCredentials,
    validateAuthState
  };
};