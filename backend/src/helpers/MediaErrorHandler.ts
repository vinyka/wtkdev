import { messageLogger, LogContext, MessageEventType, performanceLogger } from "../utils/enhancedLogger";
import logger from "../utils/logger";

// Enhanced media error codes for Baileys 6.7.19
export enum MediaErrorCode {
  // Download errors
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  DOWNLOAD_TIMEOUT = 'DOWNLOAD_TIMEOUT',
  DOWNLOAD_CORRUPTED = 'DOWNLOAD_CORRUPTED',
  DOWNLOAD_SIZE_EXCEEDED = 'DOWNLOAD_SIZE_EXCEEDED',
  DOWNLOAD_NETWORK_ERROR = 'DOWNLOAD_NETWORK_ERROR',
  
  // Format errors
  UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',
  INVALID_MEDIA_TYPE = 'INVALID_MEDIA_TYPE',
  CORRUPTED_MEDIA = 'CORRUPTED_MEDIA',
  
  // Processing errors
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  CONVERSION_FAILED = 'CONVERSION_FAILED',
  COMPRESSION_FAILED = 'COMPRESSION_FAILED',
  
  // Storage errors
  STORAGE_FULL = 'STORAGE_FULL',
  STORAGE_PERMISSION = 'STORAGE_PERMISSION',
  STORAGE_WRITE_ERROR = 'STORAGE_WRITE_ERROR',
  
  // Network errors
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE',
  RATE_LIMITED = 'RATE_LIMITED',
  
  // Authentication errors
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  
  // Unknown errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

// Media types for specific error handling
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  STICKER = 'sticker',
  UNKNOWN = 'unknown'
}

// Media error severity levels
export enum MediaErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Media recovery strategies
export enum MediaRecoveryStrategy {
  RETRY = 'retry',
  RETRY_WITH_DIFFERENT_METHOD = 'retry_with_different_method',
  FALLBACK_TO_PLACEHOLDER = 'fallback_to_placeholder',
  SKIP_MEDIA = 'skip_media',
  MANUAL_INTERVENTION = 'manual_intervention',
  NO_RECOVERY = 'no_recovery'
}

// Enhanced media error information
export interface MediaErrorInfo {
  code: MediaErrorCode;
  severity: MediaErrorSeverity;
  recoveryStrategy: MediaRecoveryStrategy;
  retryable: boolean;
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  description: string;
  mediaType?: MediaType;
}

// Media retry configuration
export interface MediaRetryConfig {
  attempt: number;
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  mediaType: MediaType;
  messageId?: string;
}

// Media processing state
export interface MediaProcessingState {
  messageId: string;
  mediaType: MediaType;
  retryCount: number;
  lastError: MediaErrorCode;
  lastRetryTime: Date;
  processingInProgress: boolean;
  consecutiveFailures: number;
  totalSize?: number;
  downloadedSize?: number;
}

// Enhanced error mapping for different media types and error scenarios
const MEDIA_ERROR_MAPPING: Record<string, MediaErrorInfo> = {
  // Download errors
  'ENOTFOUND': {
    code: MediaErrorCode.DOWNLOAD_NETWORK_ERROR,
    severity: MediaErrorSeverity.MEDIUM,
    recoveryStrategy: MediaRecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 3,
    baseDelay: 2000,
    maxDelay: 10000,
    description: 'Network DNS resolution failed'
  },
  'ECONNRESET': {
    code: MediaErrorCode.DOWNLOAD_NETWORK_ERROR,
    severity: MediaErrorSeverity.MEDIUM,
    recoveryStrategy: MediaRecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 4,
    baseDelay: 1500,
    maxDelay: 8000,
    description: 'Connection reset by peer'
  },
  'ETIMEDOUT': {
    code: MediaErrorCode.DOWNLOAD_TIMEOUT,
    severity: MediaErrorSeverity.MEDIUM,
    recoveryStrategy: MediaRecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 3,
    baseDelay: 3000,
    maxDelay: 15000,
    description: 'Download operation timed out'
  },
  'timeout': {
    code: MediaErrorCode.DOWNLOAD_TIMEOUT,
    severity: MediaErrorSeverity.MEDIUM,
    recoveryStrategy: MediaRecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 3,
    baseDelay: 3000,
    maxDelay: 15000,
    description: 'Download timeout'
  },
  'empty': {
    code: MediaErrorCode.DOWNLOAD_CORRUPTED,
    severity: MediaErrorSeverity.HIGH,
    recoveryStrategy: MediaRecoveryStrategy.RETRY_WITH_DIFFERENT_METHOD,
    retryable: true,
    maxRetries: 2,
    baseDelay: 2000,
    maxDelay: 8000,
    description: 'Downloaded buffer is empty'
  },
  'corrupted': {
    code: MediaErrorCode.CORRUPTED_MEDIA,
    severity: MediaErrorSeverity.HIGH,
    recoveryStrategy: MediaRecoveryStrategy.FALLBACK_TO_PLACEHOLDER,
    retryable: false,
    maxRetries: 0,
    baseDelay: 0,
    maxDelay: 0,
    description: 'Media file is corrupted'
  },
  'unsupported': {
    code: MediaErrorCode.UNSUPPORTED_FORMAT,
    severity: MediaErrorSeverity.MEDIUM,
    recoveryStrategy: MediaRecoveryStrategy.SKIP_MEDIA,
    retryable: false,
    maxRetries: 0,
    baseDelay: 0,
    maxDelay: 0,
    description: 'Unsupported media format'
  },
  'size_exceeded': {
    code: MediaErrorCode.DOWNLOAD_SIZE_EXCEEDED,
    severity: MediaErrorSeverity.MEDIUM,
    recoveryStrategy: MediaRecoveryStrategy.SKIP_MEDIA,
    retryable: false,
    maxRetries: 0,
    baseDelay: 0,
    maxDelay: 0,
    description: 'Media size exceeds maximum allowed'
  },
  'rate_limited': {
    code: MediaErrorCode.RATE_LIMITED,
    severity: MediaErrorSeverity.MEDIUM,
    recoveryStrategy: MediaRecoveryStrategy.RETRY,
    retryable: true,
    maxRetries: 2,
    baseDelay: 10000,
    maxDelay: 30000,
    description: 'Rate limited by server'
  },
  'auth_expired': {
    code: MediaErrorCode.AUTH_EXPIRED,
    severity: MediaErrorSeverity.HIGH,
    recoveryStrategy: MediaRecoveryStrategy.MANUAL_INTERVENTION,
    retryable: false,
    maxRetries: 0,
    baseDelay: 0,
    maxDelay: 0,
    description: 'Authentication expired'
  },
  'permission_denied': {
    code: MediaErrorCode.PERMISSION_DENIED,
    severity: MediaErrorSeverity.HIGH,
    recoveryStrategy: MediaRecoveryStrategy.SKIP_MEDIA,
    retryable: false,
    maxRetries: 0,
    baseDelay: 0,
    maxDelay: 0,
    description: 'Permission denied to access media'
  }
};

// Media type specific configurations
const MEDIA_TYPE_CONFIGS: Record<MediaType, Partial<MediaErrorInfo>> = {
  [MediaType.IMAGE]: {
    maxRetries: 4,
    baseDelay: 1000,
    maxDelay: 8000
  },
  [MediaType.VIDEO]: {
    maxRetries: 3,
    baseDelay: 3000,
    maxDelay: 20000
  },
  [MediaType.AUDIO]: {
    maxRetries: 4,
    baseDelay: 1500,
    maxDelay: 12000
  },
  [MediaType.DOCUMENT]: {
    maxRetries: 3,
    baseDelay: 2000,
    maxDelay: 15000
  },
  [MediaType.STICKER]: {
    maxRetries: 5,
    baseDelay: 500,
    maxDelay: 5000
  },
  [MediaType.UNKNOWN]: {
    maxRetries: 2,
    baseDelay: 2000,
    maxDelay: 10000
  }
};

// Media processing state management
const mediaProcessingStates = new Map<string, MediaProcessingState>();

export class MediaErrorHandler {
  
  /**
   * Analyze media error and return enhanced error information
   */
  static analyzeMediaError(error: any, mediaType: MediaType = MediaType.UNKNOWN): MediaErrorInfo {
    const errorMessage = error?.message || error?.toString() || '';
    const errorCode = error?.code || '';
    
    // Check for specific error patterns
    let errorInfo: MediaErrorInfo | undefined;
    
    // Check error code first
    if (errorCode && MEDIA_ERROR_MAPPING[errorCode]) {
      errorInfo = { ...MEDIA_ERROR_MAPPING[errorCode] };
    }
    // Check error message patterns
    else {
      for (const [pattern, info] of Object.entries(MEDIA_ERROR_MAPPING)) {
        if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
          errorInfo = { ...info };
          break;
        }
      }
    }
    
    // Default to unknown error if no match found
    if (!errorInfo) {
      errorInfo = {
        code: MediaErrorCode.UNKNOWN_ERROR,
        severity: MediaErrorSeverity.MEDIUM,
        recoveryStrategy: MediaRecoveryStrategy.RETRY,
        retryable: true,
        maxRetries: 2,
        baseDelay: 2000,
        maxDelay: 10000,
        description: 'Unknown media error occurred'
      };
    }
    
    // Apply media type specific configurations
    const typeConfig = MEDIA_TYPE_CONFIGS[mediaType];
    if (typeConfig) {
      errorInfo = { ...errorInfo, ...typeConfig };
    }
    
    errorInfo.mediaType = mediaType;
    
    return errorInfo;
  }

  /**
   * Determine media type from message or error context
   */
  static determineMediaType(msg?: any, mimeType?: string): MediaType {
    if (mimeType) {
      if (mimeType.startsWith('image/')) return MediaType.IMAGE;
      if (mimeType.startsWith('video/')) return MediaType.VIDEO;
      if (mimeType.startsWith('audio/')) return MediaType.AUDIO;
      if (mimeType.includes('document')) return MediaType.DOCUMENT;
      if (mimeType.includes('sticker')) return MediaType.STICKER;
    }
    
    if (msg?.message) {
      if (msg.message.imageMessage) return MediaType.IMAGE;
      if (msg.message.videoMessage) return MediaType.VIDEO;
      if (msg.message.audioMessage) return MediaType.AUDIO;
      if (msg.message.documentMessage) return MediaType.DOCUMENT;
      if (msg.message.stickerMessage) return MediaType.STICKER;
    }
    
    return MediaType.UNKNOWN;
  }

  /**
   * Calculate retry delay with media-specific exponential backoff
   */
  static calculateMediaRetryDelay(config: MediaRetryConfig): number {
    const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, config.attempt - 1);
    let delay = Math.min(exponentialDelay, config.maxDelay);
    
    // Add media type specific adjustments
    switch (config.mediaType) {
      case MediaType.VIDEO:
        delay *= 1.5; // Videos need more time
        break;
      case MediaType.STICKER:
        delay *= 0.5; // Stickers are smaller, retry faster
        break;
      case MediaType.AUDIO:
        delay *= 1.2; // Audio files need slightly more time
        break;
    }
    
    // Add jitter to prevent thundering herd
    if (config.jitter) {
      const jitterAmount = delay * 0.15; // 15% jitter for media
      delay += (Math.random() - 0.5) * 2 * jitterAmount;
    }
    
    return Math.max(delay, config.baseDelay);
  }

  /**
   * Check if media error is retryable
   */
  static isMediaRetryable(messageId: string, errorInfo: MediaErrorInfo): boolean {
    const processingState = mediaProcessingStates.get(messageId);
    
    if (!errorInfo.retryable) {
      return false;
    }
    
    if (!processingState) {
      return true;
    }
    
    // Check if max retries exceeded
    if (processingState.retryCount >= errorInfo.maxRetries) {
      return false;
    }
    
    // Check if too many consecutive failures
    if (processingState.consecutiveFailures >= 8) {
      return false;
    }
    
    // Check if processing is already in progress
    if (processingState.processingInProgress) {
      return false;
    }
    
    return true;
  }

  /**
   * Update media processing state
   */
  static updateMediaProcessingState(
    messageId: string, 
    mediaType: MediaType,
    errorCode: MediaErrorCode, 
    success: boolean = false
  ): void {
    let state = mediaProcessingStates.get(messageId);
    
    if (!state) {
      state = {
        messageId,
        mediaType,
        retryCount: 0,
        lastError: errorCode,
        lastRetryTime: new Date(),
        processingInProgress: false,
        consecutiveFailures: 0
      };
    }
    
    if (success) {
      // Reset state on successful processing
      state.retryCount = 0;
      state.consecutiveFailures = 0;
      state.processingInProgress = false;
    } else {
      // Update failure state
      state.retryCount++;
      state.consecutiveFailures++;
      state.lastError = errorCode;
      state.lastRetryTime = new Date();
    }
    
    mediaProcessingStates.set(messageId, state);
  }

  /**
   * Set media processing in progress state
   */
  static setMediaProcessingInProgress(messageId: string, inProgress: boolean): void {
    const state = mediaProcessingStates.get(messageId);
    if (state) {
      state.processingInProgress = inProgress;
      mediaProcessingStates.set(messageId, state);
    }
  }

  /**
   * Get media processing state
   */
  static getMediaProcessingState(messageId: string): MediaProcessingState | undefined {
    return mediaProcessingStates.get(messageId);
  }

  /**
   * Clear media processing state
   */
  static clearMediaProcessingState(messageId: string): void {
    mediaProcessingStates.delete(messageId);
  }

  /**
   * Enhanced media error logging with structured context
   */
  static logMediaError(
    error: any,
    errorInfo: MediaErrorInfo,
    context: LogContext,
    additionalInfo?: {
      fileSize?: number;
      downloadedSize?: number;
      mimeType?: string;
      fileName?: string;
    }
  ): void {
    const enhancedContext = {
      ...context,
      operation: 'media_error_handling',
      metadata: {
        errorCode: errorInfo.code,
        severity: errorInfo.severity,
        recoveryStrategy: errorInfo.recoveryStrategy,
        retryable: errorInfo.retryable,
        maxRetries: errorInfo.maxRetries,
        mediaType: errorInfo.mediaType,
        errorMessage: error?.message || error?.toString(),
        ...additionalInfo,
        ...context.metadata
      }
    };

    messageLogger.logError(
      error,
      enhancedContext,
      `Media Error: ${errorInfo.description} (${errorInfo.code})`
    );

    // Also log to standard logger for backward compatibility
    logger.error(
      `Media Error [${errorInfo.code}]: ${errorInfo.description} - Message: ${context.messageId}, Type: ${errorInfo.mediaType}, Severity: ${errorInfo.severity}, Recovery: ${errorInfo.recoveryStrategy}, Error: ${error?.message || error?.toString()}`
    );
  }

  /**
   * Log media retry attempt
   */
  static logMediaRetryAttempt(
    messageId: string,
    errorInfo: MediaErrorInfo,
    attempt: number,
    delay: number,
    context: LogContext
  ): void {
    const enhancedContext = {
      ...context,
      operation: 'media_retry_attempt',
      metadata: {
        errorCode: errorInfo.code,
        recoveryStrategy: errorInfo.recoveryStrategy,
        mediaType: errorInfo.mediaType,
        attempt,
        delay,
        maxRetries: errorInfo.maxRetries,
        ...context.metadata
      }
    };

    messageLogger.logMessageEvent(
      MessageEventType.MEDIA_DOWNLOAD,
      enhancedContext,
      `Media retry attempt ${attempt}/${errorInfo.maxRetries} for ${errorInfo.code} (delay: ${delay}ms)`
    );
  }

  /**
   * Log successful media recovery
   */
  static logMediaRecoverySuccess(
    messageId: string, 
    errorCode: MediaErrorCode, 
    mediaType: MediaType,
    context: LogContext
  ): void {
    const enhancedContext = {
      ...context,
      operation: 'media_recovery_success',
      metadata: {
        errorCode,
        mediaType,
        ...context.metadata
      }
    };

    messageLogger.logMessageEvent(
      MessageEventType.MEDIA_DOWNLOAD,
      enhancedContext,
      `Successfully recovered from media error ${errorCode}`
    );
  }

  /**
   * Log media recovery failure
   */
  static logMediaRecoveryFailure(
    messageId: string, 
    errorCode: MediaErrorCode, 
    mediaType: MediaType,
    context: LogContext
  ): void {
    const enhancedContext = {
      ...context,
      operation: 'media_recovery_failure',
      metadata: {
        errorCode,
        mediaType,
        ...context.metadata
      }
    };

    messageLogger.logError(
      new Error(`Media recovery failed for ${errorCode}`),
      enhancedContext,
      `Failed to recover from media error ${errorCode} after maximum retries`
    );
  }

  /**
   * Create fallback placeholder for failed media
   */
  static createMediaFallback(mediaType: MediaType, errorInfo: MediaErrorInfo): any {
    const fallbackData = {
      error: true,
      errorCode: errorInfo.code,
      errorDescription: errorInfo.description,
      mediaType,
      timestamp: new Date().toISOString()
    };

    switch (mediaType) {
      case MediaType.IMAGE:
        return {
          ...fallbackData,
          placeholder: 'image_unavailable',
          mimeType: 'text/plain'
        };
      case MediaType.VIDEO:
        return {
          ...fallbackData,
          placeholder: 'video_unavailable',
          mimeType: 'text/plain'
        };
      case MediaType.AUDIO:
        return {
          ...fallbackData,
          placeholder: 'audio_unavailable',
          mimeType: 'text/plain'
        };
      case MediaType.DOCUMENT:
        return {
          ...fallbackData,
          placeholder: 'document_unavailable',
          mimeType: 'text/plain'
        };
      case MediaType.STICKER:
        return {
          ...fallbackData,
          placeholder: 'sticker_unavailable',
          mimeType: 'text/plain'
        };
      default:
        return {
          ...fallbackData,
          placeholder: 'media_unavailable',
          mimeType: 'text/plain'
        };
    }
  }
}

export default MediaErrorHandler;