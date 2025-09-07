import { 
  jidNormalizedUser, 
  isJidGroup, 
  isJidBroadcast, 
  isJidStatusBroadcast,
  isJidUser 
} from "@whiskeysockets/baileys";
import logger from "../utils/logger";

/**
 * JID/LID Mapper Helper for Baileys 6.7.19
 * 
 * This helper provides functions for normalizing JIDs, converting between JID and LID,
 * and validating identifier formats according to the new Baileys 6.7.19 specifications.
 * 
 * Requirements: 9.1, 9.2, 9.3
 */

export interface JidLidMapping {
  jid: string;
  lid?: string;
  normalized: string;
  type: 'user' | 'group' | 'broadcast' | 'status' | 'unknown';
}

export class JidLidMapper {
  private static jidLidCache = new Map<string, JidLidMapping>();

  /**
   * Normalizes a JID using Baileys' jidNormalizedUser function
   * Requirement 9.1: Use new methods of JID normalization and mapping
   * 
   * @param jid - The JID to normalize
   * @returns Normalized JID string
   */
  static normalizeJid(jid: string): string {
    if (!jid || typeof jid !== 'string') {
      logger.warn(`Invalid JID provided for normalization: ${jid}`);
      return '';
    }

    try {
      // Use Baileys' built-in normalization for user JIDs
      if (isJidUser(jid)) {
        return jidNormalizedUser(jid);
      }
      
      // For group JIDs, return as-is since they don't need user normalization
      if (isJidGroup(jid)) {
        return jid;
      }
      
      // For other types, return the original JID
      return jid;
    } catch (error: any) {
      logger.error(`Error normalizing JID ${jid}: ${error}`);
      return jid; // Return original JID if normalization fails
    }
  }

  /**
   * Maps a JID to its corresponding LID (Local Identifier)
   * Requirement 9.2: Implement new local identification system
   * 
   * @param jid - The JID to map to LID
   * @returns LID string or null if no mapping exists
   */
  static mapJidToLid(jid: string): string | null {
    if (!jid || typeof jid !== 'string') {
      return null;
    }

    const normalizedJid = this.normalizeJid(jid);
    const cached = this.jidLidCache.get(normalizedJid);
    
    if (cached && cached.lid) {
      return cached.lid;
    }

    // For Baileys 6.7.19, LID mapping is typically handled internally
    // This implementation provides a fallback mechanism
    try {
      // Generate a consistent LID based on the normalized JID
      // This is a simplified implementation - in practice, LIDs would come from Baileys
      const lid = this.generateLidFromJid(normalizedJid);
      
      // Cache the mapping
      this.jidLidCache.set(normalizedJid, {
        jid: normalizedJid,
        lid,
        normalized: normalizedJid,
        type: this.getJidType(normalizedJid)
      });
      
      return lid;
    } catch (error: any) {
      logger.error(`Error mapping JID to LID for ${jid}: ${error}`);
      return null;
    }
  }

  /**
   * Maps a LID back to its corresponding JID
   * Requirement 9.3: Use new mapping functions for conversion between JID and LID
   * 
   * @param lid - The LID to map to JID
   * @returns JID string or null if no mapping exists
   */
  static mapLidToJid(lid: string): string | null {
    if (!lid || typeof lid !== 'string') {
      return null;
    }

    // Search through cached mappings
    for (const [jid, mapping] of Array.from(this.jidLidCache.entries())) {
      if (mapping.lid === lid) {
        return jid;
      }
    }

    // If not found in cache, try to reverse-engineer from LID
    try {
      return this.generateJidFromLid(lid);
    } catch (error: any) {
      logger.error(`Error mapping LID to JID for ${lid}: ${error}`);
      return null;
    }
  }

  /**
   * Validates JID format according to WhatsApp standards
   * Requirement 9.1: Implement validation of identifier formats
   * 
   * @param jid - The JID to validate
   * @returns boolean indicating if JID format is valid
   */
  static validateJidFormat(jid: string): boolean {
    if (!jid || typeof jid !== 'string') {
      return false;
    }

    try {
      // Use Baileys' built-in validation functions
      return (
        isJidUser(jid) || 
        isJidGroup(jid) || 
        isJidBroadcast(jid) || 
        isJidStatusBroadcast(jid)
      );
    } catch (error: any) {
      logger.error(`Error validating JID format for ${jid}: ${error}`);
      return false;
    }
  }

  /**
   * Gets the type of a JID (user, group, broadcast, etc.)
   * 
   * @param jid - The JID to analyze
   * @returns JID type string
   */
  static getJidType(jid: string): 'user' | 'group' | 'broadcast' | 'status' | 'unknown' {
    if (!jid || typeof jid !== 'string') {
      return 'unknown';
    }

    try {
      if (isJidUser(jid)) return 'user';
      if (isJidGroup(jid)) return 'group';
      if (isJidBroadcast(jid)) return 'broadcast';
      if (isJidStatusBroadcast(jid)) return 'status';
      return 'unknown';
    } catch (error: any) {
      logger.error(`Error determining JID type for ${jid}: ${error}`);
      return 'unknown';
    }
  }

  /**
   * Gets or creates a complete JID/LID mapping
   * 
   * @param jid - The JID to get mapping for
   * @returns Complete JidLidMapping object
   */
  static getJidLidMapping(jid: string): JidLidMapping {
    if (!jid || typeof jid !== 'string') {
      return {
        jid: '',
        normalized: '',
        type: 'unknown'
      };
    }

    const normalizedJid = this.normalizeJid(jid);
    const cached = this.jidLidCache.get(normalizedJid);
    
    if (cached) {
      return cached;
    }

    // Create new mapping
    const mapping: JidLidMapping = {
      jid: normalizedJid,
      lid: this.mapJidToLid(jid) || undefined,
      normalized: normalizedJid,
      type: this.getJidType(normalizedJid)
    };

    this.jidLidCache.set(normalizedJid, mapping);
    return mapping;
  }

  /**
   * Clears the JID/LID mapping cache
   */
  static clearCache(): void {
    this.jidLidCache.clear();
    logger.debug('JID/LID mapping cache cleared');
  }

  /**
   * Gets cache statistics for monitoring
   */
  static getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.jidLidCache.size,
      entries: Array.from(this.jidLidCache.keys())
    };
  }

  /**
   * Private helper to generate LID from JID
   * This is a simplified implementation for compatibility
   */
  private static generateLidFromJid(jid: string): string {
    // In a real implementation, this would use Baileys' internal LID generation
    // For now, we create a consistent hash-like identifier
    const hash = this.simpleHash(jid);
    return `lid_${hash}`;
  }

  /**
   * Private helper to generate JID from LID
   * This is a simplified reverse mapping
   */
  private static generateJidFromLid(lid: string): string | null {
    // This is a simplified implementation
    // In practice, LID to JID mapping would be handled by Baileys internally
    if (lid.startsWith('lid_')) {
      // This is a fallback - in real scenarios, proper mapping would be maintained
      logger.warn(`Attempting to reverse-map LID ${lid} - this may not be accurate`);
      return null;
    }
    return null;
  }

  /**
   * Simple hash function for generating consistent identifiers
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}

// Export convenience functions for backward compatibility
export const normalizeJid = JidLidMapper.normalizeJid.bind(JidLidMapper);
export const mapJidToLid = JidLidMapper.mapJidToLid.bind(JidLidMapper);
export const mapLidToJid = JidLidMapper.mapLidToJid.bind(JidLidMapper);
export const validateJidFormat = JidLidMapper.validateJidFormat.bind(JidLidMapper);
export const getJidType = JidLidMapper.getJidType.bind(JidLidMapper);
export const getJidLidMapping = JidLidMapper.getJidLidMapping.bind(JidLidMapper);

export default JidLidMapper;