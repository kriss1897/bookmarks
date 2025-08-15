# Bookmarks Sync Architecture

## Overview

This document outlines the technical architecture for a real-time bookmark synchronization system that enables seamless data sync across multiple devices and browser tabs while maintaining offline-first capabilities.

## System Architecture

### High-Level Components

```
┌─────────────────┐    ┌─────────────────┐
│    Device A     │    │    Device B     │
│  ┌───┐  ┌───┐  │    │  ┌───┐  ┌───┐  │
│  │Ta1│  │Ta2│  │    │  │Tb1│  │Tb2│  │
│  └─┬─┘  └─┬─┘  │    │  └─┬─┘  └─┬─┘  │
│    │      │    │    │    │      │    │
│  ┌─┴──────┴─┐  │    │  ┌─┴──────┴─┐  │
│  │Broadcast │  │    │  │Broadcast │  │
│  │ Channel  │  │    │  │ Channel  │  │
│  └─────┬────┘  │    │  └─────┬────┘  │
│        │       │    │        │       │
│  ┌─────┴────┐  │    │  ┌─────┴────┐  │
│  │ Shared   │  │    │  │ Shared   │  │
│  │ Worker   │  │    │  │ Worker   │  │
│  └─────┬────┘  │    │  └─────┬────┘  │
└────────┼───────┘    └────────┼───────┘
         │                     │
         └──────┬─────┬────────┘
                │     │
         ┌──────▼─────▼──────┐
         │       Server      │
         │   ┌───────────┐   │
         │   │  Database │   │
         │   └───────────┘   │
         └───────────────────┘
```

### Key Technologies

- **Comlink**: RPC communication between tabs and SharedWorker
- **Dexie**: Type-safe IndexedDB operations for local persistence
- **Vite-Comlink**: Worker bundling and development support
- **Broadcast Channel API**: Inter-tab communication
- **Server-Sent Events (SSE)**: Real-time server-to-client updates
- **SharedWorker**: Single connection point per device

## Detailed Component Design

### 1. SharedWorker Implementation

The SharedWorker acts as the central coordination point for each device, managing:

#### Core Responsibilities
- **Connection Management**: Handle multiple tab connections via Comlink
- **Queue Management**: Persist write operations in IndexedDB
- **Sync Processing**: Process queued operations with retry logic
- **Broadcast Coordination**: Distribute updates across tabs

#### Pseudocode Structure
```
class SyncWorker:
  - database: Dexie instance
  - broadcastChannel: BroadcastChannel
  - connections: Set<TabConnection>
  - processingQueue: boolean
  
  initialize():
    - setupDatabase()
    - startQueueProcessor()
    - establishServerConnection()
  
  handleTabConnection(port):
    - wrapWithComlink(port)
    - addToConnections(port)
    - setupMessageHandlers(port)
  
  queueOperation(operation):
    - validateOperation(operation)
    - addToIndexedDB(operation)
    - broadcastToTabs('OPERATION_QUEUED')
    - return operationId
  
  processQueue():
    while processingQueue:
      - operations = getPendingOperations()
      - for each operation:
        - if shouldRetry(operation):
          - attempt = syncToServer(operation)
          - updateStatus(operation, attempt.result)
          - broadcastToTabs('OPERATION_STATUS_CHANGE')
      - sleep(processingInterval)
```

### 2. IndexedDB Queue Management

Using Dexie for robust local persistence with the following schema:

#### Database Schema
```
Database: BookmarksSyncQueue
Version: 2

Stores:
  operations:
    - id (primary key)
    - type: 'CREATE' | 'UPDATE' | 'DELETE'
    - collection: string
    - data: any
    - status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
    - timestamp: number
    - queuedAt: number
    - clientId: string
    - retryCount: number
    - lastAttempt?: number
    - error?: string

Indexes:
  - status (for efficient status-based queries)
  - queuedAt (for chronological ordering)
  - timestamp (for operation ordering)
```

#### Queue Operations
```
QueueManager:
  addOperation(operation):
    - validateOperation(operation)
    - assignId(operation)
    - setStatus(operation, 'PENDING')
    - store.add(operation)
  
  getPendingOperations():
    - return store.where('status').equals('PENDING')
              .orderBy('queuedAt')
  
  updateOperationStatus(id, status, error?):
    - operation = store.get(id)
    - operation.status = status
    - operation.lastAttempt = now()
    - if error: operation.error = error
    - if failed: operation.retryCount++
    - store.put(operation)
  
  cleanupCompleted():
    - cutoff = now() - 24_hours
    - store.where('status').equals('COMPLETED')
          .and(op => op.queuedAt < cutoff)
          .delete()
```

### 3. Tab Communication Layer

Each tab connects to the SharedWorker via Comlink for type-safe RPC communication.

#### React Hook Implementation
```
useSyncWorker():
  state:
    - isConnected: boolean
    - queueStatus: QueueStatus
    - recentOperations: Operation[]
  
  effects:
    - initializeWorker()
    - setupBroadcastChannel()
    - handleWorkerMessages()
  
  methods:
    - queueOperation(operation): Promise<string>
    - retryOperation(operationId): Promise<void>
    - getQueueStatus(): Promise<QueueStatus>
  
  cleanup:
    - closeBroadcastChannel()
    - releaseWorkerProxy()
```

#### Broadcast Channel Integration
```
BroadcastChannelHandler:
  channel: BroadcastChannel('bookmarks-sync')
  
  handleMessage(event):
    switch event.data.type:
      case 'OPERATION_STATUS_CHANGE':
        - updateLocalOperationStatus(event.data.payload)
        - notifyReactComponents()
      
      case 'QUEUE_STATUS_UPDATE':
        - updateQueueMetrics(event.data.payload)
        - refreshUIIndicators()
      
      case 'SERVER_RECONNECTED':
        - triggerQueueProcessing()
        - showConnectedIndicator()
```

### 4. Server Communication

#### Server-Sent Events (SSE) Integration
```
ServerConnection:
  eventSource: EventSource('/api/sync/events')
  
  handleServerEvents():
    eventSource.onmessage = (event) =>
      data = JSON.parse(event.data)
      switch data.type:
        case 'BOOKMARK_CREATED':
        case 'BOOKMARK_UPDATED':
        case 'BOOKMARK_DELETED':
          - broadcastToTabs('SERVER_UPDATE', data)
          - updateLocalCache(data)
    
    eventSource.onerror = () =>
      - scheduleReconnection()
      - notifyConnectionStatus('DISCONNECTED')
```

#### API Endpoints
```
POST /api/sync
  - Receives queued operations from SharedWorker
  - Validates operation integrity
  - Applies to database
  - Broadcasts to other connected devices
  - Returns success/failure status

GET /api/sync/events
  - Establishes SSE connection
  - Streams real-time updates
  - Handles connection lifecycle

GET /api/bookmarks
  - Returns current bookmark state
  - Used for initial sync and conflict resolution
```

### 5. Retry and Error Handling

#### Retry Strategy
```
RetryPolicy:
  maxRetries: 3
  baseDelay: 5000ms
  backoffMultiplier: 2
  
  shouldRetry(operation):
    return operation.retryCount < maxRetries
           AND operation.lastAttempt + calculateDelay() < now()
  
  calculateDelay(retryCount):
    return baseDelay * (backoffMultiplier ^ retryCount)
```

#### Error Categories
```
NetworkError:
  - Temporary connectivity issues
  - Server unavailable
  - Timeout errors
  → Strategy: Retry with exponential backoff

ValidationError:
  - Invalid operation data
  - Schema violations
  - Unauthorized operations
  → Strategy: Mark as permanently failed, notify user

ConflictError:
  - Concurrent modifications
  - Stale data updates
  → Strategy: Implement conflict resolution strategy
```

### 6. Conflict Resolution

#### Strategy Implementation
```
ConflictResolver:
  detectConflict(localOp, serverState):
    if localOp.timestamp < serverState.lastModified:
      return ConflictType.STALE_UPDATE
    
    if localOp.targetExists != serverState.exists:
      return ConflictType.EXISTENCE_MISMATCH
    
    return ConflictType.NONE
  
  resolveConflict(conflict):
    switch conflict.type:
      case STALE_UPDATE:
        - mergeChanges(conflict.local, conflict.server)
        - createMergedOperation()
      
      case EXISTENCE_MISMATCH:
        - if server.exists: applyUpdate()
        - else: convertToCreate()
      
      case CONCURRENT_MODIFICATION:
        - useLastWriterWins()
        - notifyUserOfConflict()
```

## Data Flow Patterns

### 1. Write Operation Flow
```
Tab → queueOperation() → SharedWorker → IndexedDB → ProcessQueue() → Server → Broadcast
                                                                              ↓
Other Tabs ← BroadcastChannel ← SharedWorker ← SSE ← Server ← Database Update
```

### 2. Real-time Update Flow
```
External Change → Server → Database → SSE → SharedWorker → BroadcastChannel → All Tabs
```

### 3. Offline Recovery Flow
```
Network Available → SharedWorker → ProcessQueue() → Retry Failed Operations → Server Sync
```

## Performance Considerations

### Memory Management
- **Operation Cleanup**: Remove completed operations older than 24 hours
- **Connection Pooling**: Reuse SharedWorker connections across tabs
- **Batch Processing**: Group multiple operations for efficient server communication

### Storage Optimization
- **IndexedDB Limits**: Monitor storage quota usage
- **Data Compression**: Compress large operation payloads
- **Index Strategy**: Optimize for common query patterns

### Network Efficiency
- **Request Batching**: Combine multiple operations into single requests
- **Compression**: Use gzip for API communication
- **Connection Reuse**: Maintain persistent SSE connections

## Security Considerations

### Data Validation
- **Input Sanitization**: Validate all operation data before storage
- **Schema Enforcement**: Ensure operations conform to expected structure
- **Size Limits**: Prevent oversized payloads

### Authentication
- **Token Management**: Handle auth token refresh in SharedWorker
- **Session Validation**: Verify user permissions for operations
- **Cross-Tab Security**: Ensure secure message passing

## Monitoring and Debugging

### Logging Strategy
```
Logger:
  levels: DEBUG, INFO, WARN, ERROR
  
  logOperation(operation, status):
    - timestamp
    - operationId
    - type and collection
    - client information
    - performance metrics
  
  logError(error, context):
    - error details
    - operation context
    - retry information
    - user impact assessment
```

### Metrics Collection
- **Queue Depth**: Number of pending operations
- **Processing Latency**: Time from queue to completion
- **Error Rates**: Failure percentages by error type
- **Sync Lag**: Time between local change and cross-device sync

## Testing Strategy

### Unit Testing
- SharedWorker operation handling
- IndexedDB queue management
- Retry logic validation
- Conflict resolution algorithms

### Integration Testing
- Tab-to-SharedWorker communication
- Server synchronization flows
- Cross-device sync verification
- Network failure scenarios

### End-to-End Testing
- Multi-tab bookmark operations
- Offline/online transitions
- Device synchronization
- Concurrent user scenarios

## Deployment Considerations

### Environment Configuration
```
Development:
  - Hot reload for SharedWorker
  - Extended logging
  - Relaxed retry limits

Production:
  - Optimized bundle sizes
  - Error reporting integration
  - Performance monitoring
```

### Browser Compatibility
- **SharedWorker Support**: Fallback strategies for unsupported browsers
- **IndexedDB Features**: Use compatible Dexie version
- **Broadcast Channel**: Polyfill where necessary

## Future Enhancements

### Planned Features
1. **Conflict Resolution UI**: User-friendly conflict resolution interface
2. **Sync Analytics**: Detailed synchronization health metrics
3. **Selective Sync**: Allow users to choose what data to sync
4. **Compression**: Optimize payload sizes for large bookmark collections
5. **Encryption**: End-to-end encryption for sensitive bookmark data

### Scalability Improvements
1. **Sharding**: Partition data for large user bases
2. **CDN Integration**: Distributed sync servers
3. **Event Sourcing**: Audit trail for all bookmark changes
4. **Real-time Collaboration**: Live editing capabilities

## Conclusion

This architecture provides a robust, scalable foundation for real-time bookmark synchronization with strong offline capabilities. The combination of SharedWorker, IndexedDB, and Server-Sent Events creates an efficient system that minimizes resource usage while maintaining data consistency across devices and tabs.

The implementation prioritizes reliability through comprehensive error handling, retry mechanisms, and conflict resolution, while maintaining excellent developer experience through type-safe APIs and modern tooling integration.
