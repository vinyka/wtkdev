import { EventEmitter } from 'events';
import { performanceLogger, PerformanceMetrics, LogContext } from '../utils/enhancedLogger';

// Memory usage tracking interface
export interface MemoryMetrics {
  rss: number; // Resident Set Size
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  timestamp: Date;
}

// System performance metrics
export interface SystemMetrics {
  cpuUsage: NodeJS.CpuUsage;
  memoryUsage: MemoryMetrics;
  uptime: number;
  timestamp: Date;
}

// WhatsApp connection performance metrics
export interface WhatsAppMetrics {
  whatsappId: number;
  companyId: number;
  connectionTime: number;
  messagesProcessed: number;
  mediaDownloads: number;
  mediaUploads: number;
  errors: number;
  lastActivity: Date;
  averageResponseTime: number;
  cacheHitRate: number;
}

// Media processing metrics
export interface MediaMetrics {
  totalDownloads: number;
  successfulDownloads: number;
  failedDownloads: number;
  retryAttempts: number;
  corruptedDownloads: number;
  downloadsByType: {
    image: number;
    video: number;
    audio: number;
    document: number;
  };
  averageDownloadSpeed: number; // bytes per second
  averageDownloadTime: number; // milliseconds
  cacheHitRate: number;
  streamingDownloads: number;
  averageChunkSize: number;
  voiceMessageCount: number;
  transcriptionCount: number;
  averageTranscriptionTime: number;
  documentTypeDistribution: Record<string, number>;
  concurrentDownloads: number;
  averageConcurrency: number;
  circuitBreakerTrips: number;
  peakMemoryUsage: number;
}

// Resource usage metrics
export interface ResourceMetrics {
  memoryUsage: MemoryMetrics;
  cpuUsage: NodeJS.CpuUsage;
  diskUsage?: {
    used: number;
    available: number;
    total: number;
  };
}

// Performance dashboard data
export interface PerformanceDashboard {
  systemMetrics: SystemMetrics;
  whatsappMetrics: WhatsAppMetrics[];
  recentPerformanceMetrics: PerformanceMetrics[];
  alerts: PerformanceAlert[];
  summary: {
    totalConnections: number;
    totalMessages: number;
    averageProcessingTime: number;
    errorRate: number;
    memoryTrend: 'increasing' | 'decreasing' | 'stable';
  };
}

// Performance alert interface
export interface PerformanceAlert {
  id: string;
  type: 'memory' | 'cpu' | 'error_rate' | 'response_time';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
  context?: LogContext;
}

export class PerformanceMonitoringService extends EventEmitter {
  private static instance: PerformanceMonitoringService;
  private whatsappMetrics: Map<number, WhatsAppMetrics> = new Map();
  private systemMetricsHistory: SystemMetrics[] = [];
  private performanceMetricsHistory: PerformanceMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private maxHistorySize = 1000;
  private alertThresholds = {
    memoryUsage: 0.8, // 80% of heap
    errorRate: 0.05, // 5% error rate
    responseTime: 5000, // 5 seconds
    cpuUsage: 0.8 // 80% CPU usage
  };

  // Media processing tracking
  private mediaMetrics: MediaMetrics = {
    totalDownloads: 0,
    successfulDownloads: 0,
    failedDownloads: 0,
    retryAttempts: 0,
    corruptedDownloads: 0,
    downloadsByType: {
      image: 0,
      video: 0,
      audio: 0,
      document: 0
    },
    averageDownloadSpeed: 0,
    averageDownloadTime: 0,
    cacheHitRate: 0,
    streamingDownloads: 0,
    averageChunkSize: 0,
    voiceMessageCount: 0,
    transcriptionCount: 0,
    averageTranscriptionTime: 0,
    documentTypeDistribution: {},
    concurrentDownloads: 0,
    averageConcurrency: 0,
    circuitBreakerTrips: 0,
    peakMemoryUsage: 0
  };

  private activeDownloads: Map<string, {
    startTime: number;
    type: string;
    size: number;
    progress: number;
  }> = new Map();

  private activeTranscriptions: Map<string, {
    startTime: number;
  }> = new Map();

  private downloadTimes: number[] = [];
  private downloadSpeeds: number[] = [];
  private transcriptionTimes: number[] = [];
  private concurrencyHistory: number[] = [];

  private constructor() {
    super();
    this.startMonitoring();
  }

  public static getInstance(): PerformanceMonitoringService {
    if (!PerformanceMonitoringService.instance) {
      PerformanceMonitoringService.instance = new PerformanceMonitoringService();
    }
    return PerformanceMonitoringService.instance;
  }

  // Start performance monitoring
  private startMonitoring(): void {
    // Monitor system metrics every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.checkAlerts();
      this.cleanupOldMetrics();
    }, 30000);

    performanceLogger.logInfo('Performance monitoring started', {
      operation: 'monitoring_start',
      metadata: { interval: 30000 }
    });
  }

  // Stop performance monitoring
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    performanceLogger.logInfo('Performance monitoring stopped', {
      operation: 'monitoring_stop'
    });
  }

  // Collect system metrics
  private collectSystemMetrics(): void {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const systemMetrics: SystemMetrics = {
      cpuUsage,
      memoryUsage: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers,
        timestamp: new Date()
      },
      uptime: process.uptime(),
      timestamp: new Date()
    };

    this.systemMetricsHistory.push(systemMetrics);

    // Keep only recent metrics
    if (this.systemMetricsHistory.length > this.maxHistorySize) {
      this.systemMetricsHistory = this.systemMetricsHistory.slice(-this.maxHistorySize);
    }

    // Log system metrics
    performanceLogger.logPerformanceMetric({
      operation: 'system_metrics_collection',
      duration: 0,
      success: true,
      memoryUsage: memoryUsage,
      timestamp: new Date(),
      context: {
        operation: 'system_monitoring',
        metadata: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          uptime: process.uptime()
        }
      }
    });
  }

  // Track WhatsApp connection metrics
  public trackWhatsAppMetrics(whatsappId: number, companyId: number, metrics: Partial<WhatsAppMetrics>): void {
    const existing = this.whatsappMetrics.get(whatsappId) || {
      whatsappId,
      companyId,
      connectionTime: 0,
      messagesProcessed: 0,
      mediaDownloads: 0,
      mediaUploads: 0,
      errors: 0,
      lastActivity: new Date(),
      averageResponseTime: 0,
      cacheHitRate: 0
    };

    const updated = { ...existing, ...metrics, lastActivity: new Date() };
    this.whatsappMetrics.set(whatsappId, updated);

    performanceLogger.logInfo('WhatsApp metrics updated', {
      whatsappId,
      companyId,
      operation: 'whatsapp_metrics_update',
      metadata: metrics
    });
  }

  // Track performance metric
  public trackPerformanceMetric(metric: PerformanceMetrics): void {
    this.performanceMetricsHistory.push(metric);

    // Keep only recent metrics
    if (this.performanceMetricsHistory.length > this.maxHistorySize) {
      this.performanceMetricsHistory = this.performanceMetricsHistory.slice(-this.maxHistorySize);
    }

    performanceLogger.logPerformanceMetric(metric);
  }

  // Check for performance alerts
  private checkAlerts(): void {
    const currentMetrics = this.systemMetricsHistory[this.systemMetricsHistory.length - 1];
    if (!currentMetrics) return;

    // Check memory usage
    const memoryUsageRatio = currentMetrics.memoryUsage.heapUsed / currentMetrics.memoryUsage.heapTotal;
    if (memoryUsageRatio > this.alertThresholds.memoryUsage) {
      this.createAlert({
        type: 'memory',
        severity: memoryUsageRatio > 0.9 ? 'critical' : 'high',
        message: `High memory usage: ${(memoryUsageRatio * 100).toFixed(1)}%`,
        context: {
          operation: 'memory_alert',
          metadata: {
            heapUsed: currentMetrics.memoryUsage.heapUsed,
            heapTotal: currentMetrics.memoryUsage.heapTotal,
            usageRatio: memoryUsageRatio
          }
        }
      });
    }

    // Check error rate
    const recentMetrics = this.performanceMetricsHistory.slice(-100); // Last 100 operations
    if (recentMetrics.length > 10) {
      const errorCount = recentMetrics.filter(m => !m.success).length;
      const errorRate = errorCount / recentMetrics.length;
      
      if (errorRate > this.alertThresholds.errorRate) {
        this.createAlert({
          type: 'error_rate',
          severity: errorRate > 0.1 ? 'critical' : 'high',
          message: `High error rate: ${(errorRate * 100).toFixed(1)}%`,
          context: {
            operation: 'error_rate_alert',
            metadata: {
              errorCount,
              totalOperations: recentMetrics.length,
              errorRate
            }
          }
        });
      }
    }

    // Check response time
    const recentResponseTimes = recentMetrics
      .filter(m => m.success)
      .map(m => m.duration);
    
    if (recentResponseTimes.length > 0) {
      const averageResponseTime = recentResponseTimes.reduce((a, b) => a + b, 0) / recentResponseTimes.length;
      
      if (averageResponseTime > this.alertThresholds.responseTime) {
        this.createAlert({
          type: 'response_time',
          severity: averageResponseTime > 10000 ? 'critical' : 'high',
          message: `High response time: ${averageResponseTime.toFixed(0)}ms`,
          context: {
            operation: 'response_time_alert',
            metadata: {
              averageResponseTime,
              sampleSize: recentResponseTimes.length
            }
          }
        });
      }
    }
  }

  // Create performance alert
  private createAlert(alertData: Omit<PerformanceAlert, 'id' | 'timestamp' | 'resolved'>): void {
    const alert: PerformanceAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      resolved: false,
      ...alertData
    };

    this.alerts.push(alert);

    // Keep only recent alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    // Emit alert event
    this.emit('alert', alert);

    performanceLogger.logWarning(`Performance alert: ${alert.message}`, {
      operation: 'performance_alert',
      metadata: {
        alertId: alert.id,
        alertType: alert.type,
        severity: alert.severity
      }
    });
  }

  // Resolve alert
  public resolveAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      performanceLogger.logInfo(`Performance alert resolved: ${alert.message}`, {
        operation: 'alert_resolved',
        metadata: { alertId }
      });
    }
  }

  // Get performance dashboard data
  public getDashboard(): PerformanceDashboard {
    const currentSystemMetrics = this.systemMetricsHistory[this.systemMetricsHistory.length - 1];
    const recentMetrics = this.performanceMetricsHistory.slice(-100);
    const activeAlerts = this.alerts.filter(a => !a.resolved);

    // Calculate summary statistics
    const totalMessages = recentMetrics.length;
    const successfulOperations = recentMetrics.filter(m => m.success).length;
    const averageProcessingTime = successfulOperations > 0 
      ? recentMetrics.filter(m => m.success).reduce((sum, m) => sum + m.duration, 0) / successfulOperations
      : 0;
    const errorRate = totalMessages > 0 ? ((totalMessages - successfulOperations) / totalMessages) * 100 : 0;

    // Determine memory trend
    const recentMemoryUsage = this.systemMetricsHistory.slice(-10).map(m => m.memoryUsage.heapUsed);
    let memoryTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (recentMemoryUsage.length >= 2) {
      const first = recentMemoryUsage[0];
      const last = recentMemoryUsage[recentMemoryUsage.length - 1];
      const change = (last - first) / first;
      if (change > 0.1) memoryTrend = 'increasing';
      else if (change < -0.1) memoryTrend = 'decreasing';
    }

    return {
      systemMetrics: currentSystemMetrics || {
        cpuUsage: process.cpuUsage(),
        memoryUsage: {
          ...process.memoryUsage(),
          timestamp: new Date()
        },
        uptime: process.uptime(),
        timestamp: new Date()
      },
      whatsappMetrics: Array.from(this.whatsappMetrics.values()),
      recentPerformanceMetrics: recentMetrics,
      alerts: activeAlerts,
      summary: {
        totalConnections: this.whatsappMetrics.size,
        totalMessages,
        averageProcessingTime,
        errorRate,
        memoryTrend
      }
    };
  }

  // Get metrics for specific WhatsApp connection
  public getWhatsAppMetrics(whatsappId: number): WhatsAppMetrics | undefined {
    return this.whatsappMetrics.get(whatsappId);
  }

  // Clean up old metrics
  private cleanupOldMetrics(): void {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    // Clean up old system metrics
    this.systemMetricsHistory = this.systemMetricsHistory.filter(
      m => m.timestamp > cutoffTime
    );

    // Clean up old performance metrics
    this.performanceMetricsHistory = this.performanceMetricsHistory.filter(
      m => m.timestamp > cutoffTime
    );

    // Clean up old resolved alerts
    this.alerts = this.alerts.filter(
      a => !a.resolved || a.timestamp > cutoffTime
    );

    performanceLogger.logDebug('Old metrics cleaned up', {
      operation: 'metrics_cleanup',
      metadata: {
        systemMetricsCount: this.systemMetricsHistory.length,
        performanceMetricsCount: this.performanceMetricsHistory.length,
        alertsCount: this.alerts.length
      }
    });
  }

  // Media processing methods
  public startMediaDownload(mediaId: string, type: string, size: number): void {
    this.activeDownloads.set(mediaId, {
      startTime: Date.now(),
      type,
      size,
      progress: 0
    });

    this.mediaMetrics.totalDownloads++;
    this.mediaMetrics.downloadsByType[type as keyof typeof this.mediaMetrics.downloadsByType]++;
    this.mediaMetrics.concurrentDownloads = this.activeDownloads.size;
    
    // Update average concurrency
    this.concurrencyHistory.push(this.activeDownloads.size);
    if (this.concurrencyHistory.length > 100) {
      this.concurrencyHistory = this.concurrencyHistory.slice(-100);
    }
    this.mediaMetrics.averageConcurrency = this.concurrencyHistory.reduce((a, b) => a + b, 0) / this.concurrencyHistory.length;
  }

  public endMediaDownload(mediaId: string, success: boolean): number {
    const download = this.activeDownloads.get(mediaId);
    if (!download) return 0;

    const duration = Date.now() - download.startTime;
    this.activeDownloads.delete(mediaId);

    if (success) {
      this.mediaMetrics.successfulDownloads++;
      
      // Calculate download speed
      const speed = download.size / (duration / 1000); // bytes per second
      this.downloadSpeeds.push(speed);
      this.downloadTimes.push(duration);

      // Keep only recent measurements
      if (this.downloadSpeeds.length > 100) {
        this.downloadSpeeds = this.downloadSpeeds.slice(-100);
      }
      if (this.downloadTimes.length > 100) {
        this.downloadTimes = this.downloadTimes.slice(-100);
      }

      // Update averages
      this.mediaMetrics.averageDownloadSpeed = this.downloadSpeeds.reduce((a, b) => a + b, 0) / this.downloadSpeeds.length;
      this.mediaMetrics.averageDownloadTime = this.downloadTimes.reduce((a, b) => a + b, 0) / this.downloadTimes.length;
    } else {
      this.mediaMetrics.failedDownloads++;
    }

    return duration;
  }

  public recordMediaProgress(mediaId: string, progress: number): void {
    const download = this.activeDownloads.get(mediaId);
    if (download) {
      download.progress = progress;
    }
  }

  public startTranscription(mediaId: string): void {
    this.activeTranscriptions.set(mediaId, {
      startTime: Date.now()
    });
  }

  public endTranscription(mediaId: string, success: boolean): number {
    const transcription = this.activeTranscriptions.get(mediaId);
    if (!transcription) return 0;

    const duration = Date.now() - transcription.startTime;
    this.activeTranscriptions.delete(mediaId);

    if (success) {
      this.mediaMetrics.transcriptionCount++;
      this.transcriptionTimes.push(duration);

      if (this.transcriptionTimes.length > 100) {
        this.transcriptionTimes = this.transcriptionTimes.slice(-100);
      }

      this.mediaMetrics.averageTranscriptionTime = this.transcriptionTimes.reduce((a, b) => a + b, 0) / this.transcriptionTimes.length;
    }

    return duration;
  }

  public recordMemoryUsage(): void {
    const memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed > this.mediaMetrics.peakMemoryUsage) {
      this.mediaMetrics.peakMemoryUsage = memoryUsage.heapUsed;
    }
  }

  public getMediaMetrics(): MediaMetrics {
    return { ...this.mediaMetrics };
  }

  public getResourceMetrics(): ResourceMetrics {
    return {
      memoryUsage: {
        ...process.memoryUsage(),
        timestamp: new Date()
      },
      cpuUsage: process.cpuUsage()
    };
  }

  // Additional helper methods for the test
  public incrementRetryAttempts(): void {
    this.mediaMetrics.retryAttempts++;
  }

  public incrementCorruptedDownloads(): void {
    this.mediaMetrics.corruptedDownloads++;
  }

  public incrementStreamingDownloads(): void {
    this.mediaMetrics.streamingDownloads++;
  }

  public recordChunkSize(size: number): void {
    // Simple running average for chunk size
    const currentAvg = this.mediaMetrics.averageChunkSize;
    const count = this.mediaMetrics.streamingDownloads || 1;
    this.mediaMetrics.averageChunkSize = (currentAvg * (count - 1) + size) / count;
  }

  public incrementVoiceMessages(): void {
    this.mediaMetrics.voiceMessageCount++;
  }

  public recordDocumentType(mimetype: string): void {
    const extension = this.getExtensionFromMimetype(mimetype);
    this.mediaMetrics.documentTypeDistribution[extension] = (this.mediaMetrics.documentTypeDistribution[extension] || 0) + 1;
  }

  public incrementCircuitBreakerTrips(): void {
    this.mediaMetrics.circuitBreakerTrips++;
  }

  public updateCacheHitRate(hits: number, total: number): void {
    this.mediaMetrics.cacheHitRate = total > 0 ? hits / total : 0;
  }

  private getExtensionFromMimetype(mimetype: string): string {
    const mimetypeMap: Record<string, string> = {
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'text/plain': 'txt',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'video/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg'
    };

    return mimetypeMap[mimetype] || 'unknown';
  }

  // Export metrics for external monitoring
  public exportMetrics(): {
    system: SystemMetrics[];
    performance: PerformanceMetrics[];
    whatsapp: WhatsAppMetrics[];
    alerts: PerformanceAlert[];
    media: MediaMetrics;
  } {
    return {
      system: [...this.systemMetricsHistory],
      performance: [...this.performanceMetricsHistory],
      whatsapp: Array.from(this.whatsappMetrics.values()),
      alerts: [...this.alerts],
      media: { ...this.mediaMetrics }
    };
  }
}

// Create singleton instance
export const performanceMonitor = PerformanceMonitoringService.getInstance();

// Helper function to track operation performance
export function trackOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  context?: LogContext
): Promise<T> {
  const startTime = Date.now();
  
  return fn()
    .then(result => {
      const duration = Date.now() - startTime;
      performanceMonitor.trackPerformanceMetric({
        operation,
        duration,
        success: true,
        timestamp: new Date(),
        context
      });
      return result;
    })
    .catch(error => {
      const duration = Date.now() - startTime;
      performanceMonitor.trackPerformanceMetric({
        operation,
        duration,
        success: false,
        timestamp: new Date(),
        context: {
          ...context,
          error: error.message
        }
      });
      throw error;
    });
}

export default performanceMonitor;