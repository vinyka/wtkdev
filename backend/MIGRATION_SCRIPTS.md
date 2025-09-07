# Migration Scripts Documentation

## Overview

This document provides comprehensive documentation for all migration scripts and utilities created for the Baileys 6.7.19 upgrade. These scripts ensure safe migration, data integrity validation, and rollback capabilities.

## Available Scripts

### 1. Main Migration Script
**File:** `scripts/migrate-baileys-6.7.19.js`
**Purpose:** Handles the complete migration process from Baileys 6.7.0 to 6.7.19

### 2. Data Integrity Validator
**File:** `scripts/validate-data-integrity.js`
**Purpose:** Validates data integrity after migration

### 3. Rollback Script
**File:** `scripts/rollback-baileys-migration.js`
**Purpose:** Safely rolls back the migration if issues are encountered

## Migration Script Usage

### Basic Migration

```bash
# Run the migration
node scripts/migrate-baileys-6.7.19.js

# Dry run (no changes made)
node scripts/migrate-baileys-6.7.19.js --dry-run

# Force migration (skip confirmations)
node scripts/migrate-baileys-6.7.19.js --force

# Verbose output
node scripts/migrate-baileys-6.7.19.js --verbose
```

### Migration Steps

The migration script performs the following steps:

1. **Environment Validation**
   - Checks required directories exist
   - Validates Baileys version in package.json
   - Verifies system requirements

2. **Backup Creation**
   - Creates backup of sessions directory
   - Backs up configuration files
   - Stores backup in `./backup-pre-6.7.19/`

3. **Session File Migration**
   - Updates credential files for 6.7.19 compatibility
   - Applies necessary transformations
   - Preserves existing authentication data

4. **Database JID Migration**
   - Normalizes JIDs from old format (@c.us) to new format (@s.whatsapp.net)
   - Updates contacts, messages, and tickets tables
   - Maintains data integrity during conversion

5. **Configuration Updates**
   - Adds new environment variables for 6.7.19 features
   - Updates application configuration files
   - Preserves existing settings

6. **Migration Validation**
   - Validates session files integrity
   - Checks database consistency
   - Verifies configuration updates

7. **Cleanup**
   - Removes temporary files
   - Optimizes storage usage

### Migration Configuration

The migration script uses the following configuration:

```javascript
const CONFIG = {
  sessionsPath: './sessions',
  backupPath: './backup-pre-6.7.19',
  logFile: './migration.log',
  dryRun: process.argv.includes('--dry-run'),
  force: process.argv.includes('--force'),
  verbose: process.argv.includes('--verbose')
};
```

## Data Integrity Validation

### Full Validation

```bash
# Run complete data integrity check
node scripts/validate-data-integrity.js

# Or explicitly run full validation
node scripts/validate-data-integrity.js full
```

### Quick Validations

```bash
# Check JID formats only
node scripts/validate-data-integrity.js quick-jid

# Check for orphaned records
node scripts/validate-data-integrity.js quick-orphaned

# Check session files only
node scripts/validate-data-integrity.js quick-sessions
```

### Validation Checks

The validator performs these checks:

1. **JID Format Validation**
   - Ensures all JIDs use new format (@s.whatsapp.net)
   - Identifies invalid JID formats
   - Checks for consistency across tables

2. **Contact Integrity**
   - Finds duplicate contacts
   - Validates phone number formats
   - Checks for missing required fields

3. **Message Integrity**
   - Validates message-contact relationships
   - Checks for missing required fields
   - Validates timestamps

4. **Ticket Integrity**
   - Ensures ticket-contact relationships
   - Validates ticket status values
   - Checks for orphaned tickets

5. **Session File Validation**
   - Verifies session directory structure
   - Validates JSON file formats
   - Checks for required credential files

6. **Orphaned Records Check**
   - Finds messages without corresponding contacts
   - Identifies broken relationships
   - Reports data inconsistencies

7. **Data Consistency**
   - Validates cross-table relationships
   - Checks timestamp consistency
   - Ensures referential integrity

### Validation Report

The validator generates a detailed report:

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "results": {
    "passed": 7,
    "failed": 0,
    "warnings": 2,
    "errors": []
  },
  "summary": {
    "overall": "PASSED",
    "totalChecks": 7,
    "criticalIssues": 0,
    "warnings": 2
  }
}
```

## Rollback Script Usage

### Standard Rollback

```bash
# Run rollback with confirmation
node scripts/rollback-baileys-migration.js

# Dry run rollback
node scripts/rollback-baileys-migration.js --dry-run

# Force rollback (skip confirmations)
node scripts/rollback-baileys-migration.js --force
```

### Emergency Rollback

```bash
# Emergency rollback (critical files only)
node scripts/rollback-baileys-migration.js emergency
```

### Rollback Steps

The rollback script performs:

1. **Application Stop**
   - Stops PM2 processes
   - Ensures clean shutdown

2. **Database Rollback**
   - Restores database from backup
   - Reverts JID changes if needed
   - Removes new schema changes

3. **Session Restoration**
   - Restores session files from backup
   - Preserves authentication state

4. **Configuration Restoration**
   - Restores original configuration files
   - Removes 6.7.19 specific settings

5. **Package Restoration**
   - Restores original package.json
   - Reinstalls previous dependencies

6. **Validation**
   - Validates rollback success
   - Ensures system integrity

7. **Application Restart**
   - Restarts application services
   - Verifies functionality

## Error Handling and Recovery

### Common Issues and Solutions

#### Migration Failures

**Issue:** Migration fails during database update
```bash
# Check migration log
cat migration.log

# Validate current state
node scripts/validate-data-integrity.js

# If safe, retry migration
node scripts/migrate-baileys-6.7.19.js --force
```

**Issue:** Session files corruption
```bash
# Restore sessions from backup
cp -r backup-pre-6.7.19/sessions ./sessions

# Re-run migration
node scripts/migrate-baileys-6.7.19.js
```

#### Validation Failures

**Issue:** JID format validation fails
```bash
# Check specific JID issues
node scripts/validate-data-integrity.js quick-jid

# Manual JID fix (if needed)
# Connect to database and run:
# UPDATE Contacts SET number = REPLACE(number, '@c.us', '@s.whatsapp.net');
```

**Issue:** Orphaned records found
```bash
# Check orphaned records
node scripts/validate-data-integrity.js quick-orphaned

# Clean up orphaned records (manual process)
# Review the validation report for specific records to clean
```

#### Rollback Issues

**Issue:** Rollback fails
```bash
# Try emergency rollback
node scripts/rollback-baileys-migration.js emergency

# Manual restoration
cp backup-pre-6.7.19/package.json ./package.json
cp -r backup-pre-6.7.19/sessions ./sessions
npm install
```

### Recovery Procedures

#### Complete System Recovery

1. **Stop all services**
   ```bash
   pm2 stop all
   pm2 kill
   ```

2. **Restore from backup**
   ```bash
   # Restore critical files
   cp backup-pre-6.7.19/package.json ./package.json
   rm -rf sessions
   cp -r backup-pre-6.7.19/sessions ./sessions
   
   # Restore configuration
   cp backup-pre-6.7.19/.env ./.env
   ```

3. **Reinstall dependencies**
   ```bash
   npm install
   ```

4. **Validate restoration**
   ```bash
   node scripts/validate-data-integrity.js quick-sessions
   ```

5. **Restart services**
   ```bash
   pm2 start ecosystem.config.js
   ```

## Best Practices

### Before Migration

1. **Create additional backups**
   ```bash
   # Backup database
   cp database.sqlite database-backup-$(date +%Y%m%d).sqlite
   
   # Backup entire application
   tar -czf app-backup-$(date +%Y%m%d).tar.gz . --exclude=node_modules
   ```

2. **Test in staging environment**
   - Run migration on staging first
   - Validate all functionality
   - Test rollback procedures

3. **Prepare maintenance window**
   - Schedule downtime
   - Notify users
   - Prepare rollback plan

### During Migration

1. **Monitor logs**
   ```bash
   # Watch migration progress
   tail -f migration.log
   ```

2. **Keep backup terminal open**
   - Ready for emergency rollback
   - Monitor system resources

3. **Validate each step**
   ```bash
   # After migration
   node scripts/validate-data-integrity.js
   ```

### After Migration

1. **Monitor application health**
   - Check connection stability
   - Monitor message processing
   - Watch for errors

2. **Performance validation**
   ```bash
   # Check performance metrics
   curl http://localhost:3000/api/performance/metrics
   ```

3. **Keep backups**
   - Don't delete backups immediately
   - Keep for at least 30 days
   - Test restore procedures

## Troubleshooting

### Log Analysis

```bash
# Check migration logs
grep "ERROR" migration.log
grep "WARN" migration.log

# Check validation results
cat data-integrity-report.json | jq '.results'

# Check rollback logs
grep "ERROR" rollback.log
```

### Database Issues

```bash
# Check database connectivity
node -e "
const { Sequelize } = require('sequelize');
const db = new Sequelize(process.env.DATABASE_URL || 'sqlite:database.sqlite');
db.authenticate().then(() => console.log('DB OK')).catch(console.error);
"

# Check table structure
sqlite3 database.sqlite ".schema Contacts"
```

### Session Issues

```bash
# Check session structure
find sessions -name "*.json" -exec echo "=== {} ===" \; -exec head -5 {} \;

# Validate JSON files
find sessions -name "*.json" -exec node -e "
try { 
  JSON.parse(require('fs').readFileSync('{}', 'utf8')); 
  console.log('{} - OK'); 
} catch(e) { 
  console.log('{} - ERROR:', e.message); 
}
" \;
```

## Script Customization

### Environment-Specific Configuration

Create a `migration.config.js` file:

```javascript
module.exports = {
  // Custom paths
  sessionsPath: process.env.SESSIONS_PATH || './sessions',
  backupPath: process.env.BACKUP_PATH || './backup-pre-6.7.19',
  
  // Database configuration
  database: {
    dialect: process.env.DB_DIALECT || 'sqlite',
    storage: process.env.DB_STORAGE || './database.sqlite',
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  },
  
  // Migration options
  options: {
    createBackup: true,
    validateAfterMigration: true,
    cleanupOldFiles: false,
    retryAttempts: 3
  }
};
```

### Custom Validation Rules

Extend the validator:

```javascript
// custom-validations.js
class CustomValidator extends DataIntegrityValidator {
  async validateCustomRules() {
    // Add your custom validation logic
    const [results] = await this.db.query(`
      SELECT COUNT(*) as count FROM CustomTable WHERE condition = 'invalid'
    `);
    
    if (results[0].count > 0) {
      throw new Error(`Found ${results[0].count} invalid custom records`);
    }
  }
}
```

## Support and Maintenance

### Regular Maintenance

1. **Weekly validation**
   ```bash
   # Add to cron
   0 2 * * 0 cd /path/to/app && node scripts/validate-data-integrity.js > weekly-validation.log 2>&1
   ```

2. **Monthly backup cleanup**
   ```bash
   # Remove old backups
   find backup-* -type d -mtime +30 -exec rm -rf {} \;
   ```

3. **Log rotation**
   ```bash
   # Rotate migration logs
   logrotate -f migration-logrotate.conf
   ```

### Getting Help

1. **Check logs first**
   - migration.log
   - rollback.log
   - data-integrity-report.json

2. **Collect system information**
   ```bash
   # System info script
   echo "Node version: $(node --version)"
   echo "NPM version: $(npm --version)"
   echo "Baileys version: $(npm list @whiskeysockets/baileys)"
   echo "Database size: $(du -h database.sqlite)"
   echo "Sessions count: $(find sessions -type d -maxdepth 1 | wc -l)"
   ```

3. **Create support package**
   ```bash
   # Create support bundle
   tar -czf support-$(date +%Y%m%d).tar.gz \
     migration.log \
     rollback.log \
     data-integrity-report.json \
     package.json \
     .env.example
   ```

---

*For additional support, provide the support bundle and detailed reproduction steps.*