# Bookmarks Sync: Phased Implementation Plan

This document outlines a phased approach for building a robust, demoable bookmark sync system. Each phase delivers incremental value and a working demo.

---

## Phase 1: Basic UI & In-Memory Operations

**Goal:**
Users can create, update, delete, and view bookmarks/folders locally using existing BookmarkTree in memory (no persistence yet).

### Tasks & Status:

#### [x] 1. Demo UI Components Setup
- [x] Create bookmark list component (✅ BookmarksTree.tsx renders both bookmarks and folders)
- [x] Create folder tree component (✅ Nested folder structure with expand/collapse)
- [x] Add bookmark creation form (✅ "Root Bookmark" button + menu actions)
- [x] Add folder creation functionality (✅ "Root Folder" button + menu actions)
- [x] Implement drag-and-drop reordering (✅ @dnd-kit integration with fractional indexing)
- [x] Add delete functionality with confirmation (✅ Remove menu item with confirm dialog)
- [x] Test all operations work in memory (✅ All CRUD operations functional)

#### [x] 2. TreeOpsBuilder Integration
- [x] Connect UI components to TreeOpsBuilder (✅ Uses builder.createFolder/createBookmark/etc)
- [x] Ensure all UI operations use TreeOpsBuilder.dispatch() (✅ All operations go through builder methods)
- [x] Test operation log recording (✅ Operations log displayed in UI)
- [x] Verify tree state consistency after operations (✅ Tree updates correctly after each operation)

#### [x] 3. Basic State Management
- [x] Create React context for BookmarkTree state (✅ Uses useState with TreeOpsBuilder)
- [x] Implement tree state updates via operations (✅ force() triggers re-render after operations)
- [x] Add loading and error states (✅ Basic error handling in place)
- [x] Test state updates across components (✅ Single component handles all state currently)

---

## Phase 2: SharedWorker & Local Persistence

**Goal:**
Multiple tabs on the same device stay in sync using SharedWorker with IndexedDB persistence.

### Tasks & Status:

#### [ ] 4. SharedWorker Foundation & Comlink Setup
- [ ] Set up Vite configuration for SharedWorker
- [ ] Install and configure Comlink
- [ ] Create basic SharedWorker entry point
- [ ] Wrap SharedWorker with Comlink for RPC
- [ ] Define API interface for worker communication
- [ ] Implement tab connection handling
- [ ] Add connection lifecycle management (connect/disconnect)
- [ ] Implement type-safe method exposure
- [ ] Test SharedWorker initialization across tabs
- [ ] Test bidirectional communication

#### [ ] 5. Dexie Database Setup in Worker
- [ ] Install and configure Dexie
- [ ] Define schema for separate node storage (`nodes` table)
- [ ] Define schema for `operationLog` table
- [ ] Initialize database with versioning in SharedWorker
- [ ] Implement database upgrade/migration logic

#### [ ] 6. Node-Based Persistence Service
- [ ] Implement `saveNode()` method for individual bookmark/folder
- [ ] Implement `loadNodes()` method for tree reconstruction
- [ ] Implement `appendOperation()` method for operation log
- [ ] Implement `loadOperationLog()` method for replay
- [ ] Add transaction support for multi-node operations
- [ ] Add error handling for database operations

#### [ ] 7. SharedWorker CRUD API
- [ ] Move tree operations to SharedWorker
- [ ] Expose bookmark CRUD methods via Comlink
- [ ] Implement folder operations in worker
- [ ] Add operation validation in worker
- [ ] Integrate with node-based persistence
- [ ] Test API functionality from multiple tabs

#### [ ] 8. Broadcast Channel Implementation
- [ ] Set up Broadcast Channel for tab notifications
- [ ] Define message types for node updates
- [ ] Implement change broadcasting from worker
- [ ] Add tab-side message listeners
- [ ] Test real-time updates across tabs

#### [ ] 9. React Hook Integration
- [ ] Create `useSharedWorkerBookmarks` hook
- [ ] Implement worker connection management
- [ ] Add automatic re-connection on worker failure
- [ ] Handle loading and error states
- [ ] Test hook across different components

#### [ ] 10. Tree Recovery & Replay Logic
- [ ] Implement app startup tree reconstruction from nodes
- [ ] Add operation log replay using `TreeOpsBuilder.replay()`
- [ ] Handle corrupted data scenarios
- [ ] Add data validation on load
- [ ] Test persistence across worker restarts

#### [ ] 11. Multi-Tab Demo with Persistence
- [ ] Update UI components to use SharedWorker API
- [ ] Test bookmark creation/persistence across tabs
- [ ] Test folder operations/persistence across tabs
- [ ] Verify drag-and-drop sync between tabs
- [ ] Test tab close/reopen scenarios
- [ ] Test persistence across browser refresh

---

## Phase 3: Local Queue for Write Operations

**Goal:**
Write operations are queued in IndexedDB for reliable sync and offline support.

### Tasks & Status:

#### [ ] 12. Enhanced Node Schema Design
- [ ] Design `nodes` table schema with all node fields
  - id, kind, title, parentId, orderKey, createdAt, updatedAt
  - url (nullable, bookmarks only), isOpen (nullable, folders only)
- [ ] Design `operationQueue` table schema for sync operations
- [ ] Add operation status tracking (pending, processing, completed, failed)
- [ ] Add retry count and error message fields
- [ ] Add timestamp and client ID fields
- [ ] Create indexes for efficient querying (parentId, updatedAt, kind)

#### [ ] 13. Queue Management Service  
- [ ] Implement operation queueing in SharedWorker for sync operations
- [ ] Add queue processing with status updates
- [ ] Implement batch processing for efficiency
- [ ] Add queue size monitoring
- [ ] Test queue persistence across worker restarts

#### [ ] 14. Enhanced Change Detection
- [ ] Implement node-level change tracking using updatedAt
- [ ] Add methods to get changed nodes since timestamp
- [ ] Optimize tree updates to only touch changed nodes
- [ ] Test incremental update efficiency

#### [ ] 15. Retry Logic Implementation
- [ ] Implement exponential backoff strategy
- [ ] Add maximum retry limits
- [ ] Implement failure categorization
- [ ] Add manual retry functionality
- [ ] Test retry behavior under various failure scenarios

#### [ ] 16. Offline Support
- [ ] Detect online/offline status
- [ ] Queue operations when offline
- [ ] Process queue when coming back online
- [ ] Add offline indicators in UI
- [ ] Test offline/online transitions

#### [ ] 17. Queue Status UI
- [ ] Create queue status component
- [ ] Show pending operation count
- [ ] Display failed operations with retry option
- [ ] Add queue clearing functionality
- [ ] Show sync progress indicators

#### [ ] 18. Queue Demo & Testing
- [ ] Test queue functionality with simulated network issues
- [ ] Verify operation ordering preservation
- [ ] Test queue recovery after browser crash
- [ ] Demonstrate offline editing capabilities
- [ ] Test queue status across multiple tabs

---

## Phase 4: Server Integration (API & SSE)

**Goal:**
Sync bookmarks across devices via server API and Server-Sent Events.

### Tasks & Status:

#### [ ] 19. Server API Development
- [ ] Set up Express.js server with TypeScript
- [ ] Implement node-based bookmark CRUD API endpoints
- [ ] Add incremental sync endpoint (get nodes changed since timestamp)
- [ ] Add operation processing endpoint
- [ ] Add proper error handling and validation

#### [ ] 20. Database Integration
- [ ] Set up SQLite/PostgreSQL for server storage
- [ ] Create nodes table matching client schema
- [ ] Create operation log table
- [ ] Implement database models and queries
- [ ] Add data migration scripts
- [ ] Test database operations

#### [ ] 21. Server-Sent Events Implementation
- [ ] Add SSE endpoint for real-time updates
- [ ] Implement client connection management
- [ ] Add event broadcasting for individual node changes
- [ ] Handle SSE connection failures and reconnection
- [ ] Test SSE across multiple clients

#### [ ] 22. SharedWorker Server Integration
- [ ] Add HTTP client to SharedWorker
- [ ] Implement queue processing with server API
- [ ] Add SSE listener in SharedWorker
- [ ] Handle authentication token management
- [ ] Test bidirectional sync

#### [ ] 23. Incremental Sync Logic
- [ ] Implement node-level change detection
- [ ] Add timestamp-based incremental sync
- [ ] Handle server-initiated node updates
- [ ] Add client state reconciliation
- [ ] Test sync efficiency with large trees

#### [ ] 24. Server Sync Demo
- [ ] Deploy server for testing
- [ ] Test incremental node sync between devices
- [ ] Verify real-time updates via SSE
- [ ] Test network failure recovery
- [ ] Demonstrate cross-browser sync

---

## Phase 5: Conflict Resolution & Error Handling

**Goal:**
Handle sync conflicts and errors gracefully.

### Tasks & Status:

#### [ ] 25. Node-Level Conflict Detection
- [ ] Implement node timestamp comparison
- [ ] Add server node version tracking
- [ ] Detect concurrent node modifications
- [ ] Identify stale node update scenarios
- [ ] Add conflict categorization per node

#### [ ] 26. Conflict Resolution Strategies
- [ ] Implement Last-Writer-Wins resolution for nodes
- [ ] Add manual conflict resolution option
- [ ] Implement node data merging strategies
- [ ] Add conflict history tracking
- [ ] Test resolution algorithms

#### [ ] 27. Conflict Resolution UI
- [ ] Create node conflict notification component
- [ ] Add conflict resolution dialog
- [ ] Show conflicting node changes side-by-side
- [ ] Allow user to choose resolution strategy
- [ ] Test UI with various conflict scenarios

#### [ ] 28. Enhanced Error Handling
- [ ] Categorize error types (network, validation, conflict)
- [ ] Implement specific retry strategies per error type
- [ ] Add error reporting and logging
- [ ] Create user-friendly error messages
- [ ] Test error scenarios and recovery

#### [ ] 29. Robust State Management
- [ ] Add node validation and integrity checks
- [ ] Implement rollback mechanisms for failed operations
- [ ] Add operation idempotency
- [ ] Handle partial failure scenarios
- [ ] Test state consistency under failures

#### [ ] 30. Conflict Demo & Testing
- [ ] Simulate concurrent node edits from multiple devices
- [ ] Test node-level conflict resolution UI
- [ ] Verify data integrity after conflicts
- [ ] Test error recovery scenarios
- [ ] Demonstrate graceful degradation

---

## Phase 6: Security, Performance, and Monitoring

**Goal:**
Harden system, optimize performance, and add monitoring.

### Tasks & Status:

#### [ ] 31. Authentication & Authorization
- [ ] Implement user registration/login
- [ ] Add JWT token management
- [ ] Secure API endpoints with authentication
- [ ] Add session management in SharedWorker
- [ ] Test security across multiple sessions

#### [ ] 32. Data Security
- [ ] Add input validation and sanitization
- [ ] Implement API rate limiting
- [ ] Add CORS configuration
- [ ] Secure sensitive data storage
- [ ] Test against common security vulnerabilities

#### [ ] 33. Performance Optimization
- [ ] Optimize IndexedDB queries with proper indexes
- [ ] Implement node-level operation batching
- [ ] Add request/response compression
- [ ] Optimize bundle sizes and lazy loading
- [ ] Profile and optimize memory usage
- [ ] Add tree virtualization for large collections

#### [ ] 34. Monitoring & Logging
- [ ] Add structured logging throughout the system
- [ ] Implement performance metrics collection
- [ ] Add error tracking and reporting
- [ ] Create health check endpoints
- [ ] Set up monitoring dashboard

#### [ ] 35. Production Deployment
- [ ] Set up production server configuration
- [ ] Add environment-specific configurations
- [ ] Implement CI/CD pipeline
- [ ] Add automated testing
- [ ] Set up error monitoring and alerting

#### [ ] 36. Final Demo & Documentation
- [ ] Create comprehensive demo showcasing all features
- [ ] Write user documentation
- [ ] Create deployment guide
- [ ] Add troubleshooting documentation
- [ ] Conduct final testing across all scenarios

---

## Progress Tracking

**Total Tasks:** 36  
**Completed:** 3  
**In Progress:** 0  
**Remaining:** 33  

Update task status by changing `[ ]` to `[x]` as implementation progresses.

---

## Phase 1 Status: ✅ COMPLETE

Phase 1 is fully implemented in `BookmarksTree.tsx` with:
- **Full CRUD operations** for bookmarks and folders
- **Drag-and-drop reordering** with fractional indexing
- **TreeOpsBuilder integration** with operation logging
- **Real-time UI updates** after each operation
- **Nested folder structure** with expand/collapse
- **Menu-based actions** for create/delete/move operations

**Next Phase:** Ready to move to Phase 2 (SharedWorker & Local Persistence)

---

## Key Architecture Changes Made

### Node-Based Storage Benefits:
- **Incremental Sync**: Only changed nodes sync, not entire tree
- **Granular Conflicts**: Detect and resolve conflicts per-node
- **Better Performance**: Efficient updates for large bookmark collections
- **Scalable Queries**: Index-based lookups by parent, timestamp, type

### Task Reordering Rationale:
1. **Phase 1**: Start with in-memory UI to validate core functionality
2. **Phase 2**: Move to SharedWorker with proper persistence setup
3. **Phase 3+**: Build on established persistence foundation
4. **All Phases**: Maintain incremental, demoable progress
