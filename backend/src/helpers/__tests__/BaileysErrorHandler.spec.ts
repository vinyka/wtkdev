import { BaileysErrorHandler, BaileysErrorType } from '../BaileysErrorHandler';
import { DisconnectReason } from '@whiskeysockets/baileys';

describe('BaileysErrorHandler', () => {
  let errorHandler: BaileysErrorHandler;
  let mockLogger: jest.Mock;

  beforeEach(() => {
    mockLogger = jest.fn();
    errorHandler = new BaileysErrorHandler(mockLogger);
  });

  describe('error classification', () => {
    it('should classify connection errors correctly', () => {
      const connectionError = new Error('Connection failed');
      connectionError.name = 'ConnectionError';
      
      const classification = errorHandler.classifyError(connectionError);
      
      expect(classification.type).toBe(BaileysErrorType.CONNECTION_ERROR);
      expect(classification.severity).toBe('high');
      expect(classification.retryable).toBe(true);
    });

    it('should classify authentication errors correctly', () => {
      const authError = new Error('Authentication failed');
      authError.name = 'AuthenticationError';
      
      const classification = errorHandler.classifyError(authError);
      
      expect(classification.type).toBe(BaileysErrorType.AUTHENTICATION_ERROR);
      expect(classification.severity).toBe('critical');
      expect(classification.retryable).toBe(false);
    });

    it('should classify message processing errors correctly', () => {
      const messageError = new Error('Failed to process message');
      messageError.name = 'MessageProcessingError';
      
      const classification = errorHandler.classifyError(messageError);
      
      expect(classification.type).toBe(BaileysErrorType.MESSAGE_PROCESSING_ERROR);
      expect(classification.severity).toBe('medium');
      expect(classification.retryable).toBe(true);
    });

    it('should classify media download errors correctly', () => {
      const mediaError = new Error('Media download failed');
      mediaError.name = 'MediaDownloadError';
      
      const classification = errorHandler.classifyError(mediaError);
      
      expect(classification.type).toBe(BaileysErrorType.MEDIA_DOWNLOAD_ERROR);
      expect(classification.severity).toBe('medium');
      expect(classification.retryable).toBe(true);
    });

    it('should classify unknown errors as generic', () => {
      const unknownError = new Error('Unknown error');
      
      const classification = errorHandler.classifyError(unknownError);
      
      expect(classification.type).toBe(BaileysErrorType.UNKNOWN_ERROR);
      expect(classification.severity).toBe('medium');
      expect(classification.retryable).toBe(false);
    });
  });

  describe('disconnect reason handling', () => {
    it('should handle bad session disconnect reason', () => {
      const result = errorHandler.handleDisconnectReason(DisconnectReason.badSession);
      
      expect(result.shouldReconnect).toBe(false);
      expect(result.shouldClearSession).toBe(true);
      expect(result.errorType).toBe(BaileysErrorType.AUTHENTICATION_ERROR);
    });

    it('should handle connection closed disconnect reason', () => {
      const result = errorHandler.handleDisconnectReason(DisconnectReason.connectionClosed);
      
      expect(result.shouldReconnect).toBe(true);
      expect(result.shouldClearSession).toBe(false);
      expect(result.errorType).toBe(BaileysErrorType.CONNECTION_ERROR);
    });

    it('should handle connection lost disconnect reason', () => {
      const result = errorHandler.handleDisconnectReason(DisconnectReason.connectionLost);
      
      expect(result.shouldReconnect).toBe(true);
      expect(result.shouldClearSession).toBe(false);
      expect(result.errorType).toBe(BaileysErrorType.CONNECTION_ERROR);
    });

    it('should handle logged out disconnect reason', () => {
      const result = errorHandler.handleDisconnectReason(DisconnectReason.loggedOut);
      
      expect(result.shouldReconnect).toBe(false);
      expect(result.shouldClearSession).toBe(true);
      expect(result.errorType).toBe(BaileysErrorType.AUTHENTICATION_ERROR);
    });

    it('should handle restart required disconnect reason', () => {
      const result = errorHandler.handleDisconnectReason(DisconnectReason.restartRequired);
      
      expect(result.shouldReconnect).toBe(true);
      expect(result.shouldClearSession).toBe(false);
      expect(result.errorType).toBe(BaileysErrorType.CONNECTION_ERROR);
    });
  });

  describe('retry mechanism', () => {
    it('should calculate exponential backoff correctly', () => {
      const backoff1 = errorHandler.calculateBackoff(1);
      const backoff2 = errorHandler.calculateBackoff(2);
      const backoff3 = errorHandler.calculateBackoff(3);
      
      expect(backoff2).toBeGreaterThan(backoff1);
      expect(backoff3).toBeGreaterThan(backoff2);
      expect(backoff1).toBeGreaterThanOrEqual(1000); // At least 1 second
      expect(backoff3).toBeLessThanOrEqual(30000); // Max 30 seconds
    });

    it('should respect maximum retry attempts', () => {
      const canRetry1 = errorHandler.shouldRetry(BaileysErrorType.CONNECTION_ERROR, 1);
      const canRetry5 = errorHandler.shouldRetry(BaileysErrorType.CONNECTION_ERROR, 5);
      const canRetry10 = errorHandler.shouldRetry(BaileysErrorType.CONNECTION_ERROR, 10);
      
      expect(canRetry1).toBe(true);
      expect(canRetry5).toBe(true);
      expect(canRetry10).toBe(false); // Should exceed max attempts
    });

    it('should not retry non-retryable errors', () => {
      const canRetry = errorHandler.shouldRetry(BaileysErrorType.AUTHENTICATION_ERROR, 1);
      
      expect(canRetry).toBe(false);
    });

    it('should implement jitter in backoff calculation', () => {
      const backoffs = Array.from({ length: 10 }, () => 
        errorHandler.calculateBackoff(3)
      );
      
      // Should have some variation due to jitter
      const uniqueValues = new Set(backoffs);
      expect(uniqueValues.size).toBeGreaterThan(1);
    });
  });

  describe('error recovery strategies', () => {
    it('should provide recovery strategy for connection errors', () => {
      const strategy = errorHandler.getRecoveryStrategy(BaileysErrorType.CONNECTION_ERROR);
      
      expect(strategy.actions).toContain('reconnect');
      expect(strategy.clearSession).toBe(false);
      expect(strategy.restartRequired).toBe(false);
    });

    it('should provide recovery strategy for authentication errors', () => {
      const strategy = errorHandler.getRecoveryStrategy(BaileysErrorType.AUTHENTICATION_ERROR);
      
      expect(strategy.actions).toContain('clearSession');
      expect(strategy.actions).toContain('reauth');
      expect(strategy.clearSession).toBe(true);
    });

    it('should provide recovery strategy for message processing errors', () => {
      const strategy = errorHandler.getRecoveryStrategy(BaileysErrorType.MESSAGE_PROCESSING_ERROR);
      
      expect(strategy.actions).toContain('retry');
      expect(strategy.actions).toContain('skipMessage');
      expect(strategy.clearSession).toBe(false);
    });

    it('should provide recovery strategy for media download errors', () => {
      const strategy = errorHandler.getRecoveryStrategy(BaileysErrorType.MEDIA_DOWNLOAD_ERROR);
      
      expect(strategy.actions).toContain('retryDownload');
      expect(strategy.actions).toContain('fallbackMethod');
      expect(strategy.clearSession).toBe(false);
    });
  });

  describe('error logging and context', () => {
    it('should log errors with proper context', () => {
      const error = new Error('Test error');
      const context = { sessionId: 'test-session', messageId: 'msg-123' };
      
      errorHandler.logError(error, context);
      
      expect(mockLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'Test error',
          context: context,
          classification: expect.any(Object),
          timestamp: expect.any(String)
        })
      );
    });

    it('should include stack trace in error logs', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      
      errorHandler.logError(error);
      
      expect(mockLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: error.stack
        })
      );
    });

    it('should sanitize sensitive information from logs', () => {
      const error = new Error('Auth failed with token abc123');
      const context = { 
        authToken: 'secret-token',
        phoneNumber: '+5511999999999',
        publicData: 'safe-data'
      };
      
      errorHandler.logError(error, context);
      
      const logCall = mockLogger.mock.calls[0][0];
      expect(logCall.context.authToken).toBe('[REDACTED]');
      expect(logCall.context.phoneNumber).toBe('[REDACTED]');
      expect(logCall.context.publicData).toBe('safe-data');
    });
  });

  describe('error metrics and monitoring', () => {
    it('should track error counts by type', () => {
      const connectionError = new Error('Connection failed');
      connectionError.name = 'ConnectionError';
      
      errorHandler.logError(connectionError);
      errorHandler.logError(connectionError);
      
      const metrics = errorHandler.getErrorMetrics();
      
      expect(metrics.errorCounts[BaileysErrorType.CONNECTION_ERROR]).toBe(2);
    });

    it('should track error rates over time', () => {
      const error = new Error('Test error');
      
      errorHandler.logError(error);
      
      const metrics = errorHandler.getErrorMetrics();
      
      expect(metrics.totalErrors).toBe(1);
      expect(metrics.errorRate).toBeGreaterThan(0);
    });

    it('should provide error statistics', () => {
      const connectionError = new Error('Connection failed');
      connectionError.name = 'ConnectionError';
      
      const authError = new Error('Auth failed');
      authError.name = 'AuthenticationError';
      
      errorHandler.logError(connectionError);
      errorHandler.logError(authError);
      
      const stats = errorHandler.getErrorStatistics();
      
      expect(stats.mostCommonError).toBeDefined();
      expect(stats.errorDistribution).toBeDefined();
      expect(stats.averageErrorsPerHour).toBeGreaterThanOrEqual(0);
    });
  });

  describe('circuit breaker functionality', () => {
    it('should open circuit breaker after consecutive failures', () => {
      const error = new Error('Connection failed');
      error.name = 'ConnectionError';
      
      // Simulate multiple consecutive failures
      for (let i = 0; i < 6; i++) {
        errorHandler.logError(error);
      }
      
      const isOpen = errorHandler.isCircuitBreakerOpen(BaileysErrorType.CONNECTION_ERROR);
      expect(isOpen).toBe(true);
    });

    it('should reset circuit breaker after successful operation', () => {
      const error = new Error('Connection failed');
      error.name = 'ConnectionError';
      
      // Cause circuit breaker to open
      for (let i = 0; i < 6; i++) {
        errorHandler.logError(error);
      }
      
      // Reset after success
      errorHandler.recordSuccess(BaileysErrorType.CONNECTION_ERROR);
      
      const isOpen = errorHandler.isCircuitBreakerOpen(BaileysErrorType.CONNECTION_ERROR);
      expect(isOpen).toBe(false);
    });
  });
});