import { JidLidMapper } from '../JidLidMapper';

describe('JidLidMapper', () => {
  let mapper: JidLidMapper;

  beforeEach(() => {
    mapper = new JidLidMapper();
  });

  describe('normalizeJid', () => {
    it('should normalize a standard WhatsApp JID', () => {
      const jid = '5511999999999@s.whatsapp.net';
      const normalized = mapper.normalizeJid(jid);
      expect(normalized).toBe('5511999999999@s.whatsapp.net');
    });

    it('should normalize a group JID', () => {
      const jid = '120363025246125244@g.us';
      const normalized = mapper.normalizeJid(jid);
      expect(normalized).toBe('120363025246125244@g.us');
    });

    it('should handle JID with additional parameters', () => {
      const jid = '5511999999999@s.whatsapp.net:1234567890';
      const normalized = mapper.normalizeJid(jid);
      expect(normalized).toBe('5511999999999@s.whatsapp.net');
    });

    it('should handle broadcast JID', () => {
      const jid = 'status@broadcast';
      const normalized = mapper.normalizeJid(jid);
      expect(normalized).toBe('status@broadcast');
    });

    it('should throw error for invalid JID format', () => {
      const invalidJid = 'invalid-jid';
      expect(() => mapper.normalizeJid(invalidJid)).toThrow('Invalid JID format');
    });
  });

  describe('mapJidToLid', () => {
    it('should map a standard JID to LID', () => {
      const jid = '5511999999999@s.whatsapp.net';
      const lid = mapper.mapJidToLid(jid);
      expect(lid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should return consistent LID for same JID', () => {
      const jid = '5511999999999@s.whatsapp.net';
      const lid1 = mapper.mapJidToLid(jid);
      const lid2 = mapper.mapJidToLid(jid);
      expect(lid1).toBe(lid2);
    });

    it('should return different LIDs for different JIDs', () => {
      const jid1 = '5511999999999@s.whatsapp.net';
      const jid2 = '5511888888888@s.whatsapp.net';
      const lid1 = mapper.mapJidToLid(jid1);
      const lid2 = mapper.mapJidToLid(jid2);
      expect(lid1).not.toBe(lid2);
    });
  });

  describe('mapLidToJid', () => {
    it('should map LID back to original JID', () => {
      const originalJid = '5511999999999@s.whatsapp.net';
      const lid = mapper.mapJidToLid(originalJid);
      const mappedJid = mapper.mapLidToJid(lid);
      expect(mappedJid).toBe(originalJid);
    });

    it('should throw error for unmapped LID', () => {
      const unmappedLid = '12345678-1234-1234-1234-123456789012';
      expect(() => mapper.mapLidToJid(unmappedLid)).toThrow('LID not found in mapping');
    });
  });

  describe('validateJidFormat', () => {
    it('should validate correct WhatsApp JID format', () => {
      const validJids = [
        '5511999999999@s.whatsapp.net',
        '120363025246125244@g.us',
        'status@broadcast',
        '5511999999999@c.us'
      ];

      validJids.forEach(jid => {
        expect(mapper.validateJidFormat(jid)).toBe(true);
      });
    });

    it('should reject invalid JID formats', () => {
      const invalidJids = [
        'invalid-jid',
        '5511999999999',
        '@s.whatsapp.net',
        '5511999999999@',
        '',
        null,
        undefined
      ];

      invalidJids.forEach(jid => {
        expect(mapper.validateJidFormat(jid as any)).toBe(false);
      });
    });
  });

  describe('clearMappings', () => {
    it('should clear all JID/LID mappings', () => {
      const jid = '5511999999999@s.whatsapp.net';
      const lid = mapper.mapJidToLid(jid);
      
      mapper.clearMappings();
      
      expect(() => mapper.mapLidToJid(lid)).toThrow('LID not found in mapping');
    });
  });

  describe('getMappingStats', () => {
    it('should return correct mapping statistics', () => {
      const jid1 = '5511999999999@s.whatsapp.net';
      const jid2 = '5511888888888@s.whatsapp.net';
      
      mapper.mapJidToLid(jid1);
      mapper.mapJidToLid(jid2);
      
      const stats = mapper.getMappingStats();
      expect(stats.totalMappings).toBe(2);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });
});