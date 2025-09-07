# API Documentation - Baileys 6.7.19 New Features

## Overview

This document provides comprehensive API documentation for all new features and improvements introduced in the Baileys 6.7.19 upgrade.

## Table of Contents

1. [JidLidMapper API](#jidlidmapper-api)
2. [Enhanced Authentication API](#enhanced-authentication-api)
3. [Error Handling APIs](#error-handling-apis)
4. [Performance Monitoring API](#performance-monitoring-api)
5. [Group Management APIs](#group-management-apis)
6. [Enhanced Logging API](#enhanced-logging-api)
7. [Media Processing APIs](#media-processing-apis)

## JidLidMapper API

### Overview
The JidLidMapper provides utilities for handling WhatsApp ID normalization and conversion between JID and LID formats.

### Methods

#### `normalizeJid(jid: string): string`
Normalizes a WhatsApp JID to ensure consistent formatting.

**Parameters:**
- `jid` (string): The raw JID to normalize

**Returns:**
- `string`: The normalized JID

**Example:**
```typescript
import { JidLidMapper } from '../helpers/JidLidMapper';

const rawJid = '5511999999999@c.us';
const normalized = JidLidMapper.normalizeJid(rawJid);
// Returns: '5511999999999@s.whatsapp.net'
```

#### `mapJidToLid(jid: string): string`
Converts a JID to a Local ID for internal processing.

**Parameters:**
- `jid` (string): The JID to convert

**Returns:**
- `string`: The corresponding LID

**Example:**
```typescript
const jid = '5511999999999@s.whatsapp.net';
const lid = JidLidMapper.mapJidToLid(jid);
// Returns: 'lid_5511999999999'
```

#### `mapLidToJid(lid: string): string`
Converts a Local ID back to a JID.

**Parameters:**
- `lid` (string): The LID to convert

**Returns:**
- `string`: The corresponding JID

**Example:**
```typescript
const lid = 'lid_5511999999999';
const jid = JidLidMapper.mapLidToJid(lid);
// Returns: '5511999999999@s.whatsapp.net'
```

#### `validateJidFormat(jid: string): boolean`
Validates if a JID has the correct format.

**Parameters:**
- `jid` (string): The JID to validate

**Returns:**
- `boolean`: True if valid, false otherwise

**Example:**
```typescript
const isValid = JidLidMapper.validateJidFormat('5511999999999@s.whatsapp.net');
// Returns: true
```

## Enhanced Authentication API

### Overview
Enhanced authentication system with improved security and credential management.

### Methods

#### `useMultiFileAuthState(folder: string): Promise<AuthStateResult>`
Creates an enhanced authentication state with additional security features.

**Parameters:**
- `folder` (string): Path to the authentication folder

**Returns:**
- `Promise<AuthStateResult>`: Authentication state object

**AuthStateResult Interface:**
```typescript
interface AuthStateResult {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearCreds: () => Promise<void>; // New in 6.7.19
}
```

**Example:**
```typescript
import { useMultiFileAuthState } from '../helpers/useMultiFileAuthState';

const { state, saveCreds, clearCreds } = await useMultiFileAuthState('./sessions/session-1');

// Use state for socket creation
const sock = makeWASocket({ auth: state });

// Clear credentials on logout
await clearCreds();
```

## Error Handling APIs

### BaileysErrorHandler

#### `handleConnectionError(error: Error): Promise<void>`
Handles connection-related errors with automatic recovery.

**Parameters:**
- `error` (Error): The connection error to handle

**Example:**
```typescript
import { BaileysErrorHandler } from '../helpers/BaileysErrorHandler';

sock.ev.on('connection.update', async (update) => {
  if (update.connection === 'close') {
    await BaileysErrorHandler.handleConnectionError(update.lastDisconnect?.error);
  }
});
```

#### `handleAuthenticationError(error: Error): Promise<void>`
Handles authentication-related errors.

**Parameters:**
- `error` (Error): The authentication error to handle

#### `handleMessageError(error: Error, context: MessageContext): Promise<void>`
Handles message processing errors.

**Parameters:**
- `error` (Error): The message error to handle
- `context` (MessageContext): Context information about the message

### MediaErrorHandler

#### `downloadWithRetry(message: WAMessage, options?: RetryOptions): Promise<Buffer>`
Downloads media with automatic retry mechanism.

**Parameters:**
- `message` (WAMessage): The message containing media
- `options` (RetryOptions, optional): Retry configuration

**RetryOptions Interface:**
```typescript
interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeoutMs?: number;
}
```

**Example:**
```typescript
import { MediaErrorHandler } from '../helpers/MediaErrorHandler';

try {
  const buffer = await MediaErrorHandler.downloadWithRetry(message, {
    maxRetries: 3,
    retryDelay: 1000,
    timeoutMs: 30000
  });
} catch (error) {
  console.log('Download failed after all retries:', error);
}
```

## Performance Monitoring API

### Overview
Comprehensive performance monitoring system for tracking system metrics and performance.

### Methods

#### `getMetrics(): Promise<PerformanceMetrics>`
Retrieves current performance metrics.

**Returns:**
- `Promise<PerformanceMetrics>`: Current system metrics

**PerformanceMetrics Interface:**
```typescript
interface PerformanceMetrics {
  messageProcessing: {
    averageTime: number;
    totalProcessed: number;
    errorsCount: number;
  };
  memoryUsage: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  connectionStats: {
    totalConnections: number;
    activeConnections: number;
    reconnections: number;
  };
}
```

**Example:**
```typescript
import { PerformanceMonitoringService } from '../services/PerformanceMonitoringService';

const metrics = await PerformanceMonitoringService.getMetrics();
console.log('Average processing time:', metrics.messageProcessing.averageTime);
```

#### `startTimer(operation: string): void`
Starts a timer for a specific operation.

**Parameters:**
- `operation` (string): Name of the operation to time

#### `endTimer(operation: string): number`
Ends a timer and returns the duration.

**Parameters:**
- `operation` (string): Name of the operation to end timing

**Returns:**
- `number`: Duration in milliseconds

**Example:**
```typescript
PerformanceMonitoringService.startTimer('message-processing');
// ... process message
const duration = PerformanceMonitoringService.endTimer('message-processing');
console.log('Processing took:', duration, 'ms');
```

#### `recordMetric(name: string, value: number): void`
Records a custom metric.

**Parameters:**
- `name` (string): Metric name
- `value` (number): Metric value

## Group Management APIs

### GroupHandlerService

#### `processGroupMessage(message: WAMessage, sock: WASocket): Promise<void>`
Processes group messages with enhanced optimizations.

**Parameters:**
- `message` (WAMessage): The group message to process
- `sock` (WASocket): The WhatsApp socket instance

#### `updateGroupMetadata(groupId: string, metadata: GroupMetadata): Promise<void>`
Updates group metadata with optimized synchronization.

**Parameters:**
- `groupId` (string): The group ID
- `metadata` (GroupMetadata): The group metadata

### GroupAdminService

#### `addParticipant(groupId: string, participantId: string): Promise<void>`
Adds a participant to a group.

**Parameters:**
- `groupId` (string): The group ID
- `participantId` (string): The participant ID to add

#### `removeParticipant(groupId: string, participantId: string): Promise<void>`
Removes a participant from a group.

**Parameters:**
- `groupId` (string): The group ID
- `participantId` (string): The participant ID to remove

#### `promoteParticipant(groupId: string, participantId: string): Promise<void>`
Promotes a participant to admin.

**Parameters:**
- `groupId` (string): The group ID
- `participantId` (string): The participant ID to promote

### GroupParticipantService

#### `getParticipants(groupId: string): Promise<GroupParticipant[]>`
Retrieves group participants with caching.

**Parameters:**
- `groupId` (string): The group ID

**Returns:**
- `Promise<GroupParticipant[]>`: Array of group participants

## Enhanced Logging API

### Overview
Structured logging system with context and performance tracking.

### Methods

#### `logConnectionEvent(event: ConnectionEvent): void`
Logs connection-related events.

**Parameters:**
- `event` (ConnectionEvent): The connection event to log

**ConnectionEvent Interface:**
```typescript
interface ConnectionEvent {
  type: 'connect' | 'disconnect' | 'reconnect';
  timestamp: Date;
  sessionId: string;
  details?: any;
}
```

#### `logMessageProcessing(message: ProcessedMessage): void`
Logs message processing events.

**Parameters:**
- `message` (ProcessedMessage): The processed message information

#### `logErrorWithContext(error: Error, context: ErrorContext): void`
Logs errors with additional context.

**Parameters:**
- `error` (Error): The error to log
- `context` (ErrorContext): Additional context information

**Example:**
```typescript
import { enhancedLogger } from '../utils/enhancedLogger';

enhancedLogger.logErrorWithContext(error, {
  operation: 'message-processing',
  messageId: message.key.id,
  sessionId: 'session-1'
});
```

## Media Processing APIs

### Enhanced Media Download

#### `downloadMedia(message: WAMessage, options?: DownloadOptions): Promise<Buffer>`
Downloads media with enhanced error handling and retry logic.

**Parameters:**
- `message` (WAMessage): Message containing media
- `options` (DownloadOptions, optional): Download configuration

**DownloadOptions Interface:**
```typescript
interface DownloadOptions {
  timeout?: number;
  retries?: number;
  quality?: 'low' | 'medium' | 'high';
}
```

## REST API Endpoints

### Performance Endpoints

#### `GET /api/performance/metrics`
Retrieves current performance metrics.

**Response:**
```json
{
  "messageProcessing": {
    "averageTime": 150,
    "totalProcessed": 1000,
    "errorsCount": 5
  },
  "memoryUsage": {
    "rss": 128,
    "heapUsed": 64,
    "heapTotal": 128
  },
  "connectionStats": {
    "totalConnections": 10,
    "activeConnections": 8,
    "reconnections": 2
  }
}
```

#### `POST /api/performance/reset`
Resets performance metrics.

**Response:**
```json
{
  "success": true,
  "message": "Performance metrics reset successfully"
}
```

### Group Management Endpoints

#### `GET /api/groups/:groupId/participants`
Retrieves group participants.

**Parameters:**
- `groupId` (string): The group ID

**Response:**
```json
{
  "participants": [
    {
      "id": "5511999999999@s.whatsapp.net",
      "isAdmin": false,
      "isSuperAdmin": false
    }
  ]
}
```

#### `POST /api/groups/:groupId/participants`
Adds a participant to a group.

**Parameters:**
- `groupId` (string): The group ID

**Request Body:**
```json
{
  "participantId": "5511999999999@s.whatsapp.net"
}
```

## Error Responses

### Standard Error Format
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {
      "field": "Additional error details"
    },
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Common Error Codes
- `AUTHENTICATION_ERROR`: Authentication-related errors
- `JID_VALIDATION_ERROR`: JID format validation errors
- `MEDIA_DOWNLOAD_ERROR`: Media download failures
- `GROUP_OPERATION_ERROR`: Group management errors
- `PERFORMANCE_ERROR`: Performance monitoring errors

## Usage Examples

### Complete Integration Example
```typescript
import { makeWASocket } from '@whiskeysockets/baileys';
import { useMultiFileAuthState } from '../helpers/useMultiFileAuthState';
import { JidLidMapper } from '../helpers/JidLidMapper';
import { BaileysErrorHandler } from '../helpers/BaileysErrorHandler';
import { PerformanceMonitoringService } from '../services/PerformanceMonitoringService';

async function initializeWhatsApp() {
  // Enhanced authentication
  const { state, saveCreds, clearCreds } = await useMultiFileAuthState('./sessions/main');
  
  // Create socket with enhanced configuration
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'info' }),
    retryRequestDelayMs: 250,
    maxMsgRetryCount: 5,
  });
  
  // Handle connection updates with error handling
  sock.ev.on('connection.update', async (update) => {
    if (update.connection === 'close') {
      await BaileysErrorHandler.handleConnectionError(update.lastDisconnect?.error);
    }
  });
  
  // Handle messages with performance monitoring
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      PerformanceMonitoringService.startTimer('message-processing');
      
      // Normalize JID
      const normalizedJid = JidLidMapper.normalizeJid(message.key.remoteJid);
      
      // Process message
      await processMessage(message, normalizedJid);
      
      PerformanceMonitoringService.endTimer('message-processing');
    }
  });
  
  // Save credentials
  sock.ev.on('creds.update', saveCreds);
  
  return { sock, clearCreds };
}
```

---

*This documentation covers all new APIs introduced in Baileys 6.7.19 upgrade. For legacy API documentation, refer to the previous version documentation.*