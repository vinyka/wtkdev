#!/usr/bin/env node

/**
 * Data Integrity Validation Script
 * 
 * Validates data integrity after Baileys 6.7.19 migration
 * Checks for consistency, orphaned records, and data corruption
 */

const fs = require('fs').promises;
const path = require('path');
const { Sequelize } = require('sequelize');

class DataIntegrityValidator {
  constructor() {
    this.db = null;
    this.results = {
      passed: 0,
      failed: 0,
      warnings: 0,
      errors: []
    };
  }

  async run() {
    console.log('🔍 Starting data integrity validation...\n');
    
    try {
      await this.initDatabase();
      
      const validations = [
        'validateJidFormats',
        'validateContactIntegrity',
        'validateMessageIntegrity',
        'validateTicketIntegrity',
        'validateSessionFiles',
        'validateOrphanedRecords',
        'validateDataConsistency'
      ];

      for (const validation of validations) {
        await this.runValidation(validation);
      }

      await this.generateReport();
      
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      process.exit(1);
    } finally {
      if (this.db) {
        await this.db.close();
      }
    }
  }

  async initDatabase() {
    try {
      const dbConfig = process.env.DATABASE_URL || {
        dialect: 'sqlite',
        storage: './database.sqlite'
      };

      this.db = new Sequelize(dbConfig, { logging: false });
      await this.db.authenticate();
      console.log('✅ Database connection established');
      
    } catch (error) {
      throw new Error(`Database connection failed: ${error.message}`);
    }
  }

  async runValidation(validationName) {
    try {
      console.log(`🔍 Running ${validationName}...`);
      await this[validationName]();
      this.results.passed++;
      console.log(`✅ ${validationName} passed\n`);
      
    } catch (error) {
      this.results.failed++;
      this.results.errors.push({
        validation: validationName,
        error: error.message
      });
      console.log(`❌ ${validationName} failed: ${error.message}\n`);
    }
  }

  async validateJidFormats() {
    // Check for old JID formats that should have been migrated
    const [oldJids] = await this.db.query(`
      SELECT 'Contacts' as table_name, id, number as jid 
      FROM Contacts 
      WHERE number LIKE '%@c.us%'
      
      UNION ALL
      
      SELECT 'Messages' as table_name, id, "from" as jid 
      FROM Messages 
      WHERE "from" LIKE '%@c.us%'
      
      UNION ALL
      
      SELECT 'Messages' as table_name, id, "to" as jid 
      FROM Messages 
      WHERE "to" LIKE '%@c.us%'
    `);

    if (oldJids.length > 0) {
      throw new Error(`Found ${oldJids.length} records with old JID format (@c.us)`);
    }

    // Check for invalid JID formats
    const [invalidJids] = await this.db.query(`
      SELECT 'Contacts' as table_name, id, number as jid 
      FROM Contacts 
      WHERE number NOT LIKE '%@%' AND number != ''
      
      UNION ALL
      
      SELECT 'Messages' as table_name, id, "from" as jid 
      FROM Messages 
      WHERE "from" NOT LIKE '%@%' AND "from" != ''
    `);

    if (invalidJids.length > 0) {
      this.results.warnings++;
      console.log(`⚠️  Found ${invalidJids.length} records with potentially invalid JID formats`);
    }

    console.log(`   Validated JID formats in database`);
  }

  async validateContactIntegrity() {
    // Check for duplicate contacts
    const [duplicates] = await this.db.query(`
      SELECT number, COUNT(*) as count 
      FROM Contacts 
      GROUP BY number 
      HAVING COUNT(*) > 1
    `);

    if (duplicates.length > 0) {
      this.results.warnings++;
      console.log(`⚠️  Found ${duplicates.length} duplicate contacts`);
    }

    // Check for contacts without names
    const [unnamed] = await this.db.query(`
      SELECT COUNT(*) as count 
      FROM Contacts 
      WHERE (name IS NULL OR name = '') AND number != ''
    `);

    if (unnamed[0].count > 0) {
      console.log(`   Found ${unnamed[0].count} contacts without names (normal)`);
    }

    // Check for contacts with invalid phone numbers
    const [invalidNumbers] = await this.db.query(`
      SELECT COUNT(*) as count 
      FROM Contacts 
      WHERE number REGEXP '^[0-9]+@s\.whatsapp\.net$' = 0 
      AND number NOT LIKE '%@g.us' 
      AND number != ''
    `);

    if (invalidNumbers[0].count > 0) {
      this.results.warnings++;
      console.log(`⚠️  Found ${invalidNumbers[0].count} contacts with potentially invalid numbers`);
    }

    console.log(`   Validated contact integrity`);
  }

  async validateMessageIntegrity() {
    // Check for messages without contacts
    const [orphanedMessages] = await this.db.query(`
      SELECT COUNT(*) as count 
      FROM Messages m
      LEFT JOIN Contacts c ON (m."from" = c.number OR m."to" = c.number)
      WHERE c.id IS NULL AND m."from" != '' AND m."to" != ''
    `);

    if (orphanedMessages[0].count > 0) {
      this.results.warnings++;
      console.log(`⚠️  Found ${orphanedMessages[0].count} messages without corresponding contacts`);
    }

    // Check for messages with missing required fields
    const [incompleteMessages] = await this.db.query(`
      SELECT COUNT(*) as count 
      FROM Messages 
      WHERE (id IS NULL OR id = '') 
      OR ("from" IS NULL AND "to" IS NULL)
      OR (body IS NULL AND mediaType IS NULL)
    `);

    if (incompleteMessages[0].count > 0) {
      throw new Error(`Found ${incompleteMessages[0].count} messages with missing required fields`);
    }

    // Check message timestamps
    const [invalidTimestamps] = await this.db.query(`
      SELECT COUNT(*) as count 
      FROM Messages 
      WHERE timestamp IS NULL 
      OR timestamp < '2020-01-01' 
      OR timestamp > datetime('now', '+1 day')
    `);

    if (invalidTimestamps[0].count > 0) {
      this.results.warnings++;
      console.log(`⚠️  Found ${invalidTimestamps[0].count} messages with invalid timestamps`);
    }

    console.log(`   Validated message integrity`);
  }

  async validateTicketIntegrity() {
    try {
      // Check for tickets without contacts
      const [orphanedTickets] = await this.db.query(`
        SELECT COUNT(*) as count 
        FROM Tickets t
        LEFT JOIN Contacts c ON t.contactId = c.id
        WHERE c.id IS NULL
      `);

      if (orphanedTickets[0].count > 0) {
        throw new Error(`Found ${orphanedTickets[0].count} tickets without corresponding contacts`);
      }

      // Check for tickets with invalid status
      const [invalidStatus] = await this.db.query(`
        SELECT COUNT(*) as count 
        FROM Tickets 
        WHERE status NOT IN ('open', 'pending', 'closed')
      `);

      if (invalidStatus[0].count > 0) {
        this.results.warnings++;
        console.log(`⚠️  Found ${invalidStatus[0].count} tickets with invalid status`);
      }

      console.log(`   Validated ticket integrity`);
      
    } catch (error) {
      if (error.message.includes('no such table')) {
        console.log(`   Tickets table not found, skipping validation`);
      } else {
        throw error;
      }
    }
  }

  async validateSessionFiles() {
    const sessionsPath = './sessions';
    
    try {
      const sessionDirs = await fs.readdir(sessionsPath);
      let validSessions = 0;
      let invalidSessions = 0;

      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(sessionsPath, sessionDir);
        const stat = await fs.stat(sessionPath);
        
        if (!stat.isDirectory()) continue;

        // Check for required files
        const requiredFiles = ['creds.json'];
        let sessionValid = true;

        for (const file of requiredFiles) {
          const filePath = path.join(sessionPath, file);
          try {
            await fs.access(filePath);
            
            // Validate JSON format
            const content = await fs.readFile(filePath, 'utf8');
            JSON.parse(content);
            
          } catch (error) {
            sessionValid = false;
            console.log(`   ❌ Session ${sessionDir}: Invalid or missing ${file}`);
            break;
          }
        }

        if (sessionValid) {
          validSessions++;
        } else {
          invalidSessions++;
        }
      }

      if (invalidSessions > 0) {
        this.results.warnings++;
        console.log(`⚠️  Found ${invalidSessions} invalid sessions out of ${validSessions + invalidSessions} total`);
      }

      console.log(`   Validated ${validSessions} session files`);
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`   Sessions directory not found, skipping validation`);
      } else {
        throw error;
      }
    }
  }

  async validateOrphanedRecords() {
    // Check for orphaned message records
    const [orphanedMessages] = await this.db.query(`
      SELECT COUNT(*) as count 
      FROM Messages m
      WHERE NOT EXISTS (
        SELECT 1 FROM Contacts c 
        WHERE c.number = m."from" OR c.number = m."to"
      )
      AND m."from" != '' AND m."to" != ''
    `);

    if (orphanedMessages[0].count > 0) {
      this.results.warnings++;
      console.log(`⚠️  Found ${orphanedMessages[0].count} orphaned messages`);
    }

    // Check for orphaned ticket messages (if applicable)
    try {
      const [orphanedTicketMessages] = await this.db.query(`
        SELECT COUNT(*) as count 
        FROM Messages m
        WHERE m.ticketId IS NOT NULL 
        AND NOT EXISTS (
          SELECT 1 FROM Tickets t WHERE t.id = m.ticketId
        )
      `);

      if (orphanedTicketMessages[0].count > 0) {
        this.results.warnings++;
        console.log(`⚠️  Found ${orphanedTicketMessages[0].count} messages with invalid ticket references`);
      }
      
    } catch (error) {
      // Table might not exist or have different structure
      console.log(`   Skipping ticket message validation`);
    }

    console.log(`   Checked for orphaned records`);
  }

  async validateDataConsistency() {
    // Check for data consistency issues
    
    // Validate contact-message relationship consistency
    const [contactMessageMismatch] = await this.db.query(`
      SELECT c.number, COUNT(DISTINCT m.id) as message_count
      FROM Contacts c
      LEFT JOIN Messages m ON (c.number = m."from" OR c.number = m."to")
      GROUP BY c.number
      HAVING message_count = 0
      LIMIT 10
    `);

    if (contactMessageMismatch.length > 0) {
      console.log(`   Found ${contactMessageMismatch.length} contacts without messages (showing first 10)`);
    }

    // Check for timestamp consistency
    const [timestampIssues] = await this.db.query(`
      SELECT COUNT(*) as count 
      FROM Messages 
      WHERE createdAt > updatedAt
    `);

    if (timestampIssues[0].count > 0) {
      this.results.warnings++;
      console.log(`⚠️  Found ${timestampIssues[0].count} records with createdAt > updatedAt`);
    }

    console.log(`   Validated data consistency`);
  }

  async generateReport() {
    console.log('\n📊 VALIDATION REPORT');
    console.log('='.repeat(50));
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⚠️  Warnings: ${this.results.warnings}`);
    
    if (this.results.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      this.results.errors.forEach(error => {
        console.log(`   ${error.validation}: ${error.error}`);
      });
    }

    const reportData = {
      timestamp: new Date().toISOString(),
      results: this.results,
      summary: {
        overall: this.results.failed === 0 ? 'PASSED' : 'FAILED',
        totalChecks: this.results.passed + this.results.failed,
        criticalIssues: this.results.failed,
        warnings: this.results.warnings
      }
    };

    // Save report to file
    await fs.writeFile(
      './data-integrity-report.json', 
      JSON.stringify(reportData, null, 2)
    );

    console.log('\n📄 Report saved to: data-integrity-report.json');
    
    if (this.results.failed > 0) {
      console.log('\n❌ VALIDATION FAILED - Critical issues found!');
      process.exit(1);
    } else if (this.results.warnings > 0) {
      console.log('\n⚠️  VALIDATION PASSED WITH WARNINGS');
    } else {
      console.log('\n✅ ALL VALIDATIONS PASSED');
    }
  }
}

// Quick validation functions for specific checks
class QuickValidation {
  static async checkJidFormats() {
    console.log('🔍 Quick JID format check...');
    
    const validator = new DataIntegrityValidator();
    await validator.initDatabase();
    
    try {
      await validator.validateJidFormats();
      console.log('✅ JID formats are valid');
    } catch (error) {
      console.log('❌ JID format issues found:', error.message);
    } finally {
      await validator.db.close();
    }
  }

  static async checkOrphanedRecords() {
    console.log('🔍 Quick orphaned records check...');
    
    const validator = new DataIntegrityValidator();
    await validator.initDatabase();
    
    try {
      await validator.validateOrphanedRecords();
      console.log('✅ No critical orphaned records found');
    } catch (error) {
      console.log('❌ Orphaned records found:', error.message);
    } finally {
      await validator.db.close();
    }
  }

  static async checkSessionFiles() {
    console.log('🔍 Quick session files check...');
    
    const validator = new DataIntegrityValidator();
    
    try {
      await validator.validateSessionFiles();
      console.log('✅ Session files are valid');
    } catch (error) {
      console.log('❌ Session file issues found:', error.message);
    }
  }
}

// Main execution
async function main() {
  const command = process.argv[2];
  
  try {
    switch (command) {
      case 'quick-jid':
        await QuickValidation.checkJidFormats();
        break;
      case 'quick-orphaned':
        await QuickValidation.checkOrphanedRecords();
        break;
      case 'quick-sessions':
        await QuickValidation.checkSessionFiles();
        break;
      case 'full':
      default:
        const validator = new DataIntegrityValidator();
        await validator.run();
        break;
    }
  } catch (error) {
    console.error('Validation failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { DataIntegrityValidator, QuickValidation };