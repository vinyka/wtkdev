import Redis from 'ioredis';
import CacheSingleton from '../cache';

// Mock Redis
jest.mock('ioredis');
const MockedRedis = Redis as jest.MockedClass<typeof Redis>;

describe('CacheSingleton', () => {
  let mockRedisInstance: jest.Mocked<Redis>;
  let cache: typeof CacheSingleton;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock Redis instance
    mockRedisInstance = {
      set: jest.fn(),
      get: jest.fn(),
      keys: jest.fn(),
      del: jest.fn(),
      on: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    MockedRedis.mockImplementation(() => mockRedisInstance);
    
    // Reset singleton instance for testing
    (CacheSingleton as any).instance = null;
    
    // Create new instance for testing
    cache = (CacheSingleton as any).getInstance(mockRedisInstance);
  });

  describe('singleton pattern', () => {
    it('should return the same instance when called multiple times', () => {
      const instance1 = (CacheSingleton as any).getInstance(mockRedisInstance);
      const instance2 = (CacheSingleton as any).getInstance(mockRedisInstance);
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('basic cache operations', () => {
    it('should set a value in cache', async () => {
      mockRedisInstance.set.mockResolvedValueOnce('OK');
      
      const result = await cache.set('test-key', 'test-value');
      
      expect(mockRedisInstance.set).toHaveBeenCalledWith('test-key', 'test-value');
      expect(result).toBe('OK');
    });

    it('should set a value with expiration', async () => {
      mockRedisInstance.set.mockResolvedValueOnce('OK');
      
      const result = await cache.set('test-key', 'test-value', 'EX', 3600);
      
      expect(mockRedisInstance.set).toHaveBeenCalledWith('test-key', 'test-value', 'EX', 3600);
      expect(result).toBe('OK');
    });

    it('should get a value from cache', async () => {
      mockRedisInstance.get.mockResolvedValueOnce('test-value');
      
      const result = await cache.get('test-key');
      
      expect(mockRedisInstance.get).toHaveBeenCalledWith('test-key');
      expect(result).toBe('test-value');
    });

    it('should return null for non-existent key', async () => {
      mockRedisInstance.get.mockResolvedValueOnce(null);
      
      const result = await cache.get('non-existent-key');
      
      expect(result).toBeNull();
    });

    it('should delete a key from cache', async () => {
      mockRedisInstance.del.mockResolvedValueOnce(1);
      
      const result = await cache.del('test-key');
      
      expect(mockRedisInstance.del).toHaveBeenCalledWith('test-key');
      expect(result).toBe(1);
    });
  });

  describe('pattern-based operations', () => {
    it('should get keys matching a pattern', async () => {
      const mockKeys = ['user:1', 'user:2', 'user:3'];
      mockRedisInstance.keys.mockResolvedValueOnce(mockKeys);
      
      const result = await cache.getKeys('user:*');
      
      expect(mockRedisInstance.keys).toHaveBeenCalledWith('user:*');
      expect(result).toEqual(mockKeys);
    });

    it('should delete all keys matching a pattern', async () => {
      const mockKeys = ['user:1', 'user:2', 'user:3'];
      mockRedisInstance.keys.mockResolvedValueOnce(mockKeys);
      mockRedisInstance.del.mockResolvedValue(1);
      
      await cache.delFromPattern('user:*');
      
      expect(mockRedisInstance.keys).toHaveBeenCalledWith('user:*');
      expect(mockRedisInstance.del).toHaveBeenCalledTimes(3);
      expect(mockRedisInstance.del).toHaveBeenCalledWith('user:1');
      expect(mockRedisInstance.del).toHaveBeenCalledWith('user:2');
      expect(mockRedisInstance.del).toHaveBeenCalledWith('user:3');
    });
  });

  describe('parameter-based caching', () => {
    const testParams = { userId: 123, type: 'message' };
    
    it('should set value with encrypted parameter key', async () => {
      mockRedisInstance.set.mockResolvedValueOnce('OK');
      
      const result = await cache.setFromParams('messages', testParams, 'cached-data');
      
      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        expect.stringMatching(/^messages:/),
        'cached-data'
      );
      expect(result).toBe('OK');
    });

    it('should set value with encrypted parameter key and expiration', async () => {
      mockRedisInstance.set.mockResolvedValueOnce('OK');
      
      const result = await cache.setFromParams('messages', testParams, 'cached-data', 'EX', 3600);
      
      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        expect.stringMatching(/^messages:/),
        'cached-data',
        'EX',
        3600
      );
      expect(result).toBe('OK');
    });

    it('should get value with encrypted parameter key', async () => {
      mockRedisInstance.get.mockResolvedValueOnce('cached-data');
      
      const result = await cache.getFromParams('messages', testParams);
      
      expect(mockRedisInstance.get).toHaveBeenCalledWith(
        expect.stringMatching(/^messages:/)
      );
      expect(result).toBe('cached-data');
    });

    it('should delete value with encrypted parameter key', async () => {
      mockRedisInstance.del.mockResolvedValueOnce(1);
      
      const result = await cache.delFromParams('messages', testParams);
      
      expect(mockRedisInstance.del).toHaveBeenCalledWith(
        expect.stringMatching(/^messages:/)
      );
      expect(result).toBe(1);
    });

    it('should generate consistent keys for same parameters', async () => {
      mockRedisInstance.set.mockResolvedValue('OK');
      mockRedisInstance.get.mockResolvedValueOnce('cached-data');
      
      // Set with parameters
      await cache.setFromParams('test', testParams, 'data');
      
      // Get with same parameters
      const result = await cache.getFromParams('test', testParams);
      
      // Should use the same key
      const setCall = mockRedisInstance.set.mock.calls[0][0];
      const getCall = mockRedisInstance.get.mock.calls[0][0];
      
      expect(setCall).toBe(getCall);
      expect(result).toBe('cached-data');
    });

    it('should generate different keys for different parameters', async () => {
      mockRedisInstance.set.mockResolvedValue('OK');
      
      const params1 = { userId: 123, type: 'message' };
      const params2 = { userId: 456, type: 'message' };
      
      await cache.setFromParams('test', params1, 'data1');
      await cache.setFromParams('test', params2, 'data2');
      
      const key1 = mockRedisInstance.set.mock.calls[0][0];
      const key2 = mockRedisInstance.set.mock.calls[1][0];
      
      expect(key1).not.toBe(key2);
    });
  });

  describe('error handling', () => {
    it('should handle Redis connection errors', async () => {
      mockRedisInstance.set.mockRejectedValueOnce(new Error('Connection failed'));
      
      await expect(cache.set('test-key', 'test-value')).rejects.toThrow('Connection failed');
    });

    it('should handle Redis get errors', async () => {
      mockRedisInstance.get.mockRejectedValueOnce(new Error('Read failed'));
      
      await expect(cache.get('test-key')).rejects.toThrow('Read failed');
    });

    it('should handle pattern deletion errors gracefully', async () => {
      mockRedisInstance.keys.mockResolvedValueOnce(['key1', 'key2']);
      mockRedisInstance.del.mockRejectedValueOnce(new Error('Delete failed'));
      
      await expect(cache.delFromPattern('test:*')).rejects.toThrow('Delete failed');
    });
  });

  describe('performance optimizations', () => {
    it('should handle large number of keys efficiently', async () => {
      const largeKeySet = Array.from({ length: 1000 }, (_, i) => `key:${i}`);
      mockRedisInstance.keys.mockResolvedValueOnce(largeKeySet);
      mockRedisInstance.del.mockResolvedValue(1);
      
      const startTime = Date.now();
      await cache.delFromPattern('key:*');
      const endTime = Date.now();
      
      // Should complete within reasonable time (less than 1 second for 1000 keys)
      expect(endTime - startTime).toBeLessThan(1000);
      expect(mockRedisInstance.del).toHaveBeenCalledTimes(1000);
    });

    it('should handle concurrent operations', async () => {
      mockRedisInstance.set.mockResolvedValue('OK');
      mockRedisInstance.get.mockResolvedValue('test-value');
      
      const operations = Array.from({ length: 100 }, (_, i) => 
        Promise.all([
          cache.set(`key:${i}`, `value:${i}`),
          cache.get(`key:${i}`)
        ])
      );
      
      await Promise.all(operations);
      
      expect(mockRedisInstance.set).toHaveBeenCalledTimes(100);
      expect(mockRedisInstance.get).toHaveBeenCalledTimes(100);
    });
  });

  describe('Redis instance access', () => {
    it('should provide access to underlying Redis instance', () => {
      const redisInstance = cache.getRedisInstance();
      
      expect(redisInstance).toBe(mockRedisInstance);
    });
  });
});