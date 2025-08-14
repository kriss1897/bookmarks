# Bookmark App Refactor Plan: Operation-Based Architecture

## Overview

This refactor moves from IndexedDB-as-primary-storage to an operation-based architecture where:
- **Server**: Maintains current state, processes operations, broadcasts to clients
- **Client**: Keeps state in memory, queues operations in IndexedDB, syncs when online
- **Sync**: HTTP for sending operations, SSE for receiving operations from other clients

**CONSTRAINT**: Reuse the existing shared worker infrastructure (`client/src/workers/`) - only modify business logic and content, not the overall architecture. The existing Comlink-based setup with DatabaseManager, ConnectionManager, EventManager, SyncManager, and OperationProcessor should be preserved and adapted for the new operation-based approach.

## Phase 1: Foundation Setup

### 1.1 Server Foundation
- [ ] Create operation types and interfaces
  - [ ] Create `server/src/types/operations.ts`
  - [ ] Define `Operation` interface with id, type, namespace, payload, clientId, timestamp
  - [ ] Define operation types: CREATE_BOOKMARK, CREATE_FOLDER, UPDATE_BOOKMARK, UPDATE_FOLDER, DELETE_BOOKMARK, DELETE_FOLDER, MOVE_BOOKMARK, MOVE_FOLDER
  - [ ] Define validation schemas for each operation type

- [ ] Create operation validation system
  - [ ] Create `server/src/services/OperationValidator.ts`
  - [ ] Implement operation structure validation
  - [ ] Implement payload validation per operation type
  - [ ] Implement namespace access validation

- [ ] Create operation deduplication system
  - [ ] Add `operation_log` table to database schema with operation metadata
  - [ ] Create `server/src/services/OperationDeduplicator.ts`
  - [ ] Implement operation ID checking and storage per endpoint
  - [ ] Add client ID and timestamp tracking for each operation type

- [ ] Create operation service per entity type
  - [ ] Create `server/src/services/bookmark.service.ts`
  - [ ] Create `server/src/services/folder.service.ts`
  - [ ] Implement operation methods: `createBookmark()`, `updateBookmark()`, `deleteBookmark()`, `moveBookmark()`
  - [ ] Implement operation methods: `createFolder()`, `updateFolder()`, `deleteFolder()`, `moveFolder()`
  - [ ] Add proper error handling and transaction support for each operation type

### 1.2 Client Foundation
- [ ] Create operation types (shared with server)
  - [ ] Create `client/src/types/operations.ts` (copy from server)
  - [ ] Ensure type compatibility between client and server

- [ ] Adapt existing shared worker for operation-based architecture
  - [ ] Modify `client/src/workers/shared-worker.ts` to use memory-first state management
  - [ ] Update WorkerAPI interface in `client/src/workers/worker-types.ts` for operation-based methods
  - [ ] Keep existing Comlink setup and port management

- [ ] Adapt existing database manager for operation queue only
  - [ ] Modify `client/src/workers/database-manager.ts` to focus on operation queue
  - [ ] Remove bookmark/folder storage tables, keep only operations table
  - [ ] Adapt methods: `enqueue()`, `getPending()`, `markSynced()`, `markFailed()`
  - [ ] Keep existing IndexedDB setup and transaction handling

- [ ] Create memory state manager in shared worker
  - [ ] Create `client/src/workers/memory-state-manager.ts` (new file)
  - [ ] Implement namespace-based state storage in memory within shared worker
  - [ ] Methods: `setState()`, `getState()`, `applyOperation()`
  - [ ] Integrate with existing EventManager for state change broadcasts

- [ ] Adapt existing operation processor
  - [ ] Modify `client/src/workers/operation-processor.ts` for endpoint-specific operations
  - [ ] Update to apply operations to memory state instead of IndexedDB
  - [ ] Keep existing operation validation and processing logic
  - [ ] Adapt for different operation types: bookmark operations vs folder operations
  - [ ] Update operation queue to store endpoint-specific operation metadata
  - [ ] Integrate with new memory state manager

## Phase 2: Core Sync Infrastructure

### 2.1 Server Operation Endpoints
- [ ] Adapt existing bookmark endpoints for operation-based architecture
  - [ ] ✅ `POST /api/bookmarks/:namespace/bookmarks` (create bookmark) - **EXISTS**
  - [ ] ✅ `POST /api/bookmarks/:namespace/folders` (create folder) - **EXISTS**
  - [ ] ✅ `PUT /api/bookmarks/:namespace/items/:itemId/move` (move item) - **EXISTS**
  - [ ] ✅ `DELETE /api/bookmarks/:namespace/items/:itemId` (delete item) - **EXISTS**
  - [ ] 🔄 `PUT /api/bookmarks/:namespace/bookmarks/:bookmarkId` (update bookmark) - **NEEDS IMPLEMENTATION**
  - [ ] 🔄 `PUT /api/bookmarks/:namespace/folders/:folderId` (update folder) - **NEEDS IMPLEMENTATION**
  - [ ] ✅ `PUT /api/bookmarks/:namespace/folders/:folderId/toggle` (toggle folder) - **EXISTS**
  - [ ] ✅ `PUT /api/bookmarks/:namespace/bookmarks/:bookmarkId/favorite` (toggle favorite) - **EXISTS**

- [ ] Create separate folder-specific endpoints (optional refactor)
  - [ ] 🔄 Extract folder operations to `server/src/controllers/folder.controller.ts`
  - [ ] 🔄 Create clean REST endpoints: `POST /api/:namespace/folders`, `PUT /api/:namespace/folders/:id`
  - [ ] 🔄 Create clean REST endpoints: `DELETE /api/:namespace/folders/:id`, `POST /api/:namespace/folders/:id/move`
  - [ ] Note: Current BookmarkController handles both bookmarks and folders

- [ ] Adapt existing operation processing
  - [ ] ✅ Bulk operation endpoint: `POST /api/sync/:namespace/operations` - **EXISTS**
  - [ ] 🔄 Adapt SyncController operation processing for individual endpoint calls
  - [ ] 🔄 Move operation validation logic from SyncController to individual endpoints
  - [ ] 🔄 Ensure each endpoint broadcasts appropriate SSE events (already implemented)

- [ ] Update operation validation per endpoint
  - [ ] ✅ Existing validation in BookmarkController - **REUSE**
  - [ ] 🔄 Extract validation logic to dedicated services: `BookmarkValidator.ts`, `FolderValidator.ts`
  - [ ] 🔄 Enhance payload validation schemas per operation type
  - [ ] ✅ Namespace access validation already implemented - **REUSE**

- [ ] Adapt state fetching endpoint
  - [ ] ✅ `GET /api/bookmarks/:namespace` endpoint exists - **REUSE**
  - [ ] ✅ Proper namespace isolation already implemented - **REUSE**
  - [ ] ✅ Returns bookmark/folder tree structure - **CURRENT FUNCTIONALITY**
  - [ ] 🔄 Consider renaming to `/api/:namespace/items` for consistency

- [ ] Adapt SSE broadcasting system
  - [ ] ✅ EventPublisher already broadcasts operation-specific events - **REUSE**
  - [ ] ✅ Events: `folder_created`, `bookmark_created`, `item_moved`, `item_deleted`, etc. - **EXISTS**
  - [ ] ✅ SSE connection via `/api/events` endpoint - **EXISTS**
  - [ ] ✅ Namespace-based event broadcasting already implemented - **REUSE**
  - [ ] ✅ Operation metadata and affected item data already included - **CURRENT FUNCTIONALITY**

### 2.2 Client Connection Management
- [ ] Adapt existing connection manager for endpoint-specific requests
  - [ ] ✅ **ConnectionManager** - SSE connection handling already excellent - **REUSE**
  - [ ] ✅ Online/offline detection and retry logic already robust - **REUSE**
  - [ ] ✅ Reconnection with exponential backoff already implemented - **REUSE**
  - [ ] ✅ SSE event handling for operation types already exists - **REUSE**
  - [ ] ✅ Multi-namespace connection management already implemented - **REUSE**
  - [ ] 🔄 Update for individual endpoint requests (currently uses bulk sync endpoint)

- [ ] Adapt existing event manager for memory state updates
  - [ ] ✅ **EventManager** - Event subscription and broadcasting system perfect - **REUSE**
  - [ ] ✅ Handles operation-specific SSE events: `folder_created`, `bookmark_created`, `item_moved`, etc. - **REUSE**
  - [ ] ✅ Event handler registration and cleanup already implemented - **REUSE**
  - [ ] 🔄 **MAJOR CHANGE**: Currently updates IndexedDB directly - **ADAPT TO UPDATE MEMORY STATE**
  - [ ] 🔄 Remove `handleServerStateUpdate()` IndexedDB logic, replace with memory state calls
  - [ ] ✅ Event emission to UI threads already works perfectly - **REUSE**

- [ ] Adapt existing sync manager for endpoint-specific requests
  - [ ] ✅ **SyncManager** - Batch processing and retry logic excellent - **REUSE**
  - [ ] ✅ Sync status tracking and event emission already robust - **REUSE**
  - [ ] ✅ Pending operation counting and management already implemented - **REUSE**
  - [ ] 🔄 **MAJOR CHANGE**: Currently sends to bulk `/api/sync/:namespace/operations` endpoint
  - [ ] 🔄 **ADAPT**: Send individual operations to specific endpoints: POST /bookmarks, PUT /bookmarks/:id, etc.
  - [ ] 🔄 **ADAPT**: Replace bulk operation processing with individual request builders
  - [ ] ✅ Error handling and retry mechanisms already excellent - **REUSE**

- [ ] Update existing worker bridge communication
  - [ ] ✅ **BookmarkAPI** - Comlink proxy setup already excellent - **REUSE**
  - [ ] ✅ Connection establishment and error handling already robust - **REUSE**
  - [ ] ✅ Namespace initialization and subscription logic already good - **REUSE**
  - [ ] 🔄 **MAJOR CHANGE**: Currently uses `offlineWorkerService` and `localDataService`
  - [ ] 🔄 **ADAPT**: Replace with direct shared worker calls via Comlink
  - [ ] 🔄 **ADAPT**: Update method implementations to use memory state instead of IndexedDB reads
  - [ ] ✅ Operation enqueueing pattern already correct - **REUSE PATTERN**

## Phase 3: Client Integration

### 3.1 Update BookmarkAPI
- [ ] Adapt existing BookmarkAPI for endpoint-specific operations
  - [ ] Modify `client/src/services/bookmarkAPI.ts` (existing Comlink bridge)
  - [ ] Replace current method implementations with endpoint-specific operation calls
  - [ ] Update methods: `createBookmark()` → POST /bookmarks, `updateBookmark()` → PUT /bookmarks/:id
  - [ ] Update methods: `createFolder()` → POST /folders, `moveItem()` → POST /folders/:id/move or /bookmarks/:id/move
  - [ ] Keep existing Comlink proxy setup and connection handling
  - [ ] Add optimistic updates in main thread for immediate UI feedback

- [ ] Update client initialization in existing worker
  - [ ] Modify initialization in `client/src/workers/shared-worker.ts`
  - [ ] Adapt to fetch server state into memory instead of IndexedDB
  - [ ] Update existing operation queue processing for memory state
  - [ ] Keep existing SSE setup and Comlink port management
  - [ ] Maintain existing namespace handling and event emission

- [ ] Create main thread state synchronization
  - [ ] Create `client/src/services/StateSync.ts` (new service)
  - [ ] Subscribe to state changes from existing EventManager
  - [ ] Handle state updates and trigger UI re-renders
  - [ ] Implement efficient state diffing to minimize updates
  - [ ] Use existing Comlink proxy for worker communication

### 3.2 State Reconciliation
- [ ] Create reconciliation service using existing infrastructure
  - [ ] Create `client/src/workers/reconciliation-service.ts` (new file in existing workers)
  - [ ] Implement smart conflict resolution strategies for memory state
  - [ ] Handle invalid operation references (items that no longer exist)
  - [ ] Implement operation adaptation (e.g., move to root if target folder missing)
  - [ ] Integrate with existing EventManager for conflict notifications

- [ ] Add conflict resolution UI bridge using existing Comlink
  - [ ] Extend existing WorkerAPI interface for conflict resolution methods
  - [ ] Use existing Comlink proxy for conflict notification communication
  - [ ] Add user options for handling conflicts: apply anyway, skip, review
  - [ ] Implement "reset and refetch" mechanism using existing connection infrastructure
  - [ ] Ensure conflict resolution UI appears in the active tab

### 3.3 Update UI Components
- [ ] Update BookmarkManager component for existing worker bridge
  - [ ] Modify `client/src/components/BookmarkManager.tsx`
  - [ ] Replace current worker calls with new operation-based worker methods
  - [ ] Keep existing Comlink proxy usage patterns
  - [ ] Update all user actions to use adapted worker API
  - [ ] Add loading states and error handling for operation workflow

- [ ] Update other components for existing worker integration
  - [ ] Modify `client/src/components/BookmarkTreeNode.tsx`
  - [ ] Update any other components that interact with the existing worker
  - [ ] Ensure all reads use existing worker state subscription methods
  - [ ] Ensure all writes go through existing worker operation methods
  - [ ] Add proper loading/error states for existing worker communication

## Phase 4: Advanced Features

### 4.1 Error Handling and Monitoring
- [ ] Add comprehensive error handling
  - [ ] Create error boundary components for operation failures
  - [ ] Implement worker error recovery and restart mechanisms
  - [ ] Add user-friendly error messages with worker communication failures
  - [ ] Add retry mechanisms for failed operations

- [ ] Add operation monitoring
  - [ ] Create developer tools for monitoring operation queue in shared worker
  - [ ] Add performance metrics for sync operations and worker communication
  - [ ] Implement operation success/failure analytics
  - [ ] Add tab-specific operation tracking

### 4.2 Performance Optimizations
- [ ] Implement operation batching in shared worker
  - [ ] Batch multiple operations in single HTTP request
  - [ ] Implement intelligent batching delays
  - [ ] Coordinate batching across multiple tabs

- [ ] Add state caching optimizations
  - [ ] Implement smart memory state updates in shared worker
  - [ ] Add state diffing to minimize UI re-renders across tabs
  - [ ] Optimize worker message passing with state diffs

- [ ] Optimize for large datasets
  - [ ] Add pagination for initial state fetching if needed
  - [ ] Implement virtual scrolling for large bookmark lists
  - [ ] Optimize worker memory usage for large state objects

## Phase 5: Testing and Validation

### 5.1 Unit Testing
- [ ] Test operation applier functions
  - [ ] Test each operation type application
  - [ ] Test edge cases and error conditions
  - [ ] Test operation validation logic

- [ ] Test adapted shared worker components
  - [ ] Test modified DatabaseManager operation queue functionality
  - [ ] Test adapted ConnectionManager online/offline transitions
  - [ ] Test updated EventManager for operation event handling
  - [ ] Test modified SyncManager for operation-based requests
  - [ ] Test new MemoryStateManager functionality

- [ ] Test existing worker bridge with new operation methods
  - [ ] Test existing Comlink communication with updated API
  - [ ] Test error handling in existing worker communication patterns
  - [ ] Test worker restart and recovery using existing infrastructure

### 5.2 Integration Testing
- [ ] Test multi-tab scenarios with existing shared worker
  - [ ] Test real-time operation broadcasting using existing EventManager
  - [ ] Test conflict resolution across multiple tabs
  - [ ] Test offline/online sync coordination using existing ConnectionManager
  - [ ] Test tab closure and new tab scenarios with existing port management

- [ ] Test error scenarios with existing infrastructure
  - [ ] Test network failures during operation sync using existing retry logic
  - [ ] Test server restart scenarios with existing reconnection handling
  - [ ] Test existing shared worker failure and recovery mechanisms
  - [ ] Test client state corruption recovery using existing error handling

### 5.3 End-to-End Testing
- [ ] Test complete user workflows across tabs with existing worker
  - [ ] Test bookmark creation, editing, deletion flows using adapted worker API
  - [ ] Test folder operations and moving items using existing operation infrastructure
  - [ ] Test offline work and subsequent sync with existing sync mechanisms

- [ ] Test edge cases with existing infrastructure
  - [ ] Test concurrent operations from multiple tabs using existing coordination
  - [ ] Test large operation queues with existing batch processing
  - [ ] Test rapid online/offline transitions with existing connection management
  - [ ] Test browser restart with existing port restoration and state recovery

## Phase 6: Migration and Cleanup

### 6.1 Database Migration
- [ ] Create fresh database setup
  - [ ] Update database schema to remove unnecessary tables
  - [ ] Add operation_log table for deduplication
  - [ ] Create database setup scripts for fresh installations

### 6.2 Remove Legacy Code
- [ ] Remove server legacy files
  - [ ] Remove `server/src/controllers/api.controller.ts` (replace with individual bookmark/folder controllers)
  - [ ] Remove old generic `server/src/controllers/bookmark.controller.ts` if it exists (replace with operation-specific version)
  - [ ] Remove `server/src/controllers/sync.controller.ts` (functionality moved to individual endpoints)
  - [ ] Remove `server/src/services/EventPublisher.ts` (integrate into individual endpoint controllers)
  - [ ] Remove redundant services and models not needed for endpoint-specific approach

- [ ] Remove client legacy files
  - [ ] Remove `client/src/services/localDataService.ts`
  - [ ] Remove `client/src/services/localDB.ts` (functionality moved to adapted DatabaseManager)
  - [ ] Remove `client/src/services/offlineWorkerService.ts` (functionality integrated into existing worker)
  - [ ] Remove `client/src/workers.old/` directory (keep existing `client/src/workers/` with adaptations)
  - [ ] Keep and adapt `client/src/contexts/WorkerConnectionContext.tsx` for new operation-based API
  - [ ] Remove unused hooks and components not compatible with adapted worker pattern

- [ ] Remove legacy documentation
  - [ ] Remove `docs/offline-first-implementation-plan.md`
  - [ ] Remove `docs/client-implementation.md`
  - [ ] Remove `docs/server-implementation.md`
  - [ ] Remove `docs/why-yjs.md`
  - [ ] Update remaining documentation for new architecture

### 6.3 Final Cleanup and Optimization
- [ ] Code review and cleanup
  - [ ] Remove any remaining unused imports and variables
  - [ ] Optimize bundle size by removing unused dependencies
  - [ ] Update TypeScript configurations if needed

- [ ] Documentation update
  - [ ] Create new architecture documentation
  - [ ] Update API documentation
  - [ ] Create troubleshooting guide for common sync issues

- [ ] Performance validation
  - [ ] Benchmark new architecture vs old
  - [ ] Validate memory usage improvements
  - [ ] Confirm faster UI responsiveness

## Success Criteria

- [ ] **Functionality**: All bookmark operations work correctly across multiple tabs
- [ ] **Real-time sync**: Changes appear instantly across multiple clients AND multiple tabs
- [ ] **Offline support**: Operations work offline and sync when reconnected, coordinated across tabs
- [ ] **Multi-tab coordination**: Changes in one tab appear immediately in other tabs, even offline
- [ ] **Conflict resolution**: Conflicts are handled gracefully with user feedback, coordinated across tabs
- [ ] **Performance**: UI is more responsive, no IndexedDB read bottlenecks, efficient worker communication
- [ ] **Reliability**: No data loss during network issues, conflicts, or tab closures
- [ ] **Code quality**: Cleaner, simpler codebase with clear separation of concerns and proper worker architecture

## Rollback Plan

If critical issues arise:
- [ ] Keep git tags at each major phase for easy rollback
- [ ] Maintain feature flags to switch between old and new systems
- [ ] Have database backup and restore procedures ready
- [ ] Document common issues and their solutions

---

**Estimated Timeline**: 3-4 weeks for complete refactor
**Risk Level**: Medium (architectural change but well-planned)
**Dependencies**: None (fresh start approach)
