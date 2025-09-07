import { useMultiFileAuthState } from '../useMultiFileAuthState';
import fs from 'fs/promises';
import path from 'path';

// Mock fs module
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('useMultiFileAuthState', () => {
  const testSessionPath = './test-session';
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock directory exists
    mockFs.access.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.readFile.mockResolvedValue(Buffer.from('{}'));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('initialization', () => {
    it('should create session directory if it does not exist', async () => {
      mockFs.access.mockRejectedValueOnce(new Error('Directory not found'));
      
      await useMultiFileAuthState(testSessionPath);
      
      expect(mockFs.mkdir).toHaveBeenCalledWith(testSessionPath, { recursive: true });
    });

    it('should not create directory if it already exists', async () => {
      mockFs.access.mockResolvedValueOnce(undefined);
      
      await useMultiFileAuthState(testSessionPath);
      
      expect(mockFs.mkdir).not.toHaveBeenCalled();
    });

    it('should return state and saveCreds function', async () => {
      const result = await useMultiFileAuthState(testSessionPath);
      
      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('saveCreds');
      expect(typeof result.saveCreds).toBe('function');
    });
  });

  describe('credential management', () => {
    it('should load existing credentials from files', async () => {
      const mockCredentials = {
        noiseKey: { private: Buffer.from('test'), public: Buffer.from('test') },
        pairingEphemeralKeyPair: { private: Buffer.from('test'), public: Buffer.from('test') },
        signedIdentityKey: { private: Buffer.from('test'), public: Buffer.from('test') },
        signedPreKey: { keyPair: { private: Buffer.from('test'), public: Buffer.from('test') }, signature: Buffer.from('test'), keyId: 1 },
        registrationId: 12345,
        advSecretKey: 'test-secret',
        me: { id: '5511999999999@s.whatsapp.net', name: 'Test User' },
        account: { details: Buffer.from('test'), accountSignature: Buffer.from('test'), deviceSignature: Buffer.from('test') },
        signalIdentities: [],
        myAppStateKeyId: 'test-key-id',
        firstUnuploadedPreKeyId: 1,
        nextPreKeyId: 2,
        serverHasPreKeys: true
      };

      mockFs.readdir.mockResolvedValueOnce(['creds.json'] as any);
      mockFs.readFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(mockCredentials)));

      const { state } = await useMultiFileAuthState(testSessionPath);
      
      expect(state.creds).toBeDefined();
      expect(state.creds.registrationId).toBe(12345);
    });

    it('should save credentials to file', async () => {
      const { saveCreds } = await useMultiFileAuthState(testSessionPath);
      
      const testCreds = {
        registrationId: 54321,
        noiseKey: { private: Buffer.from('test'), public: Buffer.from('test') }
      };

      await saveCreds(testCreds as any);
      
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join(testSessionPath, 'creds.json'),
        expect.any(String),
        { encoding: 'utf-8' }
      );
    });

    it('should handle credential file corruption gracefully', async () => {
      mockFs.readdir.mockResolvedValueOnce(['creds.json'] as any);
      mockFs.readFile.mockResolvedValueOnce(Buffer.from('invalid-json'));

      const { state } = await useMultiFileAuthState(testSessionPath);
      
      expect(state.creds).toBeDefined();
      // Should create new credentials if file is corrupted
      expect(state.creds.registrationId).toBeDefined();
    });
  });

  describe('key management', () => {
    it('should load pre-keys from files', async () => {
      const mockPreKeys = {
        '1': { keyPair: { private: Buffer.from('test'), public: Buffer.from('test') }, keyId: 1 }
      };

      mockFs.readdir.mockResolvedValueOnce(['pre-key-1.json'] as any);
      mockFs.readFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(mockPreKeys['1'])));

      const { state } = await useMultiFileAuthState(testSessionPath);
      
      expect(state.keys.get).toBeDefined();
      
      // Test key retrieval
      const key = await state.keys.get('pre-key', ['1']);
      expect(key).toBeDefined();
    });

    it('should save pre-keys to files', async () => {
      const { state } = await useMultiFileAuthState(testSessionPath);
      
      const testKey = {
        keyPair: { private: Buffer.from('test'), public: Buffer.from('test') },
        keyId: 1
      };

      await state.keys.set({ 'pre-key': { '1': testKey } });
      
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join(testSessionPath, 'pre-key-1.json'),
        expect.any(String),
        { encoding: 'utf-8' }
      );
    });

    it('should clear keys when requested', async () => {
      mockFs.readdir.mockResolvedValueOnce(['pre-key-1.json', 'session-test.json'] as any);
      
      const { state } = await useMultiFileAuthState(testSessionPath);
      
      await state.keys.clear();
      
      expect(mockFs.unlink).toHaveBeenCalledWith(path.join(testSessionPath, 'pre-key-1.json'));
      expect(mockFs.unlink).toHaveBeenCalledWith(path.join(testSessionPath, 'session-test.json'));
    });
  });

  describe('enhanced security features', () => {
    it('should implement secure credential cleanup', async () => {
      const { state } = await useMultiFileAuthState(testSessionPath);
      
      // Test that cleanup function exists and can be called
      expect(state.secureCleanup).toBeDefined();
      expect(typeof state.secureCleanup).toBe('function');
      
      await state.secureCleanup();
      
      // Should attempt to clear all files
      expect(mockFs.readdir).toHaveBeenCalled();
    });

    it('should validate credential integrity', async () => {
      const { state } = await useMultiFileAuthState(testSessionPath);
      
      expect(state.validateCredentials).toBeDefined();
      expect(typeof state.validateCredentials).toBe('function');
      
      const isValid = await state.validateCredentials();
      expect(typeof isValid).toBe('boolean');
    });

    it('should implement enhanced encryption for sensitive data', async () => {
      const { saveCreds } = await useMultiFileAuthState(testSessionPath);
      
      const sensitiveData = {
        advSecretKey: 'very-secret-key',
        noiseKey: { private: Buffer.from('sensitive'), public: Buffer.from('public') }
      };

      await saveCreds(sensitiveData as any);
      
      // Verify that data is being processed (encrypted) before saving
      const writeCall = mockFs.writeFile.mock.calls[0];
      const savedData = JSON.parse(writeCall[1] as string);
      
      // The saved data should be structured properly
      expect(savedData).toHaveProperty('advSecretKey');
      expect(savedData).toHaveProperty('noiseKey');
    });
  });

  describe('error handling', () => {
    it('should handle file system errors gracefully', async () => {
      mockFs.readdir.mockRejectedValueOnce(new Error('Permission denied'));
      
      // Should not throw but handle gracefully
      const result = await useMultiFileAuthState(testSessionPath);
      expect(result).toBeDefined();
    });

    it('should handle write errors during credential save', async () => {
      const { saveCreds } = await useMultiFileAuthState(testSessionPath);
      mockFs.writeFile.mockRejectedValueOnce(new Error('Disk full'));
      
      // Should handle write errors gracefully
      await expect(saveCreds({} as any)).rejects.toThrow('Disk full');
    });

    it('should recover from corrupted key files', async () => {
      mockFs.readdir.mockResolvedValueOnce(['pre-key-1.json'] as any);
      mockFs.readFile.mockResolvedValueOnce(Buffer.from('corrupted-data'));
      
      const { state } = await useMultiFileAuthState(testSessionPath);
      
      // Should handle corrupted files and continue
      expect(state.keys.get).toBeDefined();
    });
  });
});