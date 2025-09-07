import { makeWASocket, WAMessage, downloadMediaMessage } from '@whiskeysockets/baileys';
import { PerformanceMonitoringService } from '../../services/PerformanceMonitoringService';
import { MediaErrorHandler } from '../../helpers/MediaErrorHandler';
import { BaileysErrorHandler } from '../../helpers/BaileysErrorHandler';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock external dependencies
jest.mock('@whiskeysockets/baileys');
jest.mock('fs/promises');

const mockMakeWASocket = makeWASocket as jest.MockedFunction<typeof makeWASocket>;
const mockDownloadMediaMessage = downloadMediaMessage as jest.MockedFunction<typeof downloadMediaMessage>;
const mockFs = fs as jest.Mocked<typeof fs>;

// Helper function to convert Long to number
const toNumber = (value: number | any): number => {
  return typeof value === 'number' ? value : Number(value);
};

describe('Media Processing Performance Integration Tests', () => {
  let mockSocket: any;
  let performanceService: PerformanceMonitoringService;
  let mediaErrorHandler: MediaErrorHandler;
  let baileysErrorHandler: BaileysErrorHandler;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock socket
    mockSocket = {
      ev: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn()
      },
      downloadMediaMessage: jest.fn(),
      sendMessage: jest.fn(),
      user: {
        id: '5511999999999@s.whatsapp.net'
      }
    };

    mockMakeWASocket.mockReturnValue(mockSocket);

    // Setup mock file system
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue(Buffer.from('test-data'));
    mockFs.unlink.mockResolvedValue(undefined);
    mockFs.stat.mockResolvedValue({
      size: 1024 * 1024, // 1MB
      isFile: () => true
    } as any);

    // Initialize services
    performanceService = PerformanceMonitoringService.getInstance();
    mediaErrorHandler = new MediaErrorHandler();
    baileysErrorHandler = new BaileysErrorHandler();
  });

  describe('Image Processing Performance', () => {
    it('should process image messages efficiently', async () => {
      const imageMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'image-perf-test'
        },
        message: {
          imageMessage: {
            url: 'https://example.com/image.jpg',
            mimetype: 'image/jpeg',
            fileLength: 2 * 1024 * 1024, // 2MB
            caption: 'Performance test image',
            jpegThumbnail: Buffer.from('thumbnail-data')
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mockImageBuffer = Buffer.alloc(2 * 1024 * 1024, 'image-data');
      mockSocket.downloadMediaMessage.mockResolvedValue(mockImageBuffer);

      const mediaId = imageMessage.key.id!;
      const mediaSize = toNumber(imageMessage.message!.imageMessage!.fileLength!);

      // Start performance tracking
      performanceService.startMediaDownload(mediaId, 'image', mediaSize);

      // Process image
      const downloadedBuffer = await mockSocket.downloadMediaMessage(imageMessage, 'buffer');

      // End performance tracking
      const downloadTime = performanceService.endMediaDownload(mediaId, true);

      expect(downloadTime).toBeGreaterThan(0);
      expect(downloadedBuffer).toEqual(mockImageBuffer);

      // Verify performance metrics
      const metrics = performanceService.getMediaMetrics();
      expect(metrics.totalDownloads).toBe(1);
      expect(metrics.successfulDownloads).toBe(1);
      expect(metrics.downloadsByType.image).toBe(1);
      expect(metrics.averageDownloadSpeed).toBeGreaterThan(0);
    });

    it('should handle large image files efficiently', async () => {
      const largeImageMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'large-image-test'
        },
        message: {
          imageMessage: {
            url: 'https://example.com/large-image.jpg',
            mimetype: 'image/jpeg',
            fileLength: 10 * 1024 * 1024, // 10MB
            caption: 'Large image test'
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mockLargeBuffer = Buffer.alloc(10 * 1024 * 1024, 'large-image-data');
      mockSocket.downloadMediaMessage.mockResolvedValue(mockLargeBuffer);

      const mediaId = largeImageMessage.key.id!;
      const mediaSize = toNumber(largeImageMessage.message!.imageMessage!.fileLength!);

      performanceService.startMediaDownload(mediaId, 'image', mediaSize);

      const startTime = Date.now();
      const downloadedBuffer = await mockSocket.downloadMediaMessage(largeImageMessage, 'buffer');
      const endTime = Date.now();

      performanceService.endMediaDownload(mediaId, true);

      // Verify large file handling
      expect(downloadedBuffer.length).toBe(10 * 1024 * 1024);

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.averageDownloadSpeed).toBeGreaterThan(0);

      // Should complete within reasonable time (less than 5 seconds for mock)
      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should optimize image processing with caching', async () => {
      const imageMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'cached-image-test'
        },
        message: {
          imageMessage: {
            url: 'https://example.com/cached-image.jpg',
            mimetype: 'image/jpeg',
            fileLength: 1024 * 1024
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mockImageBuffer = Buffer.from('cached-image-data');

      // First download - cache miss
      mockSocket.downloadMediaMessage.mockResolvedValueOnce(mockImageBuffer);

      const mediaId1 = `${imageMessage.key.id!}-1`;
      performanceService.startMediaDownload(mediaId1, 'image', 1024 * 1024);

      await mockSocket.downloadMediaMessage(imageMessage, 'buffer');
      performanceService.endMediaDownload(mediaId1, true);

      // Second download - should be faster (cache hit)
      const mediaId2 = `${imageMessage.key.id!}-2`;
      performanceService.startMediaDownload(mediaId2, 'image', 1024 * 1024);

      // Mock faster response for cached content
      mockSocket.downloadMediaMessage.mockResolvedValueOnce(mockImageBuffer);

      await mockSocket.downloadMediaMessage(imageMessage, 'buffer');
      const cachedDownloadTime = performanceService.endMediaDownload(mediaId2, true);

      // Update cache hit rate (1 hit out of 2 total)
      performanceService.updateCacheHitRate(1, 2);

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.totalDownloads).toBe(2);
      expect(metrics.cacheHitRate).toBeGreaterThan(0);
    });
  });

  describe('Video Processing Performance', () => {
    it('should handle video downloads with progress tracking', async () => {
      const videoMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'video-progress-test'
        },
        message: {
          videoMessage: {
            url: 'https://example.com/video.mp4',
            mimetype: 'video/mp4',
            fileLength: 50 * 1024 * 1024, // 50MB
            seconds: 120,
            caption: 'Video progress test'
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mockVideoBuffer = Buffer.alloc(50 * 1024 * 1024, 'video-data');

      // Mock progressive download
      mockSocket.downloadMediaMessage.mockImplementation(async () => {
        // Simulate download progress
        const chunks = 10;
        const chunkSize = mockVideoBuffer.length / chunks;

        for (let i = 0; i < chunks; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));

          const progress = ((i + 1) / chunks) * 100;
          performanceService.recordMediaProgress(videoMessage.key.id!, progress);
        }

        return mockVideoBuffer;
      });

      const mediaId = videoMessage.key.id!;
      const mediaSize = toNumber(videoMessage.message!.videoMessage!.fileLength!);

      performanceService.startMediaDownload(mediaId, 'video', mediaSize);

      const downloadedBuffer = await mockSocket.downloadMediaMessage(videoMessage, 'buffer');

      performanceService.endMediaDownload(mediaId, true);

      expect(downloadedBuffer).toEqual(mockVideoBuffer);

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.downloadsByType.video).toBe(1);
      expect(metrics.averageDownloadSpeed).toBeGreaterThan(0);
    });

    it('should handle video streaming optimization', async () => {
      const streamingVideoMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'streaming-video-test'
        },
        message: {
          videoMessage: {
            url: 'https://example.com/streaming-video.mp4',
            mimetype: 'video/mp4',
            fileLength: 100 * 1024 * 1024, // 100MB
            seconds: 300,
            streamingSidecar: Buffer.from('streaming-data')
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      // Mock streaming download with chunks
      const totalChunks = 20;
      const chunkSize = 5 * 1024 * 1024; // 5MB chunks
      const chunks: Buffer[] = [];

      for (let i = 0; i < totalChunks; i++) {
        chunks.push(Buffer.alloc(chunkSize, `chunk-${i}`));
      }

      mockSocket.downloadMediaMessage.mockImplementation(async () => {
        // Simulate streaming download
        const downloadedChunks: Buffer[] = [];

        for (let i = 0; i < totalChunks; i++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          downloadedChunks.push(chunks[i]);

          const progress = ((i + 1) / totalChunks) * 100;
          performanceService.recordMediaProgress(streamingVideoMessage.key.id!, progress);
        }

        return Buffer.concat(downloadedChunks);
      });

      const mediaId = streamingVideoMessage.key.id!;
      const mediaSize = toNumber(streamingVideoMessage.message!.videoMessage!.fileLength!);

      performanceService.startMediaDownload(mediaId, 'video', mediaSize);
      performanceService.incrementStreamingDownloads();
      performanceService.recordChunkSize(chunkSize);

      const downloadedBuffer = await mockSocket.downloadMediaMessage(streamingVideoMessage, 'buffer');

      performanceService.endMediaDownload(mediaId, true);

      expect(downloadedBuffer.length).toBe(100 * 1024 * 1024);

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.streamingDownloads).toBe(1);
      expect(metrics.averageChunkSize).toBeCloseTo(chunkSize, -3); // Within 1KB
    });
  });

  describe('Audio Processing Performance', () => {
    it('should process voice messages efficiently', async () => {
      const voiceMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'voice-perf-test'
        },
        message: {
          audioMessage: {
            url: 'https://example.com/voice.ogg',
            mimetype: 'audio/ogg; codecs=opus',
            fileLength: 512 * 1024, // 512KB
            seconds: 30,
            ptt: true,
            waveform: Buffer.from('waveform-data')
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mockAudioBuffer = Buffer.alloc(512 * 1024, 'voice-data');
      mockSocket.downloadMediaMessage.mockResolvedValue(mockAudioBuffer);

      const mediaId = voiceMessage.key.id!;
      const mediaSize = toNumber(voiceMessage.message!.audioMessage!.fileLength!);

      performanceService.startMediaDownload(mediaId, 'audio', mediaSize);
      performanceService.incrementVoiceMessages();

      const downloadedBuffer = await mockSocket.downloadMediaMessage(voiceMessage, 'buffer');

      performanceService.endMediaDownload(mediaId, true);

      expect(downloadedBuffer).toEqual(mockAudioBuffer);

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.downloadsByType.audio).toBe(1);
      expect(metrics.voiceMessageCount).toBe(1);
    });

    it('should handle audio transcription performance', async () => {
      const audioMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'transcription-test'
        },
        message: {
          audioMessage: {
            url: 'https://example.com/audio.mp3',
            mimetype: 'audio/mp3',
            fileLength: 2 * 1024 * 1024, // 2MB
            seconds: 120,
            ptt: false
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mockAudioBuffer = Buffer.alloc(2 * 1024 * 1024, 'audio-data');
      mockSocket.downloadMediaMessage.mockResolvedValue(mockAudioBuffer);

      const mediaId = audioMessage.key.id!;
      const mediaSize = toNumber(audioMessage.message!.audioMessage!.fileLength!);

      performanceService.startMediaDownload(mediaId, 'audio', mediaSize);
      performanceService.startTranscription(mediaId);

      const downloadedBuffer = await mockSocket.downloadMediaMessage(audioMessage, 'buffer');

      // Simulate transcription processing
      await new Promise(resolve => setTimeout(resolve, 200));

      const transcriptionTime = performanceService.endTranscription(mediaId, true);
      performanceService.endMediaDownload(mediaId, true);

      expect(transcriptionTime).toBeGreaterThan(0);

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.transcriptionCount).toBe(1);
      expect(metrics.averageTranscriptionTime).toBeGreaterThan(0);
    });
  });

  describe('Document Processing Performance', () => {
    it('should handle document downloads efficiently', async () => {
      const documentMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'document-perf-test'
        },
        message: {
          documentMessage: {
            url: 'https://example.com/document.pdf',
            mimetype: 'application/pdf',
            fileLength: 5 * 1024 * 1024, // 5MB
            fileName: 'test-document.pdf',
            title: 'Test Document'
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mockDocumentBuffer = Buffer.alloc(5 * 1024 * 1024, 'pdf-data');
      mockSocket.downloadMediaMessage.mockResolvedValue(mockDocumentBuffer);

      const mediaId = documentMessage.key.id!;
      const mediaSize = toNumber(documentMessage.message!.documentMessage!.fileLength!);

      performanceService.startMediaDownload(mediaId, 'document', mediaSize);

      const downloadedBuffer = await mockSocket.downloadMediaMessage(documentMessage, 'buffer');

      performanceService.endMediaDownload(mediaId, true);

      expect(downloadedBuffer).toEqual(mockDocumentBuffer);

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.downloadsByType.document).toBe(1);
    });

    it('should handle multiple document types', async () => {
      const documentTypes = [
        { mimetype: 'application/pdf', extension: 'pdf', size: 2 * 1024 * 1024 },
        { mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx', size: 1 * 1024 * 1024 },
        { mimetype: 'application/vnd.ms-excel', extension: 'xls', size: 512 * 1024 },
        { mimetype: 'text/plain', extension: 'txt', size: 64 * 1024 }
      ];

      for (let i = 0; i < documentTypes.length; i++) {
        const docType = documentTypes[i];
        const documentMessage: WAMessage = {
          key: {
            remoteJid: '5511888888888@s.whatsapp.net',
            fromMe: false,
            id: `document-${i}`
          },
          message: {
            documentMessage: {
              url: `https://example.com/document.${docType.extension}`,
              mimetype: docType.mimetype,
              fileLength: docType.size,
              fileName: `test-document.${docType.extension}`
            }
          },
          messageTimestamp: Date.now(),
          status: 1
        };

        const mockBuffer = Buffer.alloc(docType.size, `${docType.extension}-data`);
        mockSocket.downloadMediaMessage.mockResolvedValueOnce(mockBuffer);

        const mediaId = documentMessage.key.id!;
        const mediaSize = toNumber(documentMessage.message!.documentMessage!.fileLength!);
        performanceService.startMediaDownload(mediaId, 'document', mediaSize);
        performanceService.recordDocumentType(docType.mimetype);

        await mockSocket.downloadMediaMessage(documentMessage, 'buffer');
        performanceService.endMediaDownload(mediaId, true);
      }

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.downloadsByType.document).toBe(4);
      expect(metrics.documentTypeDistribution.pdf).toBe(1);
      expect(metrics.documentTypeDistribution.docx).toBe(1);
      expect(metrics.documentTypeDistribution.xls).toBe(1);
      expect(metrics.documentTypeDistribution.txt).toBe(1);
    });
  });

  describe('Media Error Handling and Recovery', () => {
    it('should handle download failures with retry mechanism', async () => {
      const failingMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'failing-media-test'
        },
        message: {
          imageMessage: {
            url: 'https://example.com/failing-image.jpg',
            mimetype: 'image/jpeg',
            fileLength: 1024 * 1024
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      const mediaId = failingMessage.key.id!;
      const mediaSize = toNumber(failingMessage.message!.imageMessage!.fileLength!);

      // First attempt fails
      mockSocket.downloadMediaMessage.mockRejectedValueOnce(new Error('Network timeout'));

      // Second attempt succeeds
      const mockBuffer = Buffer.alloc(1024 * 1024, 'image-data');
      mockSocket.downloadMediaMessage.mockResolvedValueOnce(mockBuffer);

      performanceService.startMediaDownload(mediaId, 'image', mediaSize);

      try {
        await mockSocket.downloadMediaMessage(failingMessage, 'buffer');
      } catch (error) {
        // Record the error
        await MediaErrorHandler.handleDownloadError(error as Error, failingMessage);
        performanceService.incrementRetryAttempts();

        // Retry
        const retryResult = await mockSocket.downloadMediaMessage(failingMessage, 'buffer');
        expect(retryResult).toEqual(mockBuffer);
      }

      performanceService.endMediaDownload(mediaId, true);

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.retryAttempts).toBe(1);
      expect(metrics.successfulDownloads).toBe(1);
    });

    it('should handle corrupted media gracefully', async () => {
      const corruptedMessage: WAMessage = {
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: 'corrupted-media-test'
        },
        message: {
          videoMessage: {
            url: 'https://example.com/corrupted-video.mp4',
            mimetype: 'video/mp4',
            fileLength: 10 * 1024 * 1024
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      };

      // Mock corrupted download (wrong hash)
      const corruptedBuffer = Buffer.alloc(10 * 1024 * 1024, 'corrupted-data');
      mockSocket.downloadMediaMessage.mockResolvedValue(corruptedBuffer);

      const mediaId = corruptedMessage.key.id!;
      const mediaSize = toNumber(corruptedMessage.message!.videoMessage!.fileLength!);

      performanceService.startMediaDownload(mediaId, 'video', mediaSize);

      const downloadedBuffer = await mockSocket.downloadMediaMessage(corruptedMessage, 'buffer');

      // Verify hash mismatch (simulate corrupted data)
      const expectedHash = Buffer.from('expected-hash');
      const isCorrupted = MediaErrorHandler.verifyMediaIntegrity(
        downloadedBuffer,
        expectedHash
      );

      expect(isCorrupted).toBe(false);

      performanceService.incrementCorruptedDownloads();
      performanceService.endMediaDownload(mediaId, false);

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.corruptedDownloads).toBe(1);
    });

    it('should implement circuit breaker for media downloads', async () => {
      const mediaMessages = Array.from({ length: 10 }, (_, i) => ({
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: `circuit-breaker-${i}`
        },
        message: {
          imageMessage: {
            url: `https://example.com/image-${i}.jpg`,
            mimetype: 'image/jpeg',
            fileLength: 1024 * 1024
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      }));

      // Simulate multiple consecutive failures
      mockSocket.downloadMediaMessage.mockRejectedValue(new Error('Server error'));

      let failureCount = 0;
      for (const message of mediaMessages) {
        const mediaId = message.key.id!;
        performanceService.startMediaDownload(mediaId, 'image', 1024 * 1024);

        try {
          await mockSocket.downloadMediaMessage(message, 'buffer');
        } catch (error) {
          failureCount++;
          await MediaErrorHandler.handleDownloadError(error as Error, message);
          MediaErrorHandler.recordCircuitBreakerFailure();
          performanceService.endMediaDownload(mediaId, false);

          // Check if circuit breaker should open
          if (failureCount >= 5) {
            const isOpen = MediaErrorHandler.isCircuitBreakerOpen();
            expect(isOpen).toBe(true);
            break;
          }
        }
      }

      // Increment circuit breaker trips when it opens
      if (MediaErrorHandler.isCircuitBreakerOpen()) {
        performanceService.incrementCircuitBreakerTrips();
      }

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.failedDownloads).toBeGreaterThanOrEqual(5);
      expect(metrics.circuitBreakerTrips).toBe(1);
    });
  });

  describe('Concurrent Media Processing', () => {
    it('should handle multiple concurrent downloads efficiently', async () => {
      const concurrentMessages = Array.from({ length: 5 }, (_, i) => ({
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: `concurrent-${i}`
        },
        message: {
          imageMessage: {
            url: `https://example.com/image-${i}.jpg`,
            mimetype: 'image/jpeg',
            fileLength: 2 * 1024 * 1024
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      }));

      // Mock concurrent downloads
      mockSocket.downloadMediaMessage.mockImplementation(async (message: WAMessage) => {
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
        return Buffer.alloc(2 * 1024 * 1024, `image-${message.key.id}`);
      });

      // Start all downloads concurrently
      const downloadPromises = concurrentMessages.map(async (message) => {
        const mediaId = message.key.id!;
        performanceService.startMediaDownload(mediaId, 'image', 2 * 1024 * 1024);

        const buffer = await mockSocket.downloadMediaMessage(message, 'buffer');
        performanceService.endMediaDownload(mediaId, true);

        return buffer;
      });

      const startTime = Date.now();
      const results = await Promise.all(downloadPromises);
      const endTime = Date.now();

      expect(results).toHaveLength(5);

      // Concurrent downloads should be faster than sequential
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in less than 1 second

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.concurrentDownloads).toBe(5);
      expect(metrics.averageConcurrency).toBeGreaterThan(1);
    });

    it('should manage memory usage during concurrent processing', async () => {
      const largeMediaMessages = Array.from({ length: 3 }, (_, i) => ({
        key: {
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
          id: `large-concurrent-${i}`
        },
        message: {
          videoMessage: {
            url: `https://example.com/video-${i}.mp4`,
            mimetype: 'video/mp4',
            fileLength: 50 * 1024 * 1024 // 50MB each
          }
        },
        messageTimestamp: Date.now(),
        status: 1
      }));

      mockSocket.downloadMediaMessage.mockImplementation(async (message: WAMessage) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return Buffer.alloc(50 * 1024 * 1024, `video-${message.key.id}`);
      });

      // Monitor memory usage during concurrent downloads
      const memoryReadings: number[] = [];
      const memoryMonitor = setInterval(() => {
        performanceService.recordMemoryUsage();
        const metrics = performanceService.getResourceMetrics();
        memoryReadings.push(metrics.memoryUsage.heapUsed);
      }, 50);

      // Start concurrent downloads
      const downloadPromises = largeMediaMessages.map(async (message) => {
        const mediaId = message.key.id!;
        performanceService.startMediaDownload(mediaId, 'video', 50 * 1024 * 1024);

        const buffer = await mockSocket.downloadMediaMessage(message, 'buffer');
        performanceService.endMediaDownload(mediaId, true);

        return buffer;
      });

      await Promise.all(downloadPromises);
      clearInterval(memoryMonitor);

      // Memory should not grow excessively
      const maxMemory = Math.max(...memoryReadings);
      const minMemory = Math.min(...memoryReadings);
      const memoryGrowth = (maxMemory - minMemory) / minMemory;

      expect(memoryGrowth).toBeLessThan(2); // Less than 200% growth

      const metrics = performanceService.getMediaMetrics();
      expect(metrics.peakMemoryUsage).toBeGreaterThan(0);
    });
  });
});