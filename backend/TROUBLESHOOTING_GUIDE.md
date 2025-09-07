# Troubleshooting Guide - Baileys 6.7.19

## Quick Reference

| Issue Type | Symptoms | Quick Fix |
|------------|----------|-----------|
| Authentication | Frequent disconnections, auth errors | Clear credentials and re-authenticate |
| JID Issues | Contact resolution failures | Implement JID normalization |
| Media Problems | Download failures, timeouts | Use retry mechanism |
| Performance | Slow processing, high memory | Enable performance monitoring |
| Connection | Reconnection loops | Check error handling implementation |

## Detailed Troubleshooting

### 1. Authentication Issues

#### Symptoms
- Frequent connection drops
- "Authentication failure" in logs
- Unable to maintain session
- QR code scanning fails repeatedly
- Multi-device conflicts

#### Diagnostic Steps
```bash
# Check auth directory permissions
ls -la backend/sessions/

# Check for corrupted auth files
find backend/sessions/ -name "*.json" -size 0

# Review authentication logs
grep "creds-update" backend/logs/combined.log
grep "connection-update" backend/logs/combined.log
```

#### Solutions

**Solution 1: Clear and Re-authenticate**
```typescript
import { useMultiFileAuthState } from '../helpers/useMultiFileAuthState';

// Clear existing credentials
const { clearCreds } = await useMultiFileAuthState('./sessions/session-id');
await clearCreds();

// Re-scan QR code
// The system will prompt for new QR code
```

**Solution 2: Fix File Permissions**
```bash
# Fix permissions on auth directory
chmod -R 755 backend/sessions/
chown -R $USER:$USER backend/sessions/
```

**Solution 3: Handle Multi-device Conflicts**
```typescript
// In wbot.ts, handle multi-device properly
const sock = makeWASocket({
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger),
  },
  // Ensure proper multi-device handling
  markOnlineOnConnect: false,
  syncFullHistory: false,
});
```

### 2. JID/Contact Resolution Issues

#### Symptoms
- "Invalid JID format" errors
- Contact information not found
- Message routing failures
- Database lookup failures

#### Diagnostic Steps
```typescript
// Check JID format in logs
import { JidLidMapper } from '../helpers/JidLidMapper';

// Validate JID format
const isValid = JidLidMapper.validateJidFormat(suspiciousJid);
console.log('JID valid:', isValid);

// Check normalization
const normalized = JidLidMapper.normalizeJid(rawJid);
console.log('Original:', rawJid);
console.log('Normalized:', normalized);
```

#### Solutions

**Solution 1: Implement JID Normalization**
```typescript
import { JidLidMapper } from '../helpers/JidLidMapper';

// Before any contact operation
const normalizedJid = JidLidMapper.normalizeJid(message.key.remoteJid);

// Use normalized JID for database operations
const contact = await Contact.findOne({ where: { number: normalizedJid } });
```

**Solution 2: Update Database Queries**
```sql
-- Update existing contacts with normalized JIDs
UPDATE Contacts 
SET number = REPLACE(REPLACE(number, '@c.us', '@s.whatsapp.net'), '@g.us', '@g.us')
WHERE number LIKE '%@c.us%';
```

**Solution 3: Batch Normalize Existing Data**
```typescript
// Migration script for existing data
import { JidLidMapper } from '../helpers/JidLidMapper';

async function normalizeExistingContacts() {
  const contacts = await Contact.findAll();
  
  for (const contact of contacts) {
    const normalizedNumber = JidLidMapper.normalizeJid(contact.number);
    if (normalizedNumber !== contact.number) {
      await contact.update({ number: normalizedNumber });
    }
  }
}
```

### 3. Media Processing Issues

#### Symptoms
- Media files not downloading
- "Download timeout" errors
- Corrupted media files
- "Unsupported media type" errors

#### Diagnostic Steps
```typescript
// Check media message structure
console.log('Media message:', JSON.stringify(message, null, 2));

// Test media download
import { MediaErrorHandler } from '../helpers/MediaErrorHandler';

try {
  const buffer = await downloadMediaMessage(message);
  console.log('Download successful, size:', buffer.length);
} catch (error) {
  console.log('Download error:', error.message);
}
```

#### Solutions

**Solution 1: Implement Retry Mechanism**
```typescript
import { MediaErrorHandler } from '../helpers/MediaErrorHandler';

// Use enhanced download with retry
try {
  const buffer = await MediaErrorHandler.downloadWithRetry(message, {
    maxRetries: 3,
    retryDelay: 1000,
    timeoutMs: 30000
  });
} catch (error) {
  console.log('All retry attempts failed:', error);
}
```

**Solution 2: Handle Different Media Types**
```typescript
// Check media type before processing
const mediaType = message.message?.imageMessage ? 'image' :
                 message.message?.videoMessage ? 'video' :
                 message.message?.audioMessage ? 'audio' :
                 message.message?.documentMessage ? 'document' : 'unknown';

if (mediaType === 'unknown') {
  console.log('Unsupported media type');
  return;
}
```

**Solution 3: Increase Timeout Settings**
```typescript
// In wbot.ts, increase timeout settings
const sock = makeWASocket({
  // ... other options
  options: {
    timeout: 60000, // Increase timeout to 60 seconds
  },
  retryRequestDelayMs: 250,
  maxMsgRetryCount: 5,
});
```

### 4. Performance Issues

#### Symptoms
- Slow message processing
- High memory usage
- CPU spikes
- Connection timeouts

#### Diagnostic Steps
```typescript
// Enable performance monitoring
import { PerformanceMonitoringService } from '../services/PerformanceMonitoringService';

// Get current metrics
const metrics = await PerformanceMonitoringService.getMetrics();
console.log('Performance metrics:', metrics);

// Monitor specific operations
PerformanceMonitoringService.startTimer('message-processing');
// ... process message
const duration = PerformanceMonitoringService.endTimer('message-processing');
console.log('Processing took:', duration, 'ms');
```

#### Solutions

**Solution 1: Optimize Cache Settings**
```typescript
// In cache configuration
const cacheConfig = {
  maxSize: 1000, // Limit cache size
  ttl: 300000,   // 5 minutes TTL
  cleanupInterval: 60000, // Cleanup every minute
};
```

**Solution 2: Implement Memory Monitoring**
```typescript
// Monitor memory usage
setInterval(() => {
  const memUsage = process.memoryUsage();
  console.log('Memory usage:', {
    rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB'
  });
}, 30000);
```

**Solution 3: Optimize Message Processing**
```typescript
// Process messages in batches
const processBatch = async (messages: WAMessage[]) => {
  const batchSize = 10;
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    await Promise.all(batch.map(processMessage));
    
    // Small delay between batches to prevent overload
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
```

### 5. Connection Issues

#### Symptoms
- Frequent reconnections
- "Connection lost" errors
- Reconnection loops
- Socket timeout errors

#### Diagnostic Steps
```bash
# Check connection logs
grep "connection-update" backend/logs/combined.log | tail -20

# Monitor network connectivity
ping -c 5 web.whatsapp.com

# Check firewall settings
netstat -tulpn | grep :443
```

#### Solutions

**Solution 1: Implement Enhanced Error Handling**
```typescript
import { BaileysErrorHandler } from '../helpers/BaileysErrorHandler';

sock.ev.on('connection.update', async (update) => {
  const { connection, lastDisconnect } = update;
  
  if (connection === 'close') {
    await BaileysErrorHandler.handleConnectionError(lastDisconnect?.error);
  }
});
```

**Solution 2: Configure Retry Settings**
```typescript
const sock = makeWASocket({
  // ... other options
  retryRequestDelayMs: 250,
  maxMsgRetryCount: 5,
  connectTimeoutMs: 60000,
  defaultQueryTimeoutMs: 60000,
});
```

**Solution 3: Implement Connection Health Check**
```typescript
// Health check function
const checkConnectionHealth = async () => {
  try {
    const status = sock.ws?.readyState;
    if (status !== WebSocket.OPEN) {
      console.log('Connection unhealthy, attempting reconnection');
      await sock.logout();
      // Reconnection will be handled by connection.update event
    }
  } catch (error) {
    console.log('Health check failed:', error);
  }
};

// Run health check every 30 seconds
setInterval(checkConnectionHealth, 30000);
```

### 6. Group Management Issues

#### Symptoms
- Group messages not processing
- Participant updates failing
- Group metadata sync issues
- Admin operations failing

#### Solutions

**Solution 1: Update Group Handling**
```typescript
import { GroupHandlerService } from '../services/WbotServices/GroupHandlerService';

// Use enhanced group handling
await GroupHandlerService.processGroupMessage(message, sock);
```

**Solution 2: Sync Group Metadata**
```typescript
// Force group metadata sync
const groupId = message.key.remoteJid;
const groupMetadata = await sock.groupMetadata(groupId);
await GroupHandlerService.updateGroupMetadata(groupId, groupMetadata);
```

## Debug Mode

### Enable Debug Logging
```typescript
import pino from 'pino';

const logger = pino({ 
  level: 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard'
    }
  }
});

const sock = makeWASocket({
  logger,
  // ... other options
});
```

### Log Analysis Commands
```bash
# Filter specific error types
grep "ERROR" backend/logs/combined.log | grep "authentication"
grep "ERROR" backend/logs/combined.log | grep "media"
grep "ERROR" backend/logs/combined.log | grep "connection"

# Monitor real-time logs
tail -f backend/logs/combined.log | grep -E "(ERROR|WARN)"

# Count error types
grep "ERROR" backend/logs/combined.log | awk '{print $4}' | sort | uniq -c
```

## Emergency Procedures

### Complete System Reset
```bash
# Stop the application
pm2 stop all

# Clear all sessions
rm -rf backend/sessions/*

# Clear logs
> backend/logs/combined.log

# Restart application
pm2 start all
```

### Database Cleanup
```sql
-- Clean up orphaned records
DELETE FROM Messages WHERE contactId NOT IN (SELECT id FROM Contacts);
DELETE FROM Tickets WHERE contactId NOT IN (SELECT id FROM Contacts);

-- Reset contact numbers to normalized format
UPDATE Contacts SET number = REPLACE(number, '@c.us', '@s.whatsapp.net');
```

### Performance Reset
```typescript
// Clear all caches
import { cache } from '../libs/cache';
await cache.flushAll();

// Reset performance metrics
import { PerformanceMonitoringService } from '../services/PerformanceMonitoringService';
await PerformanceMonitoringService.resetMetrics();
```

## Getting Help

### Information to Collect
1. **Error logs** with timestamps
2. **System metrics** (CPU, memory, disk)
3. **Network connectivity** status
4. **Baileys version** and configuration
5. **Steps to reproduce** the issue

### Log Collection Script
```bash
#!/bin/bash
# collect-logs.sh

echo "Collecting troubleshooting information..."

# System info
echo "=== System Information ===" > troubleshoot.log
uname -a >> troubleshoot.log
node --version >> troubleshoot.log
npm --version >> troubleshoot.log

# Application logs
echo "=== Application Logs ===" >> troubleshoot.log
tail -100 backend/logs/combined.log >> troubleshoot.log

# Performance metrics
echo "=== Performance Metrics ===" >> troubleshoot.log
curl -s http://localhost:3000/api/performance/metrics >> troubleshoot.log

# Package info
echo "=== Package Information ===" >> troubleshoot.log
cat backend/package.json | grep -A 5 -B 5 "baileys" >> troubleshoot.log

echo "Information collected in troubleshoot.log"
```

### Support Checklist
- [ ] Reviewed this troubleshooting guide
- [ ] Checked recent logs for errors
- [ ] Verified system requirements
- [ ] Tested with debug logging enabled
- [ ] Collected system information
- [ ] Documented steps to reproduce

---

*For additional support, provide the collected logs and detailed reproduction steps.*