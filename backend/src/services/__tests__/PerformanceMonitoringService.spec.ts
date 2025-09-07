import { PerformanceMonitoringService } from '../PerformanceMonitoringService';

describe('PerformanceMonitoringService', () => {
  let performanceService: PerformanceMonitoringService;
  let mockLogger: jest.Mock;

  beforeEach(() => {
    mockLogger = jest.fn();
    performanceService = new PerformanceMonitoringService(mockLogger);
    jest.clearAllMocks();
  });

  describe('message processing metrics', () => {
    it('should track message processing time', async () => {
      const messageId = 'msg-123';
      
      performanceService.startMessageProcessing(messageId);
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const duration = performanceService.endMessageProcessing(messageId);
      
      expect(duration).toBeGreaterThanOrEqual(100);
      expect(duration).toBeLessThan(200); // Allow some margin
    });

    it('should track message processing throughput', () => {
      const messageIds = ['msg-1', 'msg-2', 'msg-3'];
      
      messageIds.forEach(id => {
        performanceService.startMessageProcessing(id);
        performanceService.endMessageProcessing(id);
      });
      
      const metrics = performanceService.getMessageMetrics();
      
      expect(metrics.totalProcessed).toBe(3);
      expect(metrics.averageProcessingTime).toBeGreaterThan(0);
      expect(metrics.messagesPerSecond).toBeGreaterThan(0);
    });

    it('should track message processing errors', () => {
      const messageId = 'msg-error';
      
      performanceService.startMessageProcessing(messageId);
      performanceService.recordMessageError(messageId, new Error('Processing failed'));
      
      const metrics = performanceService.getMessageMetrics();
      
      expect(metrics.errorCount).toBe(1);
      expect(metrics.errorRate).toBeGreaterThan(0);
    });

    it('should calculate message processing percentiles', () => {
      // Generate various processing times
      const processingTimes = [10, 20, 30, 40, 50, 100, 200, 500, 1000];
      
      processingTimes.forEach((time, index) => {
        const messageId = `msg-${index}`;
        performanceService.startMessageProcessing(messageId);
        
        // Simulate processing time by manually setting end time
        setTimeout(() => {
          performanceService.endMessageProcessing(messageId);
        }, time);
      });
      
      // Wait for all processing to complete
      setTimeout(() => {
        const metrics = performanceService.getMessageMetrics();
        
        expect(metrics.percentiles.p50).toBeDefined();
        expect(metrics.percentiles.p95).toBeDefined();
        expect(metrics.percentiles.p99).toBeDefined();
        expect(metrics.percentiles.p95).toBeGreaterThanOrEqual(metrics.percentiles.p50);
      }, 1100);
    });
  });

  describe('connection metrics', () => {
    it('should track connection establishment time', async () => {
      const sessionId = 'session-123';
      
      performanceService.startConnectionAttempt(sessionId);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const duration = performanceService.endConnectionAttempt(sessionId, true);
      
      expect(duration).toBeGreaterThanOrEqual(50);
      
      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.successfulConnections).toBe(1);
      expect(metrics.averageConnectionTime).toBeGreaterThanOrEqual(50);
    });

    it('should track connection failures', () => {
      const sessionId = 'session-fail';
      
      performanceService.startConnectionAttempt(sessionId);
      performanceService.endConnectionAttempt(sessionId, false);
      
      const metrics = performanceService.getConnectionMetrics();
      
      expect(metrics.failedConnections).toBe(1);
      expect(metrics.connectionSuccessRate).toBe(0);
    });

    it('should track connection stability', () => {
      const sessionId = 'session-stable';
      
      performanceService.recordConnectionEvent(sessionId, 'connected');
      
      // Simulate stable connection for some time
      setTimeout(() => {
        performanceService.recordConnectionEvent(sessionId, 'disconnected');
        
        const metrics = performanceService.getConnectionMetrics();
        expect(metrics.averageConnectionDuration).toBeGreaterThan(0);
      }, 100);
    });

    it('should track reconnection attempts', () => {
      const sessionId = 'session-reconnect';
      
      performanceService.recordReconnectionAttempt(sessionId);
      performanceService.recordReconnectionAttempt(sessionId);
      performanceService.recordReconnectionAttempt(sessionId);
      
      const metrics = performanceService.getConnectionMetrics();
      
      expect(metrics.reconnectionAttempts).toBe(3);
    });
  });

  describe('media processing metrics', () => {
    it('should track media download performance', async () => {
      const mediaId = 'media-123';
      const mediaSize = 1024 * 1024; // 1MB
      
      performanceService.startMediaDownload(mediaId, 'image', mediaSize);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const duration = performanceService.endMediaDownload(mediaId, true);
      
      expect(duration).toBeGreaterThanOrEqual(200);
      
      const metrics = performanceService.getMediaMetrics();
      expect(metrics.totalDownloads).toBe(1);
      expect(metrics.successfulDownloads).toBe(1);
      expect(metrics.averageDownloadSpeed).toBeGreaterThan(0);
    });

    it('should track media download failures', () => {
      const mediaId = 'media-fail';
      
      performanceService.startMediaDownload(mediaId, 'video', 5 * 1024 * 1024);
      performanceService.endMediaDownload(mediaId, false);
      
      const metrics = performanceService.getMediaMetrics();
      
      expect(metrics.failedDownloads).toBe(1);
      expect(metrics.downloadSuccessRate).toBe(0);
    });

    it('should track media processing by type', () => {
      const mediaTypes = ['image', 'video', 'audio', 'document'];
      
      mediaTypes.forEach((type, index) => {
        const mediaId = `media-${type}-${index}`;
        performanceService.startMediaDownload(mediaId, type, 1024);
        performanceService.endMediaDownload(mediaId, true);
      });
      
      const metrics = performanceService.getMediaMetrics();
      
      expect(metrics.downloadsByType.image).toBe(1);
      expect(metrics.downloadsByType.video).toBe(1);
      expect(metrics.downloadsByType.audio).toBe(1);
      expect(metrics.downloadsByType.document).toBe(1);
    });
  });

  describe('memory and resource monitoring', () => {
    it('should track memory usage', () => {
      performanceService.recordMemoryUsage();
      
      const metrics = performanceService.getResourceMetrics();
      
      expect(metrics.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(metrics.memoryUsage.heapTotal).toBeGreaterThan(0);
      expect(metrics.memoryUsage.external).toBeGreaterThanOrEqual(0);
    });

    it('should track CPU usage', () => {
      performanceService.recordCpuUsage();
      
      const metrics = performanceService.getResourceMetrics();
      
      expect(metrics.cpuUsage.user).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuUsage.system).toBeGreaterThanOrEqual(0);
    });

    it('should detect memory leaks', () => {
      // Simulate increasing memory usage
      for (let i = 0; i < 10; i++) {
        performanceService.recordMemoryUsage();
        // Simulate memory increase
        global.gc && global.gc();
      }
      
      const hasLeak = performanceService.detectMemoryLeak();
      
      expect(typeof hasLeak).toBe('boolean');
    });
  });

  describe('cache performance metrics', () => {
    it('should track cache hit rates', () => {
      performanceService.recordCacheHit('messages');
      performanceService.recordCacheHit('messages');
      performanceService.recordCacheMiss('messages');
      
      const metrics = performanceService.getCacheMetrics();
      
      expect(metrics.hitRate).toBeCloseTo(0.67, 2); // 2/3 = 0.67
      expect(metrics.totalHits).toBe(2);
      expect(metrics.totalMisses).toBe(1);
    });

    it('should track cache performance by type', () => {
      performanceService.recordCacheHit('messages');
      performanceService.recordCacheHit('contacts');
      performanceService.recordCacheMiss('groups');
      
      const metrics = performanceService.getCacheMetrics();
      
      expect(metrics.hitsByType.messages).toBe(1);
      expect(metrics.hitsByType.contacts).toBe(1);
      expect(metrics.missByType.groups).toBe(1);
    });

    it('should track cache operation times', async () => {
      const cacheKey = 'test-key';
      
      performanceService.startCacheOperation(cacheKey, 'get');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const duration = performanceService.endCacheOperation(cacheKey);
      
      expect(duration).toBeGreaterThanOrEqual(10);
      
      const metrics = performanceService.getCacheMetrics();
      expect(metrics.averageOperationTime).toBeGreaterThanOrEqual(10);
    });
  });

  describe('alert and threshold monitoring', () => {
    it('should trigger alerts for high error rates', () => {
      const alertCallback = jest.fn();
      performanceService.setAlertCallback(alertCallback);
      
      // Simulate high error rate
      for (let i = 0; i < 10; i++) {
        performanceService.recordMessageError(`msg-${i}`, new Error('Test error'));
      }
      
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HIGH_ERROR_RATE',
          severity: 'critical'
        })
      );
    });

    it('should trigger alerts for slow performance', () => {
      const alertCallback = jest.fn();
      performanceService.setAlertCallback(alertCallback);
      
      // Simulate slow message processing
      const messageId = 'slow-msg';
      performanceService.startMessageProcessing(messageId);
      
      // Manually set a very long processing time
      setTimeout(() => {
        performanceService.endMessageProcessing(messageId);
        
        expect(alertCallback).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'SLOW_PERFORMANCE',
            severity: 'warning'
          })
        );
      }, 5000);
    });

    it('should trigger alerts for memory usage', () => {
      const alertCallback = jest.fn();
      performanceService.setAlertCallback(alertCallback);
      
      // Mock high memory usage
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 1024 * 1024 * 1024, // 1GB
        heapTotal: 512 * 1024 * 1024, // 512MB
        heapUsed: 400 * 1024 * 1024, // 400MB
        external: 50 * 1024 * 1024, // 50MB
        arrayBuffers: 10 * 1024 * 1024 // 10MB
      });
      
      performanceService.recordMemoryUsage();
      
      expect(alertCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HIGH_MEMORY_USAGE',
          severity: 'warning'
        })
      );
    });
  });

  describe('performance reporting', () => {
    it('should generate comprehensive performance report', () => {
      // Generate some test data
      performanceService.startMessageProcessing('msg-1');
      performanceService.endMessageProcessing('msg-1');
      
      performanceService.startConnectionAttempt('session-1');
      performanceService.endConnectionAttempt('session-1', true);
      
      performanceService.recordCacheHit('messages');
      performanceService.recordMemoryUsage();
      
      const report = performanceService.generatePerformanceReport();
      
      expect(report).toHaveProperty('messageMetrics');
      expect(report).toHaveProperty('connectionMetrics');
      expect(report).toHaveProperty('mediaMetrics');
      expect(report).toHaveProperty('cacheMetrics');
      expect(report).toHaveProperty('resourceMetrics');
      expect(report).toHaveProperty('timestamp');
    });

    it('should export metrics in different formats', () => {
      const jsonReport = performanceService.exportMetrics('json');
      const csvReport = performanceService.exportMetrics('csv');
      
      expect(typeof jsonReport).toBe('string');
      expect(typeof csvReport).toBe('string');
      
      // JSON should be parseable
      expect(() => JSON.parse(jsonReport)).not.toThrow();
      
      // CSV should have headers
      expect(csvReport).toContain('metric,value,timestamp');
    });
  });

  describe('cleanup and maintenance', () => {
    it('should clean up old metrics data', () => {
      // Generate old data
      for (let i = 0; i < 100; i++) {
        performanceService.startMessageProcessing(`old-msg-${i}`);
        performanceService.endMessageProcessing(`old-msg-${i}`);
      }
      
      const beforeCleanup = performanceService.getMessageMetrics();
      
      performanceService.cleanupOldMetrics(1); // Keep only 1 hour of data
      
      const afterCleanup = performanceService.getMessageMetrics();
      
      expect(afterCleanup.totalProcessed).toBeLessThanOrEqual(beforeCleanup.totalProcessed);
    });

    it('should reset metrics when requested', () => {
      // Generate some data
      performanceService.startMessageProcessing('msg-reset');
      performanceService.endMessageProcessing('msg-reset');
      
      performanceService.resetMetrics();
      
      const metrics = performanceService.getMessageMetrics();
      
      expect(metrics.totalProcessed).toBe(0);
      expect(metrics.errorCount).toBe(0);
    });
  });
});