import pino from 'pino';
import moment from 'moment-timezone';

// Enhanced logging levels for Baileys 6.7.19 debugging
export enum LogLevel {
  TRACE = 'trace',
  DEBUG = 'debug', 
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

// Enhanced log context for structured logging
export interface LogContext {
  whatsappId?: number;
  companyId?: number;
  messageId?: string;
  contactId?: string;
  ticketId?: number;
  sessionName?: string;
  operation?: string;
  duration?: number;
  error?: Error | string;
  metadata?: Record<string, any>;
}

// Connection event types for structured logging
export enum ConnectionEventType {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  QR_GENERATED = 'qr_generated',
  AUTH_SUCCESS = 'auth_success',
  AUTH_FAILURE = 'auth_failure',
  LOGOUT = 'logout'
}

// Message processing event types
export enum MessageEventType {
  RECEIVED = 'message_received',
  SENT = 'message_sent',
  PROCESSED = 'message_processed',
  MEDIA_DOWNLOAD = 'media_download',
  MEDIA_UPLOAD = 'media_upload',
  INTERACTIVE_PROCESSED = 'interactive_processed',
  REACTION_PROCESSED = 'reaction_processed'
}

// Performance metrics interface
export interface PerformanceMetrics {
  operation: string;
  duration: number;
  success: boolean;
  memoryUsage?: NodeJS.MemoryUsage;
  timestamp: Date;
  context?: LogContext;
}

// Função para obter o timestamp com fuso horário
const timezoned = () => {
  return moment().tz('America/Sao_Paulo').format('DD-MM-YYYY HH:mm:ss');
};

// Enhanced logger configuration for Baileys 6.7.19
const enhancedLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      levelFirst: true,
      translateTime: 'SYS:dd-mm-yyyy HH:MM:ss',
      ignore: "pid,hostname",
      messageFormat: '{time} [{level}] {msg} {context}'
    },
  },
  timestamp: () => `,"time":"${timezoned()}"`,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  serializers: {
    error: pino.stdSerializers.err,
    context: (context: LogContext) => {
      return {
        whatsappId: context.whatsappId,
        companyId: context.companyId,
        messageId: context.messageId,
        contactId: context.contactId,
        ticketId: context.ticketId,
        sessionName: context.sessionName,
        operation: context.operation,
        duration: context.duration,
        metadata: context.metadata
      };
    }
  }
});

// Enhanced logging class with structured logging capabilities
export class EnhancedLogger {
  private logger: pino.Logger;
  private performanceMetrics: PerformanceMetrics[] = [];
  private maxMetricsHistory = 1000;

  constructor(component?: string) {
    this.logger = component ? enhancedLogger.child({ component }) : enhancedLogger;
  }

  // Connection event logging with structured data
  logConnectionEvent(
    eventType: ConnectionEventType, 
    context: LogContext, 
    message?: string
  ): void {
    const logMessage = message || `Connection event: ${eventType}`;
    
    this.logger.info({
      event: eventType,
      context,
      timestamp: new Date().toISOString()
    }, logMessage);
  }

  // Message processing logging with enhanced context
  logMessageEvent(
    eventType: MessageEventType,
    context: LogContext,
    message?: string
  ): void {
    const logMessage = message || `Message event: ${eventType}`;
    
    this.logger.info({
      event: eventType,
      context,
      timestamp: new Date().toISOString()
    }, logMessage);
  }

  // Performance metrics logging
  logPerformanceMetric(metric: PerformanceMetrics): void {
    this.performanceMetrics.push(metric);
    
    // Keep only recent metrics
    if (this.performanceMetrics.length > this.maxMetricsHistory) {
      this.performanceMetrics = this.performanceMetrics.slice(-this.maxMetricsHistory);
    }

    this.logger.info({
      performance: metric,
      timestamp: new Date().toISOString()
    }, `Performance: ${metric.operation} took ${metric.duration}ms`);
  }

  // Enhanced error logging with context
  logError(error: Error | string, context?: LogContext, message?: string): void {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    
    this.logger.error({
      error: errorObj,
      context,
      timestamp: new Date().toISOString(),
      stack: errorObj.stack
    }, message || errorObj.message);
  }

  // Debug logging for Baileys 6.7.19 specific features
  logDebug(message: string, context?: LogContext): void {
    this.logger.debug({
      context,
      timestamp: new Date().toISOString()
    }, message);
  }

  // Warning logging with context
  logWarning(message: string, context?: LogContext): void {
    this.logger.warn({
      context,
      timestamp: new Date().toISOString()
    }, message);
  }

  // Info logging with context
  logInfo(message: string, context?: LogContext): void {
    this.logger.info({
      context,
      timestamp: new Date().toISOString()
    }, message);
  }

  // Get performance metrics for monitoring
  getPerformanceMetrics(): PerformanceMetrics[] {
    return [...this.performanceMetrics];
  }

  // Clear performance metrics
  clearPerformanceMetrics(): void {
    this.performanceMetrics = [];
  }

  // Get metrics summary
  getMetricsSummary(): {
    totalOperations: number;
    averageDuration: number;
    successRate: number;
    errorCount: number;
  } {
    const total = this.performanceMetrics.length;
    if (total === 0) {
      return {
        totalOperations: 0,
        averageDuration: 0,
        successRate: 0,
        errorCount: 0
      };
    }

    const totalDuration = this.performanceMetrics.reduce((sum, metric) => sum + metric.duration, 0);
    const successCount = this.performanceMetrics.filter(metric => metric.success).length;
    const errorCount = total - successCount;

    return {
      totalOperations: total,
      averageDuration: totalDuration / total,
      successRate: (successCount / total) * 100,
      errorCount
    };
  }
}

// Create default enhanced logger instance
export const defaultEnhancedLogger = new EnhancedLogger('baileys-system');

// Baileys-specific logger for debugging
export const baileysLogger = new EnhancedLogger('baileys-core');

// Connection logger for connection events
export const connectionLogger = new EnhancedLogger('baileys-connection');

// Message processing logger
export const messageLogger = new EnhancedLogger('baileys-messages');

// Performance logger
export const performanceLogger = new EnhancedLogger('baileys-performance');

export default enhancedLogger;