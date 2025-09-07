#!/usr/bin/env node

/**
 * Baileys 6.7.19 Migration Script
 * 
 * This script handles the migration of existing data and configurations
 * to be compatible with Baileys 6.7.19 improvements.
 */

const fs = require('fs').promises;
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const readline = require('readline');

// Configuration
const CONFIG = {
  sessionsPath: './sessions',
  backupPath: './backup-pre-6.7.19',
  logFile: './migration.log',
  dryRun: process.argv.includes('--dry-run'),
  force: process.argv.includes('--force'),
  verbose: process.argv.includes('--verbose')
};

// Logger utility
class MigrationLogger {
  constructor(logFile) {
    this.logFile = logFile;
  }

  async log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    console.log(logEntry);
    if (CONFIG.verbose && data) {
      console.log('Data:', JSON.stringify(data, null, 2));
    }

    try {
      await fs.appendFile(this.logFile, logEntry + '\n');
      if (data) {
        await fs.appendFile(this.logFile, `Data: ${JSON.stringify(data, null, 2)}\n`);
      }
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  info(message, data) { return this.log('info', message, data); }
  warn(message, data) { return this.log('warn', message, data); }
  error(message, data) { return this.log('error', message, data); }
  success(message, data) { return this.log('success', message, data); }
}

// Migration utilities
class MigrationUtils {
  static async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  static async createBackup(sourcePath, backupPath) {
    try {
      await fs.mkdir(backupPath, { recursive: true });
      await fs.cp(sourcePath, backupPath, { recursive: true });
      return true;
    } catch (error) {
      throw new Error(`Backup failed: ${error.message}`);
    }
  }

  static async readJsonFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to read JSON file ${filePath}: ${error.message}`);
    }
  }

  static async writeJsonFile(filePath, data) {
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      throw new Error(`Failed to write JSON file ${filePath}: ${error.message}`);
    }
  }

  static normalizeJid(jid) {
    if (!jid || typeof jid !== 'string') return jid;
    
    // Convert old format to new format
    if (jid.includes('@c.us')) {
      return jid.replace('@c.us', '@s.whatsapp.net');
    }
    
    // Ensure proper group format
    if (jid.includes('@g.us')) {
      return jid; // Group format is still the same
    }
    
    return jid;
  }
}

// Main migration class
class BaileysMigration {
  constructor() {
    this.logger = new MigrationLogger(CONFIG.logFile);
    this.db = null;
    this.migrationSteps = [
      'validateEnvironment',
      'createBackup',
      'migrateSessionFiles',
      'migrateDatabaseJids',
      'updateConfigurations',
      'validateMigration',
      'cleanupOldFiles'
    ];
  }

  async run() {
    try {
      await this.logger.info('Starting Baileys 6.7.19 migration');
      await this.logger.info('Configuration', CONFIG);

      if (CONFIG.dryRun) {
        await this.logger.info('Running in DRY RUN mode - no changes will be made');
      }

      // Ask for confirmation unless force flag is used
      if (!CONFIG.force && !CONFIG.dryRun) {
        const confirmed = await this.askConfirmation();
        if (!confirmed) {
          await this.logger.info('Migration cancelled by user');
          return;
        }
      }

      // Run migration steps
      for (const step of this.migrationSteps) {
        await this.logger.info(`Executing step: ${step}`);
        await this[step]();
        await this.logger.success(`Completed step: ${step}`);
      }

      await this.logger.success('Migration completed successfully');
      
    } catch (error) {
      await this.logger.error('Migration failed', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  async askConfirmation() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('This will migrate your Baileys installation to 6.7.19. Continue? (y/N): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  async validateEnvironment() {
    // Check if required directories exist
    const requiredPaths = [CONFIG.sessionsPath];
    
    for (const reqPath of requiredPaths) {
      if (!(await MigrationUtils.fileExists(reqPath))) {
        throw new Error(`Required path does not exist: ${reqPath}`);
      }
    }

    // Check package.json for Baileys version
    if (await MigrationUtils.fileExists('./package.json')) {
      const packageJson = await MigrationUtils.readJsonFile('./package.json');
      const baileysVersion = packageJson.dependencies?.['@whiskeysockets/baileys'];
      
      if (!baileysVersion || !baileysVersion.includes('6.7.19')) {
        await this.logger.warn('Baileys 6.7.19 not found in package.json', { version: baileysVersion });
      }
    }

    await this.logger.info('Environment validation completed');
  }

  async createBackup() {
    if (CONFIG.dryRun) {
      await this.logger.info('DRY RUN: Would create backup');
      return;
    }

    await this.logger.info('Creating backup of current installation');
    
    // Backup sessions
    if (await MigrationUtils.fileExists(CONFIG.sessionsPath)) {
      await MigrationUtils.createBackup(
        CONFIG.sessionsPath, 
        path.join(CONFIG.backupPath, 'sessions')
      );
    }

    // Backup configuration files
    const configFiles = ['package.json', '.env', 'ecosystem.config.js'];
    for (const configFile of configFiles) {
      if (await MigrationUtils.fileExists(configFile)) {
        await fs.cp(configFile, path.join(CONFIG.backupPath, configFile));
      }
    }

    await this.logger.success('Backup created successfully');
  }

  async migrateSessionFiles() {
    await this.logger.info('Migrating session files');
    
    try {
      const sessionDirs = await fs.readdir(CONFIG.sessionsPath);
      
      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(CONFIG.sessionsPath, sessionDir);
        const stat = await fs.stat(sessionPath);
        
        if (!stat.isDirectory()) continue;
        
        await this.logger.info(`Processing session: ${sessionDir}`);
        await this.migrateSessionDirectory(sessionPath);
      }
      
    } catch (error) {
      await this.logger.error('Failed to migrate session files', { error: error.message });
      throw error;
    }
  }

  async migrateSessionDirectory(sessionPath) {
    // Check for old credential files that might need updating
    const credFiles = ['creds.json', 'keys.json'];
    
    for (const credFile of credFiles) {
      const credPath = path.join(sessionPath, credFile);
      
      if (await MigrationUtils.fileExists(credPath)) {
        await this.logger.info(`Migrating credential file: ${credFile}`);
        
        if (CONFIG.dryRun) {
          await this.logger.info(`DRY RUN: Would migrate ${credPath}`);
          continue;
        }

        try {
          const credData = await MigrationUtils.readJsonFile(credPath);
          
          // Apply any necessary transformations for 6.7.19
          const migratedData = this.migratCredentialData(credData);
          
          if (JSON.stringify(credData) !== JSON.stringify(migratedData)) {
            await MigrationUtils.writeJsonFile(credPath, migratedData);
            await this.logger.info(`Updated credential file: ${credFile}`);
          }
          
        } catch (error) {
          await this.logger.warn(`Failed to migrate ${credFile}`, { error: error.message });
        }
      }
    }
  }

  migratCredentialData(credData) {
    // Apply any necessary credential data transformations
    // This is a placeholder for any credential format changes
    
    if (credData && typeof credData === 'object') {
      // Example: Update any deprecated fields
      if (credData.me && credData.me.jid) {
        credData.me.jid = MigrationUtils.normalizeJid(credData.me.jid);
      }
    }
    
    return credData;
  }

  async migrateDatabaseJids() {
    await this.logger.info('Migrating database JIDs');
    
    try {
      // Initialize database connection
      await this.initDatabase();
      
      if (!this.db) {
        await this.logger.warn('Database not available, skipping JID migration');
        return;
      }

      // Migrate contacts table
      await this.migrateContactsJids();
      
      // Migrate messages table
      await this.migrateMessagesJids();
      
      // Migrate tickets table
      await this.migrateTicketsJids();
      
    } catch (error) {
      await this.logger.error('Database migration failed', { error: error.message });
      throw error;
    } finally {
      if (this.db) {
        await this.db.close();
      }
    }
  }

  async initDatabase() {
    try {
      // Try to load database configuration
      const dbConfig = process.env.DATABASE_URL || {
        dialect: 'sqlite',
        storage: './database.sqlite'
      };

      this.db = new Sequelize(dbConfig, {
        logging: false
      });

      await this.db.authenticate();
      await this.logger.info('Database connection established');
      
    } catch (error) {
      await this.logger.warn('Could not connect to database', { error: error.message });
      this.db = null;
    }
  }

  async migrateContactsJids() {
    try {
      const [results] = await this.db.query(`
        SELECT id, number FROM Contacts 
        WHERE number LIKE '%@c.us%' OR number NOT LIKE '%@%'
      `);

      await this.logger.info(`Found ${results.length} contacts to migrate`);

      if (CONFIG.dryRun) {
        await this.logger.info('DRY RUN: Would update contact JIDs', { count: results.length });
        return;
      }

      let updated = 0;
      for (const contact of results) {
        const normalizedNumber = MigrationUtils.normalizeJid(contact.number);
        
        if (normalizedNumber !== contact.number) {
          await this.db.query(`
            UPDATE Contacts SET number = ? WHERE id = ?
          `, [normalizedNumber, contact.id]);
          updated++;
        }
      }

      await this.logger.success(`Updated ${updated} contact JIDs`);
      
    } catch (error) {
      await this.logger.error('Failed to migrate contact JIDs', { error: error.message });
    }
  }

  async migrateMessagesJids() {
    try {
      const [results] = await this.db.query(`
        SELECT id, fromMe, "from", "to" FROM Messages 
        WHERE "from" LIKE '%@c.us%' OR "to" LIKE '%@c.us%'
      `);

      await this.logger.info(`Found ${results.length} messages to migrate`);

      if (CONFIG.dryRun) {
        await this.logger.info('DRY RUN: Would update message JIDs', { count: results.length });
        return;
      }

      let updated = 0;
      for (const message of results) {
        const normalizedFrom = MigrationUtils.normalizeJid(message.from);
        const normalizedTo = MigrationUtils.normalizeJid(message.to);
        
        if (normalizedFrom !== message.from || normalizedTo !== message.to) {
          await this.db.query(`
            UPDATE Messages SET "from" = ?, "to" = ? WHERE id = ?
          `, [normalizedFrom, normalizedTo, message.id]);
          updated++;
        }
      }

      await this.logger.success(`Updated ${updated} message JIDs`);
      
    } catch (error) {
      await this.logger.error('Failed to migrate message JIDs', { error: error.message });
    }
  }

  async migrateTicketsJids() {
    try {
      // This assumes a tickets table exists - adjust based on your schema
      const [results] = await this.db.query(`
        SELECT t.id, c.number FROM Tickets t
        JOIN Contacts c ON t.contactId = c.id
        WHERE c.number LIKE '%@c.us%'
      `);

      await this.logger.info(`Found ${results.length} tickets with contacts to migrate`);
      
      // Tickets themselves don't need JID updates, but we log the count
      // The contact migration above will handle the actual JID updates
      
    } catch (error) {
      await this.logger.warn('Could not check tickets table', { error: error.message });
    }
  }

  async updateConfigurations() {
    await this.logger.info('Updating configuration files');
    
    // Update environment variables if needed
    await this.updateEnvironmentConfig();
    
    // Update any application-specific configs
    await this.updateApplicationConfig();
  }

  async updateEnvironmentConfig() {
    const envPath = '.env';
    
    if (!(await MigrationUtils.fileExists(envPath))) {
      await this.logger.info('No .env file found, skipping environment config update');
      return;
    }

    if (CONFIG.dryRun) {
      await this.logger.info('DRY RUN: Would update environment configuration');
      return;
    }

    try {
      let envContent = await fs.readFile(envPath, 'utf8');
      let updated = false;

      // Add new environment variables for 6.7.19 features
      const newVars = [
        'PERFORMANCE_MONITORING_ENABLED=true',
        'PERFORMANCE_METRICS_INTERVAL=30000',
        'STRUCTURED_LOGGING=true',
        'CACHE_OPTIMIZATION_ENABLED=true',
        'CACHE_CLEANUP_INTERVAL=300000'
      ];

      for (const newVar of newVars) {
        const [key] = newVar.split('=');
        if (!envContent.includes(key)) {
          envContent += `\n${newVar}`;
          updated = true;
        }
      }

      if (updated) {
        await fs.writeFile(envPath, envContent);
        await this.logger.success('Updated environment configuration');
      } else {
        await this.logger.info('Environment configuration already up to date');
      }
      
    } catch (error) {
      await this.logger.error('Failed to update environment config', { error: error.message });
    }
  }

  async updateApplicationConfig() {
    // Update any application-specific configuration files
    // This is a placeholder for any app-specific config updates
    await this.logger.info('Application configuration update completed');
  }

  async validateMigration() {
    await this.logger.info('Validating migration results');
    
    const validationResults = {
      sessionsValid: await this.validateSessions(),
      databaseValid: await this.validateDatabase(),
      configValid: await this.validateConfiguration()
    };

    const allValid = Object.values(validationResults).every(result => result);
    
    if (allValid) {
      await this.logger.success('Migration validation passed');
    } else {
      await this.logger.error('Migration validation failed', validationResults);
      throw new Error('Migration validation failed');
    }
  }

  async validateSessions() {
    try {
      const sessionDirs = await fs.readdir(CONFIG.sessionsPath);
      
      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(CONFIG.sessionsPath, sessionDir);
        const stat = await fs.stat(sessionPath);
        
        if (!stat.isDirectory()) continue;
        
        // Check if essential files exist
        const credPath = path.join(sessionPath, 'creds.json');
        if (!(await MigrationUtils.fileExists(credPath))) {
          await this.logger.warn(`Missing creds.json in session: ${sessionDir}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      await this.logger.error('Session validation failed', { error: error.message });
      return false;
    }
  }

  async validateDatabase() {
    if (!this.db) {
      await this.logger.info('No database connection, skipping database validation');
      return true;
    }

    try {
      // Check if any old format JIDs remain
      const [oldJids] = await this.db.query(`
        SELECT COUNT(*) as count FROM Contacts WHERE number LIKE '%@c.us%'
      `);

      if (oldJids[0].count > 0) {
        await this.logger.warn(`Found ${oldJids[0].count} contacts with old JID format`);
        return false;
      }

      return true;
    } catch (error) {
      await this.logger.error('Database validation failed', { error: error.message });
      return false;
    }
  }

  async validateConfiguration() {
    // Validate that configuration files are properly updated
    try {
      if (await MigrationUtils.fileExists('.env')) {
        const envContent = await fs.readFile('.env', 'utf8');
        
        // Check for new required variables
        const requiredVars = ['PERFORMANCE_MONITORING_ENABLED', 'STRUCTURED_LOGGING'];
        for (const reqVar of requiredVars) {
          if (!envContent.includes(reqVar)) {
            await this.logger.warn(`Missing environment variable: ${reqVar}`);
            return false;
          }
        }
      }
      
      return true;
    } catch (error) {
      await this.logger.error('Configuration validation failed', { error: error.message });
      return false;
    }
  }

  async cleanupOldFiles() {
    if (CONFIG.dryRun) {
      await this.logger.info('DRY RUN: Would cleanup old files');
      return;
    }

    await this.logger.info('Cleaning up old files');
    
    // This is a placeholder for any cleanup operations
    // Be very careful with file deletion
    
    await this.logger.success('Cleanup completed');
  }
}

// Rollback functionality
class MigrationRollback {
  constructor() {
    this.logger = new MigrationLogger(CONFIG.logFile);
  }

  async rollback() {
    try {
      await this.logger.info('Starting migration rollback');
      
      if (!(await MigrationUtils.fileExists(CONFIG.backupPath))) {
        throw new Error('Backup directory not found. Cannot rollback.');
      }

      // Restore sessions
      const sessionsBackup = path.join(CONFIG.backupPath, 'sessions');
      if (await MigrationUtils.fileExists(sessionsBackup)) {
        await fs.rm(CONFIG.sessionsPath, { recursive: true, force: true });
        await fs.cp(sessionsBackup, CONFIG.sessionsPath, { recursive: true });
        await this.logger.success('Sessions restored from backup');
      }

      // Restore configuration files
      const configFiles = ['package.json', '.env', 'ecosystem.config.js'];
      for (const configFile of configFiles) {
        const backupFile = path.join(CONFIG.backupPath, configFile);
        if (await MigrationUtils.fileExists(backupFile)) {
          await fs.cp(backupFile, configFile);
          await this.logger.success(`Restored ${configFile}`);
        }
      }

      await this.logger.success('Rollback completed successfully');
      
    } catch (error) {
      await this.logger.error('Rollback failed', { error: error.message });
      throw error;
    }
  }
}

// Main execution
async function main() {
  const command = process.argv[2];
  
  try {
    if (command === 'rollback') {
      const rollback = new MigrationRollback();
      await rollback.rollback();
    } else {
      const migration = new BaileysMigration();
      await migration.run();
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { BaileysMigration, MigrationRollback, MigrationUtils };