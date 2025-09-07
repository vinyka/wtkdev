import { makeWASocket, DisconnectReason, ConnectionState } from '@whiskeysockets/baileys';
import { useMultiFileAuthState } from '../../helpers/useMultiFileAuthState';
import { BaileysErrorHandler } from '../../helpers/BaileysErrorHandler';
import { PerformanceMonitoringService } from '../../services/PerformanceMonitoringService';
import fs from 'fs/promises';

// Mock external dependencies
jest.mock('@whiskeysockets/baileys');
jest.mock('fs/promises');

const mockMakeWASocket = makeWASocket as jest.MockedFunction<typeof makeWASocket>;
const mockFs = fs as jest.Mocked<typeof fs>;

describe('Connection Stability Integration Tests', () => {
  let mockSocket: any;
  let errorHandler: BaileysErrorHandler;
  let performanceService: PerformanceMonitoringService;
  let authState: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup mock socket
    mockSocket = {
      ev: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        removeAllListeners: jest.fn()
      },
      sendMessage: jest.fn(),
      end: jest.fn(),
      ws: {
        readyState: 1, // WebSocket.OPEN
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      },
      user: {
        id: '5511999999999@s.whatsapp.net',
        name: 'Test User'
      },
      authState: {
        creds: {},
        keys: {
          get: jest.fn(),
          set: jest.fn()
        }
      }
    };

    mockMakeWASocket.mockReturnValue(mockSocket);

    // Setup mock file system
    mockFs.access.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.readFile.mockResolvedValue(Buffer.from('{}'));
    mockFs.writeFile.mockResolvedValue(undefined);

    // Initialize components
    errorHandler = new BaileysErrorHandler();
    performanceService = new PerformanceMonitoringService();
    authState = await useMultiFileAuthState('./test-session');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Connection Establishment and Maintenance', () => {
    it('should establish connection successfully', async () => {
      const sessionId = 'test-session-1';
      performanceService.startConnectionAttempt(sessionId);

      // Simulate successful connection
      const connectionHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'connection.update'
      )?.[1];

      expect(connectionHandler).toBeDefined();

      // Simulate connection states
      await connectionHandler({ connection: 'connecting' });
      await connectionHandler({ connection: 'open' });

      const connectionTime = performanceService.endConnectionAttempt(sessionId, true);
      expect(connectionTime).toBeGreaterThan(0);

      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.successfulConnections).toBe(1);
      expect(metrics.connectionSuccessRate).toBe(1);
    });

    it('should handle connection failures gracefully', async () => {
      const sessionId = 'test-session-fail';
      performanceService.startConnectionAttempt(sessionId);

      const connectionHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'connection.update'
      )?.[1];

      // Simulate connection failure
      await connectionHandler({ 
        connection: 'close',
        lastDisconnect: {
          error: new Error('Connection failed'),
          output: {
            statusCode: DisconnectReason.connectionLost
          }
        }
      });

      performanceService.endConnectionAttempt(sessionId, false);

      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.failedConnections).toBe(1);
      expect(metrics.connectionSuccessRate).toBe(0);
    });

    it('should maintain stable connection over time', async () => {
      const sessionId = 'stable-session';
      
      const connectionHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'connection.update'
      )?.[1];

      // Establish connection
      performanceService.recordConnectionEvent(sessionId, 'connected');
      await connectionHandler({ connection: 'open' });

      // Simulate stable connection for extended period
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check connection is still stable
      expect(mockSocket.ws.readyState).toBe(1); // Still open

      performanceService.recordConnectionEvent(sessionId, 'disconnected');

      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.averageConnectionDuration).toBeGreaterThan(1000);
    });
  });

  describe('Reconnection Logic', () => {
    it('should automatically reconnect after connection loss', async () => {
      const sessionId = 'reconnect-session';
      let reconnectAttempts = 0;

      // Mock socket creation for reconnection
      mockMakeWASocket.mockImplementation(() => {
        reconnectAttempts++;
        return mockSocket;
      });

      const connectionHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'connection.update'
      )?.[1];

      // Simulate initial connection
      await connectionHandler({ connection: 'open' });

      // Simulate connection loss
      await connectionHandler({
        connection: 'close',
        lastDisconnect: {
          error: new Error('Connection lost'),
          output: {
            statusCode: DisconnectReason.connectionLost
          }
        }
      });

      // Record reconnection attempt
      performanceService.recordReconnectionAttempt(sessionId);

      // Simulate successful reconnection
      await connectionHandler({ connection: 'open' });

      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.reconnectionAttempts).toBe(1);
      expect(reconnectAttempts).toBeGreaterThan(1);
    });

    it('should implement exponential backoff for reconnection', async () => {
      const sessionId = 'backoff-session';
      const reconnectionTimes: number[] = [];

      for (let attempt = 1; attempt <= 5; attempt++) {
        const backoffTime = errorHandler.calculateBackoff(attempt);
        reconnectionTimes.push(backoffTime);
        
        performanceService.recordReconnectionAttempt(sessionId);
      }

      // Verify exponential backoff
      expect(reconnectionTimes[1]).toBeGreaterThan(reconnectionTimes[0]);
      expect(reconnectionTimes[2]).toBeGreaterThan(reconnectionTimes[1]);
      expect(reconnectionTimes[3]).toBeGreaterThan(reconnectionTimes[2]);
      expect(reconnectionTimes[4]).toBeGreaterThan(reconnectionTimes[3]);

      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.reconnectionAttempts).toBe(5);
    });

    it('should stop reconnection after max attempts', async () => {
      const sessionId = 'max-attempts-session';
      
      // Simulate multiple failed reconnection attempts
      for (let i = 0; i < 15; i++) {
        const shouldRetry = errorHandler.shouldRetry('CONNECTION_ERROR', i + 1);
        
        if (shouldRetry) {
          performanceService.recordReconnectionAttempt(sessionId);
        } else {
          break;
        }
      }

      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.reconnectionAttempts).toBeLessThan(15); // Should stop before 15
    });
  });

  describe('Authentication State Management', () => {
    it('should handle authentication state changes', async () => {
      const connectionHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'connection.update'
      )?.[1];

      // Simulate authentication flow
      await connectionHandler({ connection: 'connecting' });
      await connectionHandler({ 
        connection: 'open',
        isNewLogin: true
      });

      // Verify authentication state was saved
      expect(authState.saveCreds).toBeDefined();
    });

    it('should clear authentication on logout', async () => {
      const connectionHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'connection.update'
      )?.[1];

      // Simulate logout
      await connectionHandler({
        connection: 'close',
        lastDisconnect: {
          error: new Error('Logged out'),
          output: {
            statusCode: DisconnectReason.loggedOut
          }
        }
      });

      const disconnectResult = errorHandler.handleDisconnectReason(DisconnectReason.loggedOut);
      expect(disconnectResult.shouldClearSession).toBe(true);
    });

    it('should handle bad session gracefully', async () => {
      const connectionHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'connection.update'
      )?.[1];

      // Simulate bad session
      await connectionHandler({
        connection: 'close',
        lastDisconnect: {
          error: new Error('Bad session'),
          output: {
            statusCode: DisconnectReason.badSession
          }
        }
      });

      const disconnectResult = errorHandler.handleDisconnectReason(DisconnectReason.badSession);
      expect(disconnectResult.shouldClearSession).toBe(true);
      expect(disconnectResult.shouldReconnect).toBe(false);
    });
  });

  describe('Connection Health Monitoring', () => {
    it('should monitor connection health continuously', async () => {
      const sessionId = 'health-monitor-session';
      
      // Start health monitoring
      const healthCheckInterval = setInterval(() => {
        const isHealthy = mockSocket.ws.readyState === 1;
        
        if (isHealthy) {
          performanceService.recordConnectionEvent(sessionId, 'healthy');
        } else {
          performanceService.recordConnectionEvent(sessionId, 'unhealthy');
        }
      }, 100);

      // Let it run for a short time
      await new Promise(resolve => setTimeout(resolve, 500));
      
      clearInterval(healthCheckInterval);

      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.healthChecks).toBeGreaterThan(0);
    });

    it('should detect connection degradation', async () => {
      const sessionId = 'degradation-session';
      
      // Simulate connection degradation
      mockSocket.ws.readyState = 2; // WebSocket.CLOSING
      
      performanceService.recordConnectionEvent(sessionId, 'degraded');
      
      const connectionHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'connection.update'
      )?.[1];

      await connectionHandler({
        connection: 'close',
        lastDisconnect: {
          error: new Error('Connection degraded'),
          output: {
            statusCode: DisconnectReason.connectionLost
          }
        }
      });

      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.connectionDegradations).toBeGreaterThan(0);
    });

    it('should track connection quality metrics', async () => {
      const sessionId = 'quality-session';
      
      // Simulate various connection quality events
      const qualityEvents = [
        { type: 'latency', value: 50 },
        { type: 'latency', value: 100 },
        { type: 'latency', value: 200 },
        { type: 'packet_loss', value: 0.01 },
        { type: 'throughput', value: 1024 * 1024 } // 1MB/s
      ];

      qualityEvents.forEach(event => {
        performanceService.recordConnectionQuality(sessionId, event.type, event.value);
      });

      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.averageLatency).toBeGreaterThan(0);
      expect(metrics.packetLossRate).toBeGreaterThanOrEqual(0);
      expect(metrics.averageThroughput).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery and Circuit Breaker', () => {
    it('should implement circuit breaker for connection failures', async () => {
      const sessionId = 'circuit-breaker-session';
      
      // Simulate multiple consecutive connection failures
      for (let i = 0; i < 6; i++) {
        const error = new Error(`Connection failure ${i + 1}`);
        error.name = 'ConnectionError';
        
        errorHandler.logError(error, { sessionId });
        performanceService.recordReconnectionAttempt(sessionId);
      }

      // Check if circuit breaker is open
      const isOpen = errorHandler.isCircuitBreakerOpen('CONNECTION_ERROR');
      expect(isOpen).toBe(true);

      // Should not attempt more connections while circuit is open
      const shouldRetry = errorHandler.shouldRetry('CONNECTION_ERROR', 7);
      expect(shouldRetry).toBe(false);
    });

    it('should reset circuit breaker after successful connection', async () => {
      const sessionId = 'circuit-reset-session';
      
      // Open circuit breaker
      for (let i = 0; i < 6; i++) {
        const error = new Error(`Connection failure ${i + 1}`);
        error.name = 'ConnectionError';
        errorHandler.logError(error, { sessionId });
      }

      expect(errorHandler.isCircuitBreakerOpen('CONNECTION_ERROR')).toBe(true);

      // Simulate successful connection
      errorHandler.recordSuccess('CONNECTION_ERROR');
      
      expect(errorHandler.isCircuitBreakerOpen('CONNECTION_ERROR')).toBe(false);
    });
  });

  describe('Long-term Connection Stability', () => {
    it('should maintain connection over extended periods', async () => {
      const sessionId = 'long-term-session';
      
      performanceService.recordConnectionEvent(sessionId, 'connected');
      
      // Simulate long-running connection with periodic health checks
      const healthChecks = [];
      
      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const isHealthy = Math.random() > 0.05; // 95% healthy
        healthChecks.push(isHealthy);
        
        if (isHealthy) {
          performanceService.recordConnectionEvent(sessionId, 'healthy');
        } else {
          performanceService.recordConnectionEvent(sessionId, 'unhealthy');
        }
      }
      
      performanceService.recordConnectionEvent(sessionId, 'disconnected');
      
      const healthyChecks = healthChecks.filter(check => check).length;
      const healthRate = healthyChecks / healthChecks.length;
      
      expect(healthRate).toBeGreaterThan(0.9); // Should be mostly healthy
      
      const metrics = performanceService.getConnectionMetrics();
      expect(metrics.averageConnectionDuration).toBeGreaterThan(1000);
    });

    it('should handle memory leaks in long-running connections', async () => {
      const sessionId = 'memory-leak-session';
      
      // Simulate long-running connection
      performanceService.recordConnectionEvent(sessionId, 'connected');
      
      // Monitor memory usage over time
      const memoryReadings = [];
      
      for (let i = 0; i < 50; i++) {
        performanceService.recordMemoryUsage();
        
        const metrics = performanceService.getResourceMetrics();
        memoryReadings.push(metrics.memoryUsage.heapUsed);
        
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      
      // Check for memory leak detection
      const hasLeak = performanceService.detectMemoryLeak();
      
      // Memory should be relatively stable (no significant upward trend)
      const firstHalf = memoryReadings.slice(0, 25);
      const secondHalf = memoryReadings.slice(25);
      
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      
      // Memory increase should be reasonable (less than 50% growth)
      const memoryGrowth = (secondAvg - firstAvg) / firstAvg;
      expect(memoryGrowth).toBeLessThan(0.5);
    });
  });

  describe('Connection Performance Optimization', () => {
    it('should optimize connection parameters based on performance', async () => {
      const sessionId = 'optimization-session';
      
      // Simulate various connection scenarios
      const scenarios = [
        { latency: 50, success: true },
        { latency: 100, success: true },
        { latency: 500, success: false },
        { latency: 200, success: true },
        { latency: 1000, success: false }
      ];
      
      scenarios.forEach((scenario, index) => {
        performanceService.recordConnectionQuality(sessionId, 'latency', scenario.latency);
        
        if (scenario.success) {
          performanceService.endConnectionAttempt(`${sessionId}-${index}`, true);
        } else {
          performanceService.endConnectionAttempt(`${sessionId}-${index}`, false);
        }
      });
      
      const metrics = performanceService.getConnectionMetrics();
      
      // Should have reasonable success rate
      expect(metrics.connectionSuccessRate).toBeGreaterThan(0.5);
      
      // Should track latency properly
      expect(metrics.averageLatency).toBeGreaterThan(0);
      expect(metrics.averageLatency).toBeLessThan(1000);
    });
  });
});