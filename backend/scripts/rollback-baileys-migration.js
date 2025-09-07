#!/usr/bin/env node

/**
 * Baileys Migration Rollback Script
 * 
 * Safely rolls back the Baileys 6.7.19 migration if issues are encountered
 * Restores previous state from backups and reverts database changes
 */

const fs = require('fs').promises;
const path = require('path');
const { Sequelize } = require('sequelize');
const readline = require('readline');

class MigrationRollback {
  constructor() {
    this.backupPath = './backup-pre-6.7.19';
    this.logFile = './rollback.log';
    this.db = null;
    this.force = process.argv.includes('--force');
    this.dryRun = process.argv.includes('--dry-run');
  }

  async log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    console.log(logEntry);
    
    try {
      await fs.appendFile(this.logFile, logEntry + '\n');
      if (data) {
        await fs.appendFile(this.logFile, `Data: ${JSON.stringify(data, null, 2)}\n`);
      }
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  async run() {
    try {
      await this.log('info', 'Starting Baileys 6.7.19 migration rollback');
      
      if (this.dryRun) {
        await this.log('info', 'Running in DRY RUN mode - no changes will be made');
      }

      // Verify backup exists
      await this.verifyBackup();
      
      // Ask for confirmation unless force flag is used
      if (!this.force && !this.dryRun) {
        const confirmed = await this.askConfirmation();
        if (!confirmed) {
          await this.log('info', 'Rollback cancelled by user');
          return;
        }
      }

      // Execute rollback steps
      const rollbackSteps = [
        'stopApplication',
        'rollbackDatabase',
        'restoreSessionFiles',
        'restoreConfigurationFiles',
        'restorePackageJson',
        'validateRollback',
        'startApplication'
      ];

      for (const step of rollbackSteps) {
        await this.log('info', `Executing rollback step: ${step}`);
        await this[step]();
        await this.log('info', `Completed rollback step: ${step}`);
      }

      await this.log('info', 'Rollback completed successfully');
      console.log('\n✅ Rollback completed successfully!');
      console.log('📝 Check rollback.log for detailed information');
      
    } catch (error) {
      await this.log('error', 'Rollback failed', { error: error.message, stack: error.stack });
      console.error('\n❌ Rollback failed:', error.message);
      console.error('📝 Check rollback.log for detailed error information');
      process.exit(1);
    }
  }

  async askConfirmation() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      console.log('\n⚠️  WARNING: This will rollback your Baileys installation to the previous version.');
      console.log('   All changes made during the 6.7.19 upgrade will be lost.');
      console.log('   Make sure to stop your application before proceeding.\n');
      
      rl.question('Are you sure you want to proceed with the rollback? (y/N): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  async verifyBackup() {
    await this.log('info', 'Verifying backup integrity');
    
    if (!(await this.fileExists(this.backupPath))) {
      throw new Error(`Backup directory not found: ${this.backupPath}`);
    }

    // Check for essential backup files
    const essentialPaths = [
      path.join(this.backupPath, 'sessions'),
      path.join(this.backupPath, 'package.json')
    ];

    for (const essentialPath of essentialPaths) {
      if (!(await this.fileExists(essentialPath))) {
        throw new Error(`Essential backup file missing: ${essentialPath}`);
      }
    }

    await this.log('info', 'Backup verification completed');
  }

  async stopApplication() {
    if (this.dryRun) {
      await this.log('info', 'DRY RUN: Would stop application');
      return;
    }

    await this.log('info', 'Stopping application');
    
    try {
      // Try to stop PM2 processes
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      try {
        await execAsync('pm2 stop all');
        await this.log('info', 'Stopped PM2 processes');
      } catch (error) {
        await this.log('warn', 'Could not stop PM2 processes (may not be running)');
      }

      // Give processes time to stop
      await new Promise(resolve => setTimeout(resolve, 3000));
      
    } catch (error) {
      await this.log('warn', 'Could not stop application automatically', { error: error.message });
      console.log('\n⚠️  Please manually stop your application before continuing...');
      
      if (!this.force) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        await new Promise((resolve) => {
          rl.question('Press Enter when the application is stopped...', () => {
            rl.close();
            resolve();
          });
        });
      }
    }
  }

  async rollbackDatabase() {
    await this.log('info', 'Rolling back database changes');
    
    try {
      await this.initDatabase();
      
      if (!this.db) {
        await this.log('warn', 'Database not available, skipping database rollback');
        return;
      }

      if (this.dryRun) {
        await this.log('info', 'DRY RUN: Would rollback database changes');
        return;
      }

      // Rollback JID changes (convert back to old format if needed)
      await this.rollbackJidChanges();
      
      // Remove any new tables or columns added in 6.7.19
      await this.rollbackSchemaChanges();
      
    } catch (error) {
      await this.log('error', 'Database rollback failed', { error: error.message });
      throw error;
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
      await this.log('info', 'Database connection established');
      
    } catch (error) {
      await this.log('warn', 'Could not connect to database', { error: error.message });
      this.db = null;
    }
  }

  async rollbackJidChanges() {
    try {
      // This is a careful operation - we only rollback if we're certain
      // Check if we have a backup of the original JID formats
      const backupDbPath = path.join(this.backupPath, 'database-backup.sql');
      
      if (await this.fileExists(backupDbPath)) {
        await this.log('info', 'Restoring database from backup');
        
        // Read and execute backup SQL
        const backupSql = await fs.readFile(backupDbPath, 'utf8');
        await this.db.query(backupSql);
        
      } else {
        await this.log('warn', 'No database backup found, skipping JID rollback');
        await this.log('warn', 'Manual database review may be required');
      }
      
    } catch (error) {
      await this.log('error', 'JID rollback failed', { error: error.message });
      throw error;
    }
  }

  async rollbackSchemaChanges() {
    try {
      // Remove any new tables that might have been added
      const newTables = [
        'PerformanceMetrics',
        'ErrorLogs',
        'JidMappings'
      ];

      for (const table of newTables) {
        try {
          await this.db.query(`DROP TABLE IF EXISTS ${table}`);
          await this.log('info', `Removed table: ${table}`);
        } catch (error) {
          await this.log('warn', `Could not remove table ${table}`, { error: error.message });
        }
      }
      
    } catch (error) {
      await this.log('error', 'Schema rollback failed', { error: error.message });
      throw error;
    }
  }

  async restoreSessionFiles() {
    await this.log('info', 'Restoring session files');
    
    const sessionsBackup = path.join(this.backupPath, 'sessions');
    const sessionsPath = './sessions';
    
    if (!(await this.fileExists(sessionsBackup))) {
      await this.log('warn', 'No sessions backup found, skipping session restore');
      return;
    }

    if (this.dryRun) {
      await this.log('info', 'DRY RUN: Would restore session files');
      return;
    }

    try {
      // Remove current sessions
      if (await this.fileExists(sessionsPath)) {
        await fs.rm(sessionsPath, { recursive: true, force: true });
      }

      // Restore from backup
      await fs.cp(sessionsBackup, sessionsPath, { recursive: true });
      await this.log('info', 'Session files restored successfully');
      
    } catch (error) {
      await this.log('error', 'Session restore failed', { error: error.message });
      throw error;
    }
  }

  async restoreConfigurationFiles() {
    await this.log('info', 'Restoring configuration files');
    
    const configFiles = ['.env', 'ecosystem.config.js'];
    
    for (const configFile of configFiles) {
      const backupFile = path.join(this.backupPath, configFile);
      
      if (await this.fileExists(backupFile)) {
        if (this.dryRun) {
          await this.log('info', `DRY RUN: Would restore ${configFile}`);
          continue;
        }

        try {
          await fs.cp(backupFile, configFile);
          await this.log('info', `Restored ${configFile}`);
        } catch (error) {
          await this.log('warn', `Could not restore ${configFile}`, { error: error.message });
        }
      } else {
        await this.log('info', `No backup found for ${configFile}`);
      }
    }
  }

  async restorePackageJson() {
    await this.log('info', 'Restoring package.json');
    
    const backupPackageJson = path.join(this.backupPath, 'package.json');
    
    if (!(await this.fileExists(backupPackageJson))) {
      throw new Error('package.json backup not found - cannot rollback dependencies');
    }

    if (this.dryRun) {
      await this.log('info', 'DRY RUN: Would restore package.json and reinstall dependencies');
      return;
    }

    try {
      // Restore package.json
      await fs.cp(backupPackageJson, './package.json');
      await this.log('info', 'package.json restored');

      // Reinstall dependencies
      await this.log('info', 'Reinstalling dependencies...');
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      await execAsync('npm install', { cwd: process.cwd() });
      await this.log('info', 'Dependencies reinstalled successfully');
      
    } catch (error) {
      await this.log('error', 'Package.json restore failed', { error: error.message });
      throw error;
    }
  }

  async validateRollback() {
    await this.log('info', 'Validating rollback');
    
    const validationResults = {
      sessionsValid: await this.validateSessions(),
      packageJsonValid: await this.validatePackageJson(),
      configValid: await this.validateConfiguration()
    };

    const allValid = Object.values(validationResults).every(result => result);
    
    if (allValid) {
      await this.log('info', 'Rollback validation passed');
    } else {
      await this.log('error', 'Rollback validation failed', validationResults);
      throw new Error('Rollback validation failed');
    }
  }

  async validateSessions() {
    try {
      const sessionsPath = './sessions';
      
      if (!(await this.fileExists(sessionsPath))) {
        await this.log('warn', 'Sessions directory not found');
        return false;
      }

      const sessionDirs = await fs.readdir(sessionsPath);
      
      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(sessionsPath, sessionDir);
        const stat = await fs.stat(sessionPath);
        
        if (!stat.isDirectory()) continue;
        
        const credPath = path.join(sessionPath, 'creds.json');
        if (!(await this.fileExists(credPath))) {
          await this.log('warn', `Missing creds.json in session: ${sessionDir}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      await this.log('error', 'Session validation failed', { error: error.message });
      return false;
    }
  }

  async validatePackageJson() {
    try {
      const packageJson = JSON.parse(await fs.readFile('./package.json', 'utf8'));
      const baileysVersion = packageJson.dependencies?.['@whiskeysockets/baileys'];
      
      // Check if we're back to the previous version (not 6.7.19)
      if (baileysVersion && baileysVersion.includes('6.7.19')) {
        await this.log('warn', 'Baileys version still shows 6.7.19', { version: baileysVersion });
        return false;
      }
      
      return true;
    } catch (error) {
      await this.log('error', 'Package.json validation failed', { error: error.message });
      return false;
    }
  }

  async validateConfiguration() {
    try {
      // Check if new 6.7.19 specific configurations are removed
      if (await this.fileExists('.env')) {
        const envContent = await fs.readFile('.env', 'utf8');
        
        // These should not be present after rollback
        const newVars = ['PERFORMANCE_MONITORING_ENABLED', 'STRUCTURED_LOGGING'];
        for (const newVar of newVars) {
          if (envContent.includes(newVar)) {
            await this.log('warn', `New environment variable still present: ${newVar}`);
            return false;
          }
        }
      }
      
      return true;
    } catch (error) {
      await this.log('error', 'Configuration validation failed', { error: error.message });
      return false;
    }
  }

  async startApplication() {
    if (this.dryRun) {
      await this.log('info', 'DRY RUN: Would start application');
      return;
    }

    await this.log('info', 'Starting application');
    
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // Try to start PM2 processes
      try {
        await execAsync('pm2 start ecosystem.config.js');
        await this.log('info', 'Started PM2 processes');
      } catch (error) {
        await this.log('warn', 'Could not start PM2 processes automatically');
        console.log('\n⚠️  Please manually start your application');
      }
      
    } catch (error) {
      await this.log('warn', 'Could not start application automatically', { error: error.message });
      console.log('\n⚠️  Please manually start your application');
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// Emergency rollback for critical issues
class EmergencyRollback {
  constructor() {
    this.backupPath = './backup-pre-6.7.19';
  }

  async run() {
    console.log('🚨 EMERGENCY ROLLBACK - Restoring critical files only');
    
    try {
      // Stop everything
      console.log('Stopping all processes...');
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      try {
        await execAsync('pm2 stop all');
        await execAsync('pm2 kill');
      } catch (error) {
        console.log('Could not stop PM2 processes');
      }

      // Restore package.json immediately
      const backupPackageJson = path.join(this.backupPath, 'package.json');
      if (await this.fileExists(backupPackageJson)) {
        await fs.cp(backupPackageJson, './package.json');
        console.log('✅ Restored package.json');
      }

      // Restore sessions
      const sessionsBackup = path.join(this.backupPath, 'sessions');
      if (await this.fileExists(sessionsBackup)) {
        await fs.rm('./sessions', { recursive: true, force: true });
        await fs.cp(sessionsBackup, './sessions', { recursive: true });
        console.log('✅ Restored sessions');
      }

      console.log('🚨 Emergency rollback completed');
      console.log('⚠️  Run full rollback script for complete restoration');
      
    } catch (error) {
      console.error('❌ Emergency rollback failed:', error.message);
      process.exit(1);
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// Main execution
async function main() {
  const command = process.argv[2];
  
  try {
    if (command === 'emergency') {
      const emergency = new EmergencyRollback();
      await emergency.run();
    } else {
      const rollback = new MigrationRollback();
      await rollback.run();
    }
  } catch (error) {
    console.error('Rollback failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { MigrationRollback, EmergencyRollback };