import { makeWASocket, DisconnectReason, WAMessage, MessageType } from '@whiskeysockets/baileys';
import { useMultiFileAuthState } from '../../helpers/useMultiFileAuthState';
import { JidLidMapper } from '../../helpers/JidLidMapper';
import { BaileysErrorHandler } from '../../helpers/BaileysErrorHandler';
import { PerformanceMonitoringService } from '../../services/PerformanceMonitoringService';
import cache from '../../libs/cache';
import fs from 'fs/promises';
import path from 'path';

// Mock external dependencies
jest.mock('@whiskeysockets/baileys');
jest.mock('fs/promises');
jest.mock('../../libs/cache');

const mockMakeWASocket = makeWASocket as jest.MockedFunction<typeof makeWASocket>;
const mockFs = fs as jest.Mocked<typeof fs>;
const mockCache = cache as jest.Mocked<typeof cache>;

describe('Message Flow Integration Tests', () => {
  let mockSocket: any;
  let jidMapper: JidLidMapper;
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
      downloadMediaMessage: jest.fn(),
      end: jest.fn(),
      ws: {
        readyState: 1 // WebSocket.OPEN
      },
      user: {
        id: '5511999999999@s.whatsapp.net',
        name: 'Test User'
      }
    };

    mockMakeWASocket.mockReturnValue(mockSocket);

    // Setup mock file system
    mockFs.access.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.readFile.mockResolvedValue(Buffer.from('{}'));
    mockFs.writeFile.mockResolvedValue(undefined);

    // Setup mock cache
    mockCache.get.mockResolvedValue(null);
    mockCache.set.mockResolvedValue('OK');
    mockCache.del.mockResolvedValue(1);

    // Initialize components
    jidMapper = new JidLidMapper();
    errorHandler = new BaileysErrorHandler();
    performanceService = new PerformanceMonitoringService();
    authState = await useMultiFileAuthState('./test-session');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Complete Message Processing Flow', () => {
    it('should handle incoming text message end-to-end', async () => {
      const testMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'test-message-id'
        },
        message: {
          conversation: 'Hello, this is a test message'
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      // Start performance monitoring
      const messageId = testMessage.key.id!;
      performanceService.startMessageProcessing(messageId);

      // Simulate message reception
      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      expect(messageHandler).toBeDefined();

      // Process the message
      await messageHandler({ messages: [testMessage], type: 'notify' });

      // Verify JID mapping
      const normalizedJid = jidMapper.normalizeJid(testMessage.key.remoteJid!);
      expect(normalizedJid).toBe('5511888888888@s.whatsapp.net');

      // Verify cache interaction
      expect(mockCache.get).toHaveBeenCalledWith(
        expect.stringContaining('message:')
      );

      // End performance monitoring
      const processingTime = performanceService.endMessageProcessing(messageId);
      expect(processingTime).toBeGreaterThan(0);

      // Verify metrics
      const metrics = performanceService.getMessageMetrics();
      expect(metrics.totalProcessed).toBe(1);
    });

    it('should handle media message download and processing', async () => {
      const mediaMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'media-message-id'
        },
        message: {
          imageMessage: {
            url: 'https://example.com/image.jpg',
            mimetype: 'image/jpeg',
            fileLength: 1024 * 1024, // 1MB
            caption: 'Test image'
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mockMediaBuffer = Buffer.from('fake-image-data');
      mockSocket.downloadMediaMessage.mockResolvedValue(mockMediaBuffer);

      // Start media processing
      const mediaId = mediaMessage.key.id!;
      performanceService.startMediaDownload(mediaId, 'image', 1024 * 1024);

      // Process media message
      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      await messageHandler({ messages: [mediaMessage], type: 'notify' });

      // Verify media download
      expect(mockSocket.downloadMediaMessage).toHaveBeenCalledWith(
        mediaMessage,
        'buffer'
      );

      // End media processing
      const downloadTime = performanceService.endMediaDownload(mediaId, true);
      expect(downloadTime).toBeGreaterThan(0);

      // Verify media metrics
      const mediaMetrics = performanceService.getMediaMetrics();
      expect(mediaMetrics.totalDownloads).toBe(1);
      expect(mediaMetrics.successfulDownloads).toBe(1);
    });

    it('should handle message processing errors gracefully', async () => {
      const errorMessage: WAMessage = {
        key: {
          remoteJid: 'invalid-jid',
          fromMe: false,
          id: 'error-message-id'
        },
        message: {
          conversation: 'This will cause an error'
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      // Mock JID validation to throw error
      jest.spyOn(jidMapper, 'validateJidFormat').mockReturnValue(false);

      const messageId = errorMessage.key.id!;
      performanceService.startMessageProcessing(messageId);

      // Process the message (should handle error)
      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      await messageHandler({ messages: [errorMessage], type: 'notify' });

      // Verify error was recorded
      performanceService.recordMessageError(messageId, new Error('Invalid JID'));

      const metrics = performanceService.getMessageMetrics();
      expect(metrics.errorCount).toBe(1);
      expect(metrics.errorRate).toBeGreaterThan(0);
    });

    it('should handle group message processing with optimizations', async () => {
      const groupMessage: WAMessage = {
        key: {
          remoteJid: '120363025246125244@g.us',
          fromMe: false,
          id: 'group-message-id',
          participant: '5511888888888@s.whatsapp.net'
        },
        message: {
          conversation: 'Group message test'
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const messageId = groupMessage.key.id!;
      performanceService.startMessageProcessing(messageId);

      // Process group message
      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      await messageHandler({ messages: [groupMessage], type: 'notify' });

      // Verify group JID handling
      const normalizedGroupJid = jidMapper.normalizeJid(groupMessage.key.remoteJid!);
      expect(normalizedGroupJid).toBe('120363025246125244@g.us');

      // Verify participant JID handling
      const normalizedParticipantJid = jidMapper.normalizeJid(groupMessage.key.participant!);
      expect(normalizedParticipantJid).toBe('5511888888888@s.whatsapp.net');

      performanceService.endMessageProcessing(messageId);

      const metrics = performanceService.getMessageMetrics();
      expect(metrics.totalProcessed).toBe(1);
    });

    it('should handle interactive message processing', async () => {
      const interactiveMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'interactive-message-id'
        },
        message: {
          buttonsMessage: {
            contentText: 'Choose an option:',
            buttons: [
              {
                buttonId: 'btn1',
                buttonText: { displayText: 'Option 1' },
                type: 1
              },
              {
                buttonId: 'btn2',
                buttonText: { displayText: 'Option 2' },
                type: 1
              }
            ]
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const messageId = interactiveMessage.key.id!;
      performanceService.startMessageProcessing(messageId);

      // Process interactive message
      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      await messageHandler({ messages: [interactiveMessage], type: 'notify' });

      // Verify interactive message handling
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('interactive:'),
        expect.any(String)
      );

      performanceService.endMessageProcessing(messageId);

      const metrics = performanceService.getMessageMetrics();
      expect(metrics.totalProcessed).toBe(1);
    });
  });

  describe('Message Flow with Cache Integration', () => {
    it('should use cache for duplicate message detection', async () => {
      const duplicateMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'duplicate-message-id'
        },
        message: {
          conversation: 'Duplicate message test'
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      // First message processing
      mockCache.get.mockResolvedValueOnce(null); // Not in cache
      mockCache.set.mockResolvedValueOnce('OK');

      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      await messageHandler({ messages: [duplicateMessage], type: 'notify' });

      // Second message processing (duplicate)
      mockCache.get.mockResolvedValueOnce('processed'); // Found in cache

      await messageHandler({ messages: [duplicateMessage], type: 'notify' });

      // Verify cache was checked
      expect(mockCache.get).toHaveBeenCalledTimes(2);
      expect(mockCache.set).toHaveBeenCalledTimes(1); // Only set once
    });

    it('should cache message processing results', async () => {
      const message: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'cache-test-message'
        },
        message: {
          conversation: 'Cache test message'
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      mockCache.get.mockResolvedValueOnce(null);
      mockCache.set.mockResolvedValueOnce('OK');

      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      await messageHandler({ messages: [message], type: 'notify' });

      // Verify message was cached
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('message:'),
        expect.any(String),
        'EX',
        expect.any(Number)
      );
    });
  });

  describe('Error Recovery in Message Flow', () => {
    it('should recover from temporary processing errors', async () => {
      const message: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'recovery-test-message'
        },
        message: {
          conversation: 'Recovery test message'
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      // First attempt fails
      mockCache.get.mockRejectedValueOnce(new Error('Cache connection failed'));
      
      // Second attempt succeeds
      mockCache.get.mockResolvedValueOnce(null);
      mockCache.set.mockResolvedValueOnce('OK');

      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      // Should not throw error, but handle gracefully
      await expect(messageHandler({ messages: [message], type: 'notify' })).resolves.not.toThrow();

      // Verify error was logged
      const errorMetrics = errorHandler.getErrorMetrics();
      expect(errorMetrics.totalErrors).toBeGreaterThan(0);
    });

    it('should handle media download failures with retry', async () => {
      const mediaMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'media-retry-test'
        },
        message: {
          imageMessage: {
            url: 'https://example.com/image.jpg',
            mimetype: 'image/jpeg',
            fileLength: 1024 * 1024
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      // First download attempt fails
      mockSocket.downloadMediaMessage.mockRejectedValueOnce(new Error('Download failed'));
      
      // Second attempt succeeds
      mockSocket.downloadMediaMessage.mockResolvedValueOnce(Buffer.from('image-data'));

      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      await messageHandler({ messages: [mediaMessage], type: 'notify' });

      // Verify retry was attempted
      expect(mockSocket.downloadMediaMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance Monitoring Integration', () => {
    it('should track end-to-end message processing performance', async () => {
      const messages: WAMessage[] = Array.from({ length: 10 }, (_, i) => ({
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: `perf-test-${i}`
        },
        message: {
          conversation: `Performance test message ${i}`
        },
        messageTimestamp: Date.now(),
        status: 1
      }));

      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      // Process all messages
      for (const message of messages) {
        const messageId = message.key.id!;
        performanceService.startMessageProcessing(messageId);
        
        await messageHandler({ messages: [message], type: 'notify' });
        
        performanceService.endMessageProcessing(messageId);
      }

      // Verify performance metrics
      const metrics = performanceService.getMessageMetrics();
      expect(metrics.totalProcessed).toBe(10);
      expect(metrics.averageProcessingTime).toBeGreaterThan(0);
      expect(metrics.messagesPerSecond).toBeGreaterThan(0);
    });

    it('should generate comprehensive performance report', async () => {
      // Generate various types of activity
      const textMessage: WAMessage = {
        key: { remoteJid: '5511888888888@s.whatsapp.net', fromMe: false, id: 'text-1' },
        message: { conversation: 'Text message' },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mediaMessage: WAMessage = {
        key: { remoteJid: '5511888888888@s.whatsapp.net', fromMe: false, id: 'media-1' },
        message: { imageMessage: { url: 'test.jpg', mimetype: 'image/jpeg', fileLength: 1024 } },
        messageTimestamp: Date.now(),
        status: 1
      };

      mockSocket.downloadMediaMessage.mockResolvedValue(Buffer.from('image-data'));

      const messageHandler = mockSocket.ev.on.mock.calls.find(
        call => call[0] === 'messages.upsert'
      )?.[1];

      // Process different message types
      await messageHandler({ messages: [textMessage], type: 'notify' });
      await messageHandler({ messages: [mediaMessage], type: 'notify' });

      // Generate performance report
      const report = performanceService.generatePerformanceReport();

      expect(report).toHaveProperty('messageMetrics');
      expect(report).toHaveProperty('mediaMetrics');
      expect(report).toHaveProperty('cacheMetrics');
      expect(report).toHaveProperty('timestamp');
      expect(report.messageMetrics.totalProcessed).toBeGreaterThan(0);
    });
  });
});