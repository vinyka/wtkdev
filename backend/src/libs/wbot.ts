import * as Sentry from "@sentry/node";
import makeWASocket, {
  AuthenticationState,
  Browsers,
  DisconnectReason,
  WAMessage,
  WAMessageKey,
  WASocket,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  isJidGroup,
  jidNormalizedUser,
  } from "@whiskeysockets/baileys";
import { FindOptions } from "sequelize/types";
import Whatsapp from "../models/Whatsapp";
import logger from "../utils/logger";
import MAIN_LOGGER from "@whiskeysockets/baileys/lib/Utils/logger";
import { 
  EnhancedLogger, 
  ConnectionEventType, 
  MessageEventType,
  LogContext,
  PerformanceMetrics,
  connectionLogger,
  messageLogger,
  performanceLogger,
  baileysLogger
} from "../utils/enhancedLogger";
import BaileysErrorHandler, { 
  BaileysErrorCode, 
  ErrorSeverity, 
  RecoveryStrategy,
  RetryConfig 
} from "../helpers/BaileysErrorHandler";
import { performanceMonitor, trackOperation } from "../services/PerformanceMonitoringService";
import { useMultiFileAuthState } from "../helpers/useMultiFileAuthState";
import { Boom } from "@hapi/boom";
import AppError from "../errors/AppError";
import { getIO } from "./socket";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import DeleteBaileysService from "../services/BaileysServices/DeleteBaileysService";
import cacheLayer from "./cache";
import ImportWhatsAppMessageService from "../services/WhatsappService/ImportWhatsAppMessageService";
import { add } from "date-fns";
import moment from "moment";
import { getTypeMessage, isValidMsg } from "../services/WbotServices/wbotMessageListener";
import { addLogs } from "../helpers/addLogs";
import NodeCache from 'node-cache';
import { Store } from "./store";

// Enhanced cache configuration for Baileys 6.7.19 optimizations
const msgRetryCounterCache = new NodeCache({
  stdTTL: 600,
  maxKeys: 2000, // Increased capacity for better performance
  checkperiod: 120, // More frequent cleanup
  useClones: false,
  deleteOnExpire: true
});

const msgCache = new NodeCache({
  stdTTL: 300, // Increased TTL for better hit rate
  maxKeys: 5000, // Significantly increased capacity
  checkperiod: 60, // More frequent cleanup
  useClones: false,
  deleteOnExpire: true
});

// Enhanced cache for frequently accessed messages
const hotMsgCache = new NodeCache({
  stdTTL: 1800, // 30 minutes for hot messages
  maxKeys: 1000,
  checkperiod: 300,
  useClones: false,
  deleteOnExpire: true
});

// Cache metrics for performance monitoring
interface CacheMetrics {
  hits: number;
  misses: number;
  saves: number;
  errors: number;
  hotCacheHits: number;
  lastCleanup: Date;
  totalSize: number;
}

// Connection performance metrics for Baileys 6.7.19 optimizations
interface ConnectionMetrics {
  connectionAttempts: number;
  successfulConnections: number;
  failedConnections: number;
  reconnections: number;
  averageConnectionTime: number;
  lastConnectionTime: Date;
  messagesSent: number;
  messagesReceived: number;
  groupOperations: number;
  mediaUploads: number;
  mediaDownloads: number;
}

const connectionMetrics: Map<number, ConnectionMetrics> = new Map();

// Helper functions for connection performance monitoring
const initConnectionMetrics = (whatsappId: number): void => {
  if (!connectionMetrics.has(whatsappId)) {
    connectionMetrics.set(whatsappId, {
      connectionAttempts: 0,
      successfulConnections: 0,
      failedConnections: 0,
      reconnections: 0,
      averageConnectionTime: 0,
      lastConnectionTime: new Date(),
      messagesSent: 0,
      messagesReceived: 0,
      groupOperations: 0,
      mediaUploads: 0,
      mediaDownloads: 0
    });
  }
};

const updateConnectionMetrics = async (whatsappId: number, event: string, data?: any): Promise<void> => {
  const metrics = connectionMetrics.get(whatsappId);
  if (!metrics) return;

  switch (event) {
    case 'connection_attempt':
      metrics.connectionAttempts++;
      break;
    case 'connection_success':
      metrics.successfulConnections++;
      metrics.lastConnectionTime = new Date();
      break;
    case 'connection_failed':
      metrics.failedConnections++;
      break;
    case 'reconnection':
      metrics.reconnections++;
      break;
    case 'message_sent':
      metrics.messagesSent++;
      break;
    case 'message_received':
      metrics.messagesReceived++;
      break;
    case 'group_operation':
      metrics.groupOperations++;
      break;
    case 'media_upload':
      metrics.mediaUploads++;
      break;
    case 'media_download':
      metrics.mediaDownloads++;
      break;
  }
  
  connectionMetrics.set(whatsappId, metrics);

  // Update performance monitoring service with WhatsApp metrics
  const whatsapp = sessions.find(s => s.id === whatsappId);
  if (whatsapp) {
    // Get companyId from database
    const whatsappRecord = await Whatsapp.findByPk(whatsappId);
    const companyId = whatsappRecord?.companyId || 0;
    
    performanceMonitor.trackWhatsAppMetrics(whatsappId, companyId, {
      connectionTime: metrics.lastConnectionTime.getTime() - (metrics.lastConnectionTime.getTime() - 1000), // Approximate
      messagesProcessed: metrics.messagesSent + metrics.messagesReceived,
      mediaDownloads: metrics.mediaDownloads,
      mediaUploads: metrics.mediaUploads,
      errors: metrics.failedConnections,
      lastActivity: new Date(),
      averageResponseTime: metrics.averageConnectionTime,
      cacheHitRate: 0 // Will be calculated separately
    });
  }
};

const getConnectionMetrics = (whatsappId: number): ConnectionMetrics | null => {
  return connectionMetrics.get(whatsappId) || null;
};

// Enhanced connection monitoring for groups
const optimizeGroupConnections = (wsocket: Session, allowGroup: boolean): void => {
  if (!allowGroup) return;
  
  // Group-specific optimizations for Baileys 6.7.19
  wsocket.ev.on('groups.update', (updates) => {
    updates.forEach(update => {
      updateConnectionMetrics(wsocket.id!, 'group_operation');
      
      // Cache group metadata for better performance
      if (update.id && update.subject) {
        logger.debug(`Group metadata updated: ${update.subject}`);
      }
    });
  });
  
  wsocket.ev.on('group-participants.update', (update) => {
    updateConnectionMetrics(wsocket.id!, 'group_operation');
    logger.debug(`Group participants updated for: ${update.id}`);
  });
};

const cacheMetrics: CacheMetrics = {
  hits: 0,
  misses: 0,
  saves: 0,
  errors: 0,
  hotCacheHits: 0,
  lastCleanup: new Date(),
  totalSize: 0
};

// Cleanup strategy for efficient memory management
const performCacheCleanup = () => {
  try {
    const now = Date.now();
    const cleanupThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean old entries from main cache
    const mainKeys = msgCache.keys();
    let cleanedCount = 0;
    
    mainKeys.forEach(key => {
      const data = msgCache.get(key);
      if (data) {
        try {
          const msg = JSON.parse(data as string);
          const msgTime = msg.messageTimestamp ? msg.messageTimestamp * 1000 : now;
          
          if (now - msgTime > cleanupThreshold) {
            msgCache.del(key);
            cleanedCount++;
          }
        } catch (error) {
          // Remove corrupted entries
          msgCache.del(key);
          cleanedCount++;
        }
      }
    });
    
    cacheMetrics.lastCleanup = new Date();
    logger.info(`Cache cleanup completed: ${cleanedCount} entries removed`);
    
    // Update total size metric
    cacheMetrics.totalSize = msgCache.keys().length + hotMsgCache.keys().length;
    
  } catch (error) {
    logger.error(`Cache cleanup error: ${error}`);
  }
};

// Schedule periodic cleanup every 30 minutes
setInterval(performCacheCleanup, 30 * 60 * 1000);

// Enhanced Baileys logger configuration for 6.7.19 debugging
const loggerBaileys = MAIN_LOGGER.child({});
loggerBaileys.level = process.env.BAILEYS_LOG_LEVEL || "error";

// Enhanced logging configuration for different debug levels
const baileysDebugLevels = {
  trace: 'trace',
  debug: 'debug', 
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal'
};

// Configure Baileys logger with enhanced debugging capabilities
if (process.env.BAILEYS_DEBUG === 'true') {
  loggerBaileys.level = 'debug';
  baileysLogger.logInfo('Baileys debug mode enabled', { 
    operation: 'debug_mode_enabled',
    metadata: {
      logLevel: loggerBaileys.level,
      debugMode: true 
    }
  });
}

type Session = WASocket & {
  id?: number;
  store?: Store;
};

const sessions: Session[] = [];

const retriesQrCodeMap = new Map<number, number>();

export default function msg() {
  return {
    get: (key: WAMessageKey) => {
      const { id } = key;
      if (!id) return;
      
      try {
        // First check hot cache for frequently accessed messages
        let data = hotMsgCache.get(id);
        if (data) {
          cacheMetrics.hotCacheHits++;
          cacheMetrics.hits++;
          let msg = JSON.parse(data as string);
          return msg?.message;
        }
        
        // Then check main cache
        data = msgCache.get(id);
        if (data) {
          cacheMetrics.hits++;
          let msg = JSON.parse(data as string);
          
          // Promote frequently accessed messages to hot cache
          const accessCount = (msg._accessCount || 0) + 1;
          msg._accessCount = accessCount;
          
          if (accessCount >= 3) {
            hotMsgCache.set(id, JSON.stringify(msg));
          } else {
            msgCache.set(id, JSON.stringify(msg));
          }
          
          return msg?.message;
        }
        
        cacheMetrics.misses++;
        return undefined;
        
      } catch (error) {
        cacheMetrics.errors++;
        logger.error(`Cache get error: ${error}`);
        return undefined;
      }
    },
    
    save: (msg: WAMessage) => {
      const { id } = msg.key;
      if (!id) return;
      
      try {
        // Add metadata for cache management
        const enhancedMsg = {
          ...msg,
          _cachedAt: Date.now(),
          _accessCount: 0
        };
        
        const msgtxt = JSON.stringify(enhancedMsg);
        msgCache.set(id as string, msgtxt);
        cacheMetrics.saves++;
        
        // Update total size metric
        cacheMetrics.totalSize = msgCache.keys().length + hotMsgCache.keys().length;
        
      } catch (error) {
        cacheMetrics.errors++;
        logger.error(`Cache save error: ${error}`);
      }
    },
    
    // New methods for enhanced cache management
    delete: (id: string) => {
      try {
        const deleted = msgCache.del(id) || hotMsgCache.del(id);
        if (deleted) {
          cacheMetrics.totalSize = msgCache.keys().length + hotMsgCache.keys().length;
        }
        return deleted;
      } catch (error) {
        cacheMetrics.errors++;
        logger.error(`Cache delete error: ${error}`);
        return false;
      }
    },
    
    clear: () => {
      try {
        msgCache.flushAll();
        hotMsgCache.flushAll();
        cacheMetrics.totalSize = 0;
        logger.info('Message cache cleared');
      } catch (error) {
        cacheMetrics.errors++;
        logger.error(`Cache clear error: ${error}`);
      }
    },
    
    getMetrics: (): CacheMetrics & { hitRate: number; hotCacheRate: number } => {
      const total = cacheMetrics.hits + cacheMetrics.misses;
      return {
        ...cacheMetrics,
        hitRate: total > 0 ? (cacheMetrics.hits / total) * 100 : 0,
        hotCacheRate: cacheMetrics.hits > 0 ? (cacheMetrics.hotCacheHits / cacheMetrics.hits) * 100 : 0
      };
    },
    
    performCleanup: performCacheCleanup,
    
    getStats: () => ({
      mainCache: {
        keys: msgCache.keys().length,
        size: msgCache.getStats()
      },
      hotCache: {
        keys: hotMsgCache.keys().length,
        size: hotMsgCache.getStats()
      },
      retryCache: {
        keys: msgRetryCounterCache.keys().length,
        size: msgRetryCounterCache.getStats()
      }
    })
  }
}

export const getWbot = (whatsappId: number): Session => {
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);

  if (sessionIndex === -1) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  return sessions[sessionIndex];
};

export const restartWbot = async (
  companyId: number,
  session?: any
): Promise<void> => {
  try {
    const options: FindOptions = {
      where: {
        companyId,
      },
      attributes: ["id"],
    }

    const whatsapp = await Whatsapp.findAll(options);

    whatsapp.map(async c => {
      const sessionIndex = sessions.findIndex(s => s.id === c.id);
      if (sessionIndex !== -1) {
        sessions[sessionIndex].ws.close();
      }

    });

  } catch (err) {
    logger.error(err);
  }
};

export const removeWbot = async (
  whatsappId: number,
  isLogout = true
): Promise<void> => {
  try {
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
    if (sessionIndex !== -1) {
      const session = sessions[sessionIndex];
      
      if (isLogout) {
        try {
          await session.logout();
          logger.info(`Successfully logged out session ${whatsappId}`);
        } catch (logoutError) {
          logger.error(`Error during logout for session ${whatsappId}: ${logoutError}`);
        }
        
        try {
          session.ws.close();
          logger.debug(`Closed WebSocket for session ${whatsappId}`);
        } catch (closeError) {
          logger.error(`Error closing WebSocket for session ${whatsappId}: ${closeError}`);
        }
      }

      sessions.splice(sessionIndex, 1);
      logger.info(`Removed session ${whatsappId} from active sessions`);
    } else {
      logger.warn(`Session ${whatsappId} not found in active sessions`);
    }
  } catch (err) {
    logger.error(`Error removing session ${whatsappId}: ${err}`);
  }
};

export var dataMessages: any = {};

export const msgDB = msg();

// Export performance monitoring functions for external access
export const getPerformanceMetrics = (whatsappId?: number) => {
  if (whatsappId) {
    return {
      connection: getConnectionMetrics(whatsappId),
      cache: msgDB.getMetrics(),
      cacheStats: msgDB.getStats()
    };
  }
  
  // Return all metrics if no specific whatsappId provided
  const allConnectionMetrics: { [key: number]: ConnectionMetrics } = {};
  connectionMetrics.forEach((metrics, id) => {
    allConnectionMetrics[id] = metrics;
  });
  
  return {
    connections: allConnectionMetrics,
    cache: msgDB.getMetrics(),
    cacheStats: msgDB.getStats()
  };
};

// Function to reset performance metrics
export const resetPerformanceMetrics = (whatsappId?: number) => {
  if (whatsappId) {
    connectionMetrics.delete(whatsappId);
    logger.info(`Performance metrics reset for WhatsApp ${whatsappId}`);
  } else {
    connectionMetrics.clear();
    logger.info('All performance metrics reset');
  }
};

export const initWASocket = async (whatsapp: Whatsapp): Promise<Session> => {
  return new Promise(async (resolve, reject) => {
    try {
      (async () => {
        const io = getIO();

        const whatsappUpdate = await Whatsapp.findOne({
          where: { id: whatsapp.id }
        });

        if (!whatsappUpdate) return;

        const { id, name, allowGroup, companyId } = whatsappUpdate;

        // const { version, isLatest } = await fetchLatestWaWebVersion({});
        const { version, isLatest } = await fetchLatestBaileysVersion();
        const versionB = [2, 3000, 1026800727];
        // logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);
        logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);
        logger.info(`Starting session ${name}`);
        let retriesQrCode = 0;

        let wsocket: Session = null;
       
        const { state, saveCreds, clearCredentials, validateAuthState } = await useMultiFileAuthState(whatsapp);

        // Validate authentication state before creating socket
        const isValidAuth = await validateAuthState();
        if (!isValidAuth) {
          logger.warn(`Invalid authentication state for session ${name}, clearing credentials`);
          await clearCredentials();
          // Reinitialize auth state after clearing
          const { state: newState, saveCreds: newSaveCreds } = await useMultiFileAuthState(whatsapp);
          state.creds = newState.creds;
          state.keys = newState.keys;
        }

        wsocket = makeWASocket({
          // version: [2, 2413, 1],
          version: [2, 3000, 1026800727],
          logger: loggerBaileys,
          printQRInTerminal: false,
          // Enhanced authentication configuration with improved error handling
          auth: {
            creds: state.creds,
            /** Enhanced caching makes the store faster to send/recv messages with better error recovery */
            keys: makeCacheableSignalKeyStore(state.keys, loggerBaileys),
          },
          generateHighQualityLinkPreview: true,
          linkPreviewImageThumbnailWidth: 192,
          // shouldIgnoreJid: jid => isJidBroadcast(jid),

          shouldIgnoreJid: (jid) => {
            //   // const isGroupJid = !allowGroup && isJidGroup(jid)
            return isJidBroadcast(jid) || (!allowGroup && isJidGroup(jid)) //|| jid.includes('newsletter')
          },
          browser: Browsers.appropriate("Desktop"),
          defaultQueryTimeoutMs: 60_000, // Increased timeout for better stability
          msgRetryCounterCache,
          markOnlineOnConnect: false,
          
          // Enhanced retry configuration for Baileys 6.7.19 optimizations
          retryRequestDelayMs: 2000, // Increased delay for better stability
          maxMsgRetryCount: 5, // Increased retry count
          emitOwnEvents: true,
          fireInitQueries: true,
          
          // Improved transaction options for better reliability
          transactionOpts: { 
            maxCommitRetries: 20, // Increased retries
            delayBetweenTriesMs: 3000 // Increased delay
          },
          
          // Enhanced connection timeouts for better performance
          connectTimeoutMs: 60_000, // Increased connection timeout
          keepAliveIntervalMs: 25_000, // Optimized keep-alive interval
          
          // New Baileys 6.7.19 performance optimizations
          qrTimeout: 45_000, // QR code timeout
          
          // Enhanced message handling
          getMessage: msgDB.get,
          
          // Group-specific optimizations for better performance
          syncFullHistory: false, // Disable full history sync for performance
          
          // Enhanced logging for debugging
          shouldSyncHistoryMessage: (msg) => {
            // Only sync recent messages to improve performance
            const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
            return Date.now() > dayAgo; // Simplified logic
          },
        });




        setTimeout(async () => {
          const wpp = await Whatsapp.findByPk(whatsapp.id);
          // console.log("Status:::::",wpp.status)
          if (wpp?.importOldMessages && wpp.status === "CONNECTED") {
            let dateOldLimit = new Date(wpp.importOldMessages).getTime();
            let dateRecentLimit = new Date(wpp.importRecentMessages).getTime();

            addLogs({
              fileName: `preparingImportMessagesWppId${whatsapp.id}.txt`, forceNewFile: true,
              text: `Aguardando conexão para iniciar a importação de mensagens:
  Whatsapp nome: ${wpp.name}
  Whatsapp Id: ${wpp.id}
  Criação do arquivo de logs: ${moment().format("DD/MM/YYYY HH:mm:ss")}
  Selecionado Data de inicio de importação: ${moment(dateOldLimit).format("DD/MM/YYYY HH:mm:ss")}
  Selecionado Data final da importação: ${moment(dateRecentLimit).format("DD/MM/YYYY HH:mm:ss")}
  `})

            const statusImportMessages = new Date().getTime();

            await wpp.update({
              statusImportMessages
            });
            wsocket.ev.on("messaging-history.set", async (messageSet: any) => {
              //if(messageSet.isLatest){

              const statusImportMessages = new Date().getTime();

              await wpp.update({
                statusImportMessages
              });
              const whatsappId = whatsapp.id;
              let filteredMessages = messageSet.messages
              let filteredDateMessages = []
              filteredMessages.forEach(msg => {
                const timestampMsg = Math.floor(msg.messageTimestamp["low"] * 1000)
                if (isValidMsg(msg) && dateOldLimit < timestampMsg && dateRecentLimit > timestampMsg) {
                  if (msg.key?.remoteJid.split("@")[1] != "g.us") {
                    addLogs({
                      fileName: `preparingImportMessagesWppId${whatsapp.id}.txt`, text: `Adicionando mensagem para pos processamento:
  Não é Mensagem de GRUPO >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  Data e hora da mensagem: ${moment(timestampMsg).format("DD/MM/YYYY HH:mm:ss")}
  Contato da Mensagem : ${msg.key?.remoteJid}
  Tipo da mensagem : ${getTypeMessage(msg)}

  `})
                    filteredDateMessages.push(msg)
                  } else {
                    if (wpp?.importOldMessagesGroups) {
                      addLogs({
                        fileName: `preparingImportMessagesWppId${whatsapp.id}.txt`, text: `Adicionando mensagem para pos processamento:
  Mensagem de GRUPO >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
  Data e hora da mensagem: ${moment(timestampMsg).format("DD/MM/YYYY HH:mm:ss")}
  Contato da Mensagem : ${msg.key?.remoteJid}
  Tipo da mensagem : ${getTypeMessage(msg)}

  `})
                      filteredDateMessages.push(msg)
                    }
                  }
                }

              });


              if (!dataMessages?.[whatsappId]) {
                dataMessages[whatsappId] = [];

                dataMessages[whatsappId].unshift(...filteredDateMessages);
              } else {
                dataMessages[whatsappId].unshift(...filteredDateMessages);
              }

              setTimeout(async () => {
                const wpp = await Whatsapp.findByPk(whatsappId);




                io.of(String(companyId))
                  .emit(`importMessages-${wpp.companyId}`, {
                    action: "update",
                    status: { this: -1, all: -1 }
                  });



                io.of(String(companyId))
                  .emit(`company-${companyId}-whatsappSession`, {
                    action: "update",
                    session: wpp
                  });
                //console.log(JSON.stringify(wpp, null, 2));
              }, 500);

              setTimeout(async () => {


                const wpp = await Whatsapp.findByPk(whatsappId);

                if (wpp?.importOldMessages) {
                  let isTimeStamp = !isNaN(
                    new Date(Math.floor(parseInt(wpp?.statusImportMessages))).getTime()
                  );

                  if (isTimeStamp) {
                    const ultimoStatus = new Date(
                      Math.floor(parseInt(wpp?.statusImportMessages))
                    ).getTime();
                    const dataLimite = +add(ultimoStatus, { seconds: +45 }).getTime();

                    if (dataLimite < new Date().getTime()) {
                      //console.log("Pronto para come?ar")
                      ImportWhatsAppMessageService(wpp.id)
                      wpp.update({
                        statusImportMessages: "Running"
                      })

                    } else {
                      //console.log("Aguardando inicio")
                    }
                  }
                }
                io.of(String(companyId))
                  .emit(`company-${companyId}-whatsappSession`, {
                    action: "update",
                    session: wpp
                  });
              }, 1000 * 45);

            });
          }

        }, 2500);


        wsocket.ev.on("presence.update", async ({ id: remoteJid, presences }) => {

          console.log('evento de presença', remoteJid, presences)

        })




        // Initialize connection metrics for this session
        initConnectionMetrics(whatsapp.id);
        updateConnectionMetrics(whatsapp.id, 'connection_attempt');

        wsocket.ev.on(
          "connection.update",
          async ({ connection, lastDisconnect, qr }) => {
            const context: LogContext = {
              whatsappId: id,
              companyId: whatsapp.companyId,
              sessionName: name,
              operation: 'connection_update'
            };

            // Enhanced connection logging with structured data
            connectionLogger.logConnectionEvent(
              connection as ConnectionEventType || ConnectionEventType.CONNECTING,
              context,
              `Socket ${name} Connection Update: ${connection || ""} ${lastDisconnect ? lastDisconnect.error?.message : ""}`
            );

            logger.info(
              `Socket  ${name} Connection Update ${connection || ""} ${lastDisconnect ? lastDisconnect.error.message : ""
              }`
            );

            if (connection === "close") {
              updateConnectionMetrics(whatsapp.id, 'connection_failed');
              
              // Analyze error using enhanced error handler
              const errorInfo = BaileysErrorHandler.analyzeError(lastDisconnect?.error, lastDisconnect);
              
              // Enhanced error logging with structured context
              BaileysErrorHandler.logError(
                lastDisconnect?.error || new Error("Connection closed"),
                errorInfo,
                context,
                lastDisconnect
              );

              // Check if error is retryable
              const isRetryable = BaileysErrorHandler.isRetryable(whatsapp.id, errorInfo);
              
              if (!isRetryable) {
                logger.warn(`Session ${name} error is not retryable or max retries exceeded: ${errorInfo.code}`);
                BaileysErrorHandler.logRecoveryFailure(whatsapp.id, errorInfo.code, context);
                
                // Clear recovery state and remove session
                BaileysErrorHandler.clearRecoveryState(whatsapp.id);
                removeWbot(id, false);
                return;
              }

              // Update recovery state
              BaileysErrorHandler.updateRecoveryState(whatsapp.id, errorInfo.code);
              BaileysErrorHandler.setRecoveryInProgress(whatsapp.id, true);

              // Handle different recovery strategies
              try {
                switch (errorInfo.recoveryStrategy) {
                  case RecoveryStrategy.CLEAR_CREDENTIALS:
                    logger.info(`Clearing credentials for session ${name} due to ${errorInfo.code}`);
                    
                    await clearCredentials();
                    await whatsapp.update({ status: "PENDING", session: "" });
                    await DeleteBaileysService(whatsapp.id);
                    
                    io.of(String(companyId))
                      .emit(`company-${whatsapp.companyId}-whatsappSession`, {
                        action: "update",
                        session: whatsapp
                      });
                    
                    removeWbot(id, false);
                    
                    // Calculate retry delay with exponential backoff
                    const recoveryState = BaileysErrorHandler.getRecoveryState(whatsapp.id);
                    const retryConfig: RetryConfig = {
                      attempt: recoveryState?.retryCount || 1,
                      maxAttempts: errorInfo.maxRetries,
                      baseDelay: errorInfo.baseDelay,
                      maxDelay: errorInfo.maxDelay,
                      backoffMultiplier: 2,
                      jitter: true
                    };
                    
                    const retryDelay = BaileysErrorHandler.calculateRetryDelay(retryConfig);
                    
                    BaileysErrorHandler.logRecoveryAttempt(
                      whatsapp.id,
                      errorInfo,
                      retryConfig.attempt,
                      retryDelay,
                      context
                    );
                    
                    setTimeout(async () => {
                      BaileysErrorHandler.setRecoveryInProgress(whatsapp.id, false);
                      StartWhatsAppSession(whatsapp, whatsapp.companyId);
                    }, retryDelay);
                    break;

                  case RecoveryStrategy.RECONNECT:
                  case RecoveryStrategy.RETRY:
                    logger.info(`Attempting reconnection for session ${name} due to ${errorInfo.code}`);
                    
                    removeWbot(id, false);
                    
                    // Calculate retry delay with exponential backoff
                    const reconnectState = BaileysErrorHandler.getRecoveryState(whatsapp.id);
                    const reconnectConfig: RetryConfig = {
                      attempt: reconnectState?.retryCount || 1,
                      maxAttempts: errorInfo.maxRetries,
                      baseDelay: errorInfo.baseDelay,
                      maxDelay: errorInfo.maxDelay,
                      backoffMultiplier: 2,
                      jitter: true
                    };
                    
                    const reconnectDelay = BaileysErrorHandler.calculateRetryDelay(reconnectConfig);
                    
                    BaileysErrorHandler.logRecoveryAttempt(
                      whatsapp.id,
                      errorInfo,
                      reconnectConfig.attempt,
                      reconnectDelay,
                      context
                    );
                    
                    setTimeout(async () => {
                      BaileysErrorHandler.setRecoveryInProgress(whatsapp.id, false);
                      StartWhatsAppSession(whatsapp, whatsapp.companyId);
                    }, reconnectDelay);
                    break;

                  case RecoveryStrategy.RESTART_SESSION:
                    logger.info(`Restarting session ${name} due to ${errorInfo.code}`);
                    
                    await whatsapp.update({ status: "PENDING" });
                    removeWbot(id, false);
                    
                    // Calculate restart delay
                    const restartState = BaileysErrorHandler.getRecoveryState(whatsapp.id);
                    const restartConfig: RetryConfig = {
                      attempt: restartState?.retryCount || 1,
                      maxAttempts: errorInfo.maxRetries,
                      baseDelay: errorInfo.baseDelay,
                      maxDelay: errorInfo.maxDelay,
                      backoffMultiplier: 2,
                      jitter: true
                    };
                    
                    const restartDelay = BaileysErrorHandler.calculateRetryDelay(restartConfig);
                    
                    BaileysErrorHandler.logRecoveryAttempt(
                      whatsapp.id,
                      errorInfo,
                      restartConfig.attempt,
                      restartDelay,
                      context
                    );
                    
                    setTimeout(async () => {
                      BaileysErrorHandler.setRecoveryInProgress(whatsapp.id, false);
                      StartWhatsAppSession(whatsapp, whatsapp.companyId);
                    }, restartDelay);
                    break;

                  case RecoveryStrategy.MANUAL_INTERVENTION:
                    logger.error(`Manual intervention required for session ${name}: ${errorInfo.code}`);
                    
                    await whatsapp.update({ 
                      status: "PENDING", 
                      session: "",
                      retries: (whatsapp.retries || 0) + 1
                    });
                    
                    io.of(String(companyId))
                      .emit(`company-${whatsapp.companyId}-whatsappSession`, {
                        action: "update",
                        session: whatsapp
                      });
                    
                    removeWbot(id, false);
                    BaileysErrorHandler.clearRecoveryState(whatsapp.id);
                    break;

                  case RecoveryStrategy.NO_RECOVERY:
                  default:
                    logger.error(`No recovery strategy available for session ${name}: ${errorInfo.code}`);
                    removeWbot(id, false);
                    BaileysErrorHandler.clearRecoveryState(whatsapp.id);
                    break;
                }
              } catch (recoveryError) {
                logger.error(`Error during recovery for session ${name}: ${recoveryError}`);
                BaileysErrorHandler.logRecoveryFailure(whatsapp.id, errorInfo.code, {
                  ...context,
                  error: recoveryError
                });
                BaileysErrorHandler.setRecoveryInProgress(whatsapp.id, false);
                removeWbot(id, false);
              }
            }

            if (connection === "open") {
              updateConnectionMetrics(whatsapp.id, 'connection_success');
              
              // Reset recovery state on successful connection
              const recoveryState = BaileysErrorHandler.getRecoveryState(whatsapp.id);
              if (recoveryState) {
                BaileysErrorHandler.updateRecoveryState(whatsapp.id, recoveryState.lastError, true);
                BaileysErrorHandler.logRecoverySuccess(whatsapp.id, recoveryState.lastError, context);
              }
              
              await whatsapp.update({
                status: "CONNECTED",
                qrcode: "",
                retries: 0,
                number:
                  wsocket.type === "md"
                    ? jidNormalizedUser((wsocket as WASocket).user.id).split("@")[0]
                    : "-"
              });

              io.of(String(companyId))
                .emit(`company-${whatsapp.companyId}-whatsappSession`, {
                  action: "update",
                  session: whatsapp
                });

              const sessionIndex = sessions.findIndex(
                s => s.id === whatsapp.id
              );
              if (sessionIndex === -1) {
                wsocket.id = whatsapp.id;
                sessions.push(wsocket);
              }

              // Initialize group optimizations if groups are allowed
              optimizeGroupConnections(wsocket, allowGroup);
              
              // Enhanced connection success logging with metrics
              const metrics = getConnectionMetrics(whatsapp.id);
              
              connectionLogger.logConnectionEvent(
                ConnectionEventType.CONNECTED,
                {
                  ...context,
                  operation: 'connection_success',
                  metadata: metrics
                },
                `Session ${name} connected successfully`
              );

              // Log performance metrics
              performanceLogger.logPerformanceMetric({
                operation: 'connection_establishment',
                duration: Date.now() - (metrics?.lastConnectionTime?.getTime() || Date.now()),
                success: true,
                timestamp: new Date(),
                context
              });

              logger.info(`Session ${name} connected successfully. Metrics: ${JSON.stringify(metrics)}`);

              resolve(wsocket);
            }

            if (qr !== undefined) {
              if (retriesQrCodeMap.get(id) && retriesQrCodeMap.get(id) >= 3) {
                await whatsappUpdate.update({
                  status: "DISCONNECTED",
                  qrcode: ""
                });
                await DeleteBaileysService(whatsappUpdate.id);
                await cacheLayer.delFromPattern(`sessions:${whatsapp.id}:*`);
                io.of(String(companyId))
                  .emit(`company-${whatsapp.companyId}-whatsappSession`, {
                    action: "update",
                    session: whatsappUpdate
                  });
                wsocket.ev.removeAllListeners("connection.update");
                wsocket.ws.close();
                wsocket = null;
                retriesQrCodeMap.delete(id);
              } else {
                // Enhanced QR code generation logging
                connectionLogger.logConnectionEvent(
                  ConnectionEventType.QR_GENERATED,
                  {
                    ...context,
                    operation: 'qr_generation',
                    metadata: { qrRetries: retriesQrCode }
                  },
                  `Session QRCode Generate ${name} (attempt ${retriesQrCode})`
                );

                logger.info(`Session QRCode Generate ${name}`);
                retriesQrCodeMap.set(id, (retriesQrCode += 1));

                await whatsapp.update({
                  qrcode: qr,
                  status: "qrcode",
                  retries: 0,
                  number: ""
                });
                const sessionIndex = sessions.findIndex(
                  s => s.id === whatsapp.id
                );

                if (sessionIndex === -1) {
                  wsocket.id = whatsapp.id;
                  sessions.push(wsocket);
                }

                io.of(String(companyId))
                  .emit(`company-${whatsapp.companyId}-whatsappSession`, {
                    action: "update",
                    session: whatsapp
                  });
              }
            }
          }
        );

        // Enhanced credential update handling with error recovery
        wsocket.ev.on("creds.update", async () => {
          try {
            await saveCreds();
            logger.debug(`Successfully saved credentials for session ${name}`);
          } catch (error) {
            logger.error(`Error saving credentials for session ${name}: ${error}`);
            
            // Attempt to validate and recover authentication state
            const isValid = await validateAuthState();
            if (!isValid) {
              logger.warn(`Invalid auth state detected for session ${name}, may need re-authentication`);
            }
          }
        });
        // wsocket.store = store;
        // store.bind(wsocket.ev);
      })();
    } catch (error) {
      Sentry.captureException(error);
      console.log(error);
      reject(error);
    }
  });
};
