import { Boom } from "@hapi/boom";
import { DisconnectReason } from "@whiskeysockets/baileys";
import { connectionLogger, LogContext, ConnectionEventType } from "../utils/enhancedLogger";
import logger from "../utils/logger";

// Enhanced error codes for Baileys 6.7.19
export enum BaileysErrorCode {
  // Connection errors
  CONNECTION_CLOSED = 'CONNECTION_CLOSED',
  CONNECTION_LOST = 'CONNECTION_LOST',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  CONNECTION_REPLACED = 'CONNECTION_REPLACED',
  
  // Authentication errors
  AUTH_FAILURE = 'AUTH_FAILURE',
  CREDENTIALS_INVALID = 'CREDENTIALS_INVALID',
  DEVICE_LOGGED_OUT = 'DEVICE_LOGGED_OUT',
  MULTI_DEVICE_MISMATCH = 'MULTI_DEVICE_MISMATCH',
  
  // Session errors
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_INVALID = 'SESSION_INVALID',
  SESSION_CONFLICT = 'SESSION_CONFLICT',
  
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVER_ERROR = 'SERVER_ERROR',
  
  // Protocol errors
  PROTOCOL_ERROR = 'PROTOCOL_ERROR',
  VERSION_MISMATCH = 'VERSION_MISMATCH',
  UNSUPPORTED_FEATURE = 'UNSUPPORTED_FEATURE',
  
  // Unknown errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

// Error severity levels
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Error recovery strategies
export enum RecoveryStrategy {
  RETRY = 'retry',
  RECONNECT = 'reconnect',
  RESTART_SESSION = 'restart_session',
  CLEAR_CREDENTIALS = 'clear_credentials',
  MANUAL_INTERVENTION = 'manual_intervention',
  NO_RECOVERY = 'no_recovery'
}

// Enhanced error information
export interface BaileysErrorInfo {
  code: BaileysErrorCode;
  severity: ErrorSeverity;
  recoveryStrategy: RecoveryStrategy;
  retryable: boolean;
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  description: string;
}

// Retry configuration with exponential backoff
export interface RetryConfig {
  attempt: number;
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

// Session recovery state
export interface SessionRecoveryState {
  whatsappId: number;
  retryCount: number;
  lastError: BaileysErrorCode;
  lastRetryTime: Date;
  recoveryInProgress: boolean;
  consecutiveFailures: number;
}

// Enhanced error mapping for Baileys 6.7.19 disconnect reasons
const DISCONNECT_REASON_MAPPING: Record<number, BaileysErrorInfo> = {
  [DisconnectReason.badSession]: {
    code: BaileysErrorCode.SESSION_INVALID,
    severity: ErrorSeverity.HIGH,
    recoveryStrategy: RecoveryStrategy.CLEAR_CREDENTIALS,
    retryable: true,
    maxRetries: 1,
    baseDelay: 5000,
    maxDelay: 10000,
    description: 'Session is invalid and needs to be recreated'
  },
  [DisconnectReason.connectionClosed]: {
    code: BaileysErrorCode.CONNECTION_CLOSED,
    severity: ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy.RECONNECT,
    retryable: true,
    maxRetries: 5,
    baseDelay: 2000,
    maxDelay: 30000,
    description: 'Connection was closed unexpectedly'
  },
  [DisconnectReason.connectionLost]: {
    code: BaileysErrorCode.CONNECTION_LOST,
    severity: ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy.RECONNECT,
    retryable: true,
    maxRetries: 3,
    baseDelay: 3000,
    maxDelay: 15000,
    description: 'Connection was lost due to network issues'
  },
  [DisconnectReason.connectionReplaced]: {
    code: BaileysErrorCode.CONNECTION_REPLACED,
    severity: ErrorSeverity.HIGH,
    recoveryStrategy: RecoveryStrategy.MANUAL_INTERVENTION,
    retryable: false,
    maxRetries: 0,
    baseDelay: 0,
    maxDelay: 0,
    description: 'Connection was replaced by another session'
  },
  [DisconnectReason.loggedOut]: {
    code: BaileysErrorCode.DEVICE_LOGGED_OUT,
    severity: ErrorSeverity.CRITICAL,
    recoveryStrategy: RecoveryStrategy.CLEAR_CREDENTIALS,
    retryable: true,
    maxRetries: 1,
    baseDelay: 1000,
    maxDelay: 5000,
    description: 'Device was logged out from WhatsApp'
  },
  [DisconnectReason.multideviceMismatch]: {
    code: BaileysErrorCode.MULTI_DEVICE_MISMATCH,
    severity: ErrorSeverity.HIGH,
    recoveryStrategy: RecoveryStrategy.CLEAR_CREDENTIALS,
    retryable: true,
    maxRetries: 2,
    baseDelay: 5000,
    maxDelay: 15000,
    description: 'Multi-device configuration mismatch'
  },
  [DisconnectReason.restartRequired]: {
    code: BaileysErrorCode.SESSION_EXPIRED,
    severity: ErrorSeverity.HIGH,
    recoveryStrategy: RecoveryStrategy.RESTART_SESSION,
    retryable: true,
    maxRetries: 3,
    baseDelay: 10000,
    maxDelay: 60000,
    description: 'Session restart is required'
  },
  [DisconnectReason.timedOut]: {
    code: BaileysErrorCode.CONNECTION_TIMEOUT,
    severity: ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 4,
    baseDelay: 5000,
    maxDelay: 20000,
    description: 'Connection timed out'
  }
};

// HTTP status code mapping for enhanced error handling
const HTTP_STATUS_MAPPING: Record<number, BaileysErrorInfo> = {
  400: {
    code: BaileysErrorCode.PROTOCOL_ERROR,
    severity: ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 2,
    baseDelay: 2000,
    maxDelay: 8000,
    description: 'Bad request - protocol error'
  },
  401: {
    code: BaileysErrorCode.AUTH_FAILURE,
    severity: ErrorSeverity.HIGH,
    recoveryStrategy: RecoveryStrategy.CLEAR_CREDENTIALS,
    retryable: true,
    maxRetries: 1,
    baseDelay: 5000,
    maxDelay: 10000,
    description: 'Authentication failed'
  },
  403: {
    code: BaileysErrorCode.CREDENTIALS_INVALID,
    severity: ErrorSeverity.HIGH,
    recoveryStrategy: RecoveryStrategy.CLEAR_CREDENTIALS,
    retryable: true,
    maxRetries: 1,
    baseDelay: 5000,
    maxDelay: 10000,
    description: 'Invalid credentials'
  },
  404: {
    code: BaileysErrorCode.SESSION_INVALID,
    severity: ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy.RESTART_SESSION,
    retryable: true,
    maxRetries: 2,
    baseDelay: 3000,
    maxDelay: 12000,
    description: 'Session not found'
  },
  429: {
    code: BaileysErrorCode.RATE_LIMITED,
    severity: ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 3,
    baseDelay: 10000,
    maxDelay: 60000,
    description: 'Rate limited - too many requests'
  },
  500: {
    code: BaileysErrorCode.SERVER_ERROR,
    severity: ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 3,
    baseDelay: 5000,
    maxDelay: 30000,
    description: 'Internal server error'
  },
  502: {
    code: BaileysErrorCode.NETWORK_ERROR,
    severity: ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 4,
    baseDelay: 3000,
    maxDelay: 20000,
    description: 'Bad gateway - network error'
  },
  503: {
    code: BaileysErrorCode.SERVER_ERROR,
    severity: ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 5,
    baseDelay: 8000,
    maxDelay: 40000,
    description: 'Service unavailable'
  }
};

// Session recovery state management
const sessionRecoveryStates = new Map<number, SessionRecoveryState>();

export class BaileysErrorHandler {
  
  /**
   * Analyze error and return enhanced error information
   */
  static analyzeError(error: any, lastDisconnect?: any): BaileysErrorInfo {
    // Handle Boom errors (HTTP status codes)
    if (error && error.output && error.output.statusCode) {
      const statusCode = error.output.statusCode;
      const errorInfo = HTTP_STATUS_MAPPING[statusCode];
      if (errorInfo) {
        return errorInfo;
      }
    }

    // Handle disconnect reasons
    if (lastDisconnect && lastDisconnect.error) {
      const boom = lastDisconnect.error as Boom;
      const statusCode = boom.output?.statusCode;
      
      if (statusCode && DISCONNECT_REASON_MAPPING[statusCode]) {
        return DISCONNECT_REASON_MAPPING[statusCode];
      }
    }

    // Handle specific error messages
    const errorMessage = error?.message || error?.toString() || '';
    
    if (errorMessage.includes('timeout')) {
      return {
        code: BaileysErrorCode.CONNECTION_TIMEOUT,
        severity: ErrorSeverity.MEDIUM,
        recoveryStrategy: RecoveryStrategy.RETRY,
        retryable: true,
        maxRetries: 3,
        baseDelay: 5000,
        maxDelay: 20000,
        description: 'Operation timed out'
      };
    }

    if (errorMessage.includes('network') || errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNRESET')) {
      return {
        code: BaileysErrorCode.NETWORK_ERROR,
        severity: ErrorSeverity.MEDIUM,
        recoveryStrategy: RecoveryStrategy.RETRY,
        retryable: true,
        maxRetries: 4,
        baseDelay: 3000,
        maxDelay: 15000,
        description: 'Network connectivity error'
      };
    }

    if (errorMessage.includes('version') || errorMessage.includes('protocol')) {
      return {
        code: BaileysErrorCode.VERSION_MISMATCH,
        severity: ErrorSeverity.HIGH,
        recoveryStrategy: RecoveryStrategy.RESTART_SESSION,
        retryable: true,
        maxRetries: 2,
        baseDelay: 10000,
        maxDelay: 30000,
        description: 'Protocol or version mismatch'
      };
    }

    // Default unknown error
    return {
      code: BaileysErrorCode.UNKNOWN_ERROR,
      severity: ErrorSeverity.MEDIUM,
      recoveryStrategy: RecoveryStrategy.RETRY,
      retryable: true,
      maxRetries: 2,
      baseDelay: 5000,
      maxDelay: 15000,
      description: 'Unknown error occurred'
    };
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  static calculateRetryDelay(config: RetryConfig): number {
    const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, config.attempt - 1);
    let delay = Math.min(exponentialDelay, config.maxDelay);
    
    // Add jitter to prevent thundering herd
    if (config.jitter) {
      const jitterAmount = delay * 0.1; // 10% jitter
      delay += (Math.random() - 0.5) * 2 * jitterAmount;
    }
    
    return Math.max(delay, config.baseDelay);
  }

  /**
   * Check if error is retryable based on current state
   */
  static isRetryable(whatsappId: number, errorInfo: BaileysErrorInfo): boolean {
    const recoveryState = sessionRecoveryStates.get(whatsappId);
    
    if (!errorInfo.retryable) {
      return false;
    }
    
    if (!recoveryState) {
      return true;
    }
    
    // Check if max retries exceeded
    if (recoveryState.retryCount >= errorInfo.maxRetries) {
      return false;
    }
    
    // Check if too many consecutive failures
    if (recoveryState.consecutiveFailures >= 10) {
      return false;
    }
    
    // Check if recovery is already in progress
    if (recoveryState.recoveryInProgress) {
      return false;
    }
    
    return true;
  }

  /**
   * Update session recovery state
   */
  static updateRecoveryState(whatsappId: number, errorCode: BaileysErrorCode, success: boolean = false): void {
    let state = sessionRecoveryStates.get(whatsappId);
    
    if (!state) {
      state = {
        whatsappId,
        retryCount: 0,
        lastError: errorCode,
        lastRetryTime: new Date(),
        recoveryInProgress: false,
        consecutiveFailures: 0
      };
    }
    
    if (success) {
      // Reset state on successful recovery
      state.retryCount = 0;
      state.consecutiveFailures = 0;
      state.recoveryInProgress = false;
    } else {
      // Update failure state
      state.retryCount++;
      state.consecutiveFailures++;
      state.lastError = errorCode;
      state.lastRetryTime = new Date();
    }
    
    sessionRecoveryStates.set(whatsappId, state);
  }

  /**
   * Set recovery in progress state
   */
  static setRecoveryInProgress(whatsappId: number, inProgress: boolean): void {
    const state = sessionRecoveryStates.get(whatsappId);
    if (state) {
      state.recoveryInProgress = inProgress;
      sessionRecoveryStates.set(whatsappId, state);
    }
  }

  /**
   * Get recovery state for a session
   */
  static getRecoveryState(whatsappId: number): SessionRecoveryState | undefined {
    return sessionRecoveryStates.get(whatsappId);
  }

  /**
   * Clear recovery state for a session
   */
  static clearRecoveryState(whatsappId: number): void {
    sessionRecoveryStates.delete(whatsappId);
  }

  /**
   * Enhanced error logging with structured context
   */
  static logError(
    error: any,
    errorInfo: BaileysErrorInfo,
    context: LogContext,
    lastDisconnect?: any
  ): void {
    const enhancedContext = {
      ...context,
      operation: 'error_handling',
      metadata: {
        errorCode: errorInfo.code,
        severity: errorInfo.severity,
        recoveryStrategy: errorInfo.recoveryStrategy,
        retryable: errorInfo.retryable,
        maxRetries: errorInfo.maxRetries,
        statusCode: lastDisconnect?.error?.output?.statusCode,
        disconnectReason: lastDisconnect?.error?.output?.statusCode,
        errorMessage: error?.message || error?.toString(),
        ...context.metadata
      }
    };

    connectionLogger.logError(
      error,
      enhancedContext,
      `Baileys Error: ${errorInfo.description} (${errorInfo.code})`
    );

    // Also log to standard logger for backward compatibility
    logger.error(
      `Baileys Error [${errorInfo.code}]: ${errorInfo.description} - WhatsApp: ${context.whatsappId}, Severity: ${errorInfo.severity}, Recovery: ${errorInfo.recoveryStrategy}, Error: ${error?.message || error?.toString()}`
    );
  }

  /**
   * Log recovery attempt
   */
  static logRecoveryAttempt(
    whatsappId: number,
    errorInfo: BaileysErrorInfo,
    attempt: number,
    delay: number,
    context: LogContext
  ): void {
    const enhancedContext = {
      ...context,
      operation: 'recovery_attempt',
      metadata: {
        errorCode: errorInfo.code,
        recoveryStrategy: errorInfo.recoveryStrategy,
        attempt,
        delay,
        maxRetries: errorInfo.maxRetries,
        ...context.metadata
      }
    };

    connectionLogger.logConnectionEvent(
      ConnectionEventType.RECONNECTING,
      enhancedContext,
      `Recovery attempt ${attempt}/${errorInfo.maxRetries} for ${errorInfo.code} (delay: ${delay}ms)`
    );
  }

  /**
   * Log successful recovery
   */
  static logRecoverySuccess(whatsappId: number, errorCode: BaileysErrorCode, context: LogContext): void {
    const enhancedContext = {
      ...context,
      operation: 'recovery_success',
      metadata: {
        errorCode,
        ...context.metadata
      }
    };

    connectionLogger.logConnectionEvent(
      ConnectionEventType.CONNECTED,
      enhancedContext,
      `Successfully recovered from ${errorCode}`
    );
  }

  /**
   * Log recovery failure
   */
  static logRecoveryFailure(whatsappId: number, errorCode: BaileysErrorCode, context: LogContext): void {
    const enhancedContext = {
      ...context,
      operation: 'recovery_failure',
      metadata: {
        errorCode,
        ...context.metadata
      }
    };

    connectionLogger.logError(
      new Error(`Recovery failed for ${errorCode}`),
      enhancedContext,
      `Failed to recover from ${errorCode} after maximum retries`
    );
  }
}

export default BaileysErrorHandler;