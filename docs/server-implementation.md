# Server Implementation Guide

## Project Structure
```
server/
├── src/
│   ├── db/
│   │   ├── schema.ts           # Drizzle schema definitions
│   │   ├── migrations/         # Database migration files
│   │   └── connection.ts       # Database connection setup
│   ├── routes/
│   │   ├── api.ts             # Main API routes
│   │   ├── events.ts          # SSE endpoint implementation
│   │   └── health.ts          # Health check endpoint
│   ├── services/
│   │   ├── folderService.ts   # Folder business logic
│   │   ├── itemService.ts     # Item business logic
│   │   ├── reorderService.ts  # Reordering and rank calculation
│   │   └── changeLogService.ts # Event logging and SSE broadcasting
│   ├── middleware/
│   │   ├── cors.ts            # CORS configuration
│   │   ├── validation.ts      # Zod request validation
│   │   └── errorHandler.ts    # Global error handling
│   ├── types/
│   │   ├── api.ts             # API request/response types
│   │   └── database.ts        # Database entity types
│   └── server.ts              # Express app configuration
├── package.json
├── tsconfig.json
└── drizzle.config.ts          # Drizzle ORM configuration
```

## Database Schema Design

**Database Entities:**
```
folders table:
  - id: string (primary key, auto-generated CUID)
  - name: string (required)
  - isOpen: boolean (default true)
  - rank: string (fractional index for ordering)
  - updatedAt: timestamp
  - createdAt: timestamp

items table:
  - id: string (primary key, auto-generated CUID)
  - title: string (required)
  - icon: string (required)
  - folderId: string (foreign key to folders.id, nullable)
  - rank: string (fractional index for ordering)
  - updatedAt: timestamp
  - createdAt: timestamp

changeLog table:
  - id: integer (auto-increment primary key)
  - kind: enum['folder', 'item']
  - ids: JSON array of strings
  - timestamp: timestamp

Indexes:
  - folder_rank_idx on folders.rank
  - item_folder_idx on items.folderId
  - item_rank_idx on items.rank
  - change_log_timestamp_idx on changeLog.timestamp
```

**Entity Interfaces:**
```typescript
interface Folder {
  id: string;
  name: string;
  isOpen: boolean;
  rank: string;
  updatedAt: string;
  createdAt: string;
}

interface Item {
  id: string;
  title: string;
  icon: string;
  folderId: string | null;
  rank: string;
  updatedAt: string;
  createdAt: string;
}

interface ChangeLogEntry {
  id: number;
  kind: 'folder' | 'item';
  ids: string[];
  timestamp: string;
}
```

## Database Connection Setup

**Connection Configuration:**
```
Database Setup:
  - Use SQLite with better-sqlite3 driver
  - Enable WAL mode for concurrent reads
  - Enable foreign key constraints
  - Initialize ORM with schema definitions
  - Run migrations on server startup

Pseudocode:
  initialize_database():
    database = create_sqlite_connection('app.db')
    database.configure('journal_mode = WAL')
    database.configure('foreign_keys = ON')
    orm = initialize_orm(database, schema)
    run_migrations(orm, migrations_folder)
    return orm
```

## API Route Interfaces

**Request/Response Types:**
```typescript
interface CreateFolderRequest {
  name: string; // 1-255 characters
}

interface CreateItemRequest {
  title: string; // 1-255 characters
  icon: string; // 1-50 characters
  folderId?: string; // optional folder ID
}

interface ReorderRequest {
  entity: 'folder' | 'item';
  id: string; // entity ID to move
  parentFolderId: string | null; // target folder (null for root)
  beforeId?: string; // entity ID to place before
  afterId?: string; // entity ID to place after
}

interface StateResponse {
  folders: Folder[];
  items: Item[];
}
```

**API Endpoints:**
```
GET /api/state
  Purpose: Get initial application state
  Response: { folders: Folder[], items: Item[] }
  Logic:
    - Query all folders ordered by rank
    - Query all items ordered by rank
    - Return combined state

POST /api/folders
  Purpose: Create new folder
  Body: CreateFolderRequest
  Response: { folder: Folder }
  Logic:
    - Validate request body
    - Generate new rank (append to end)
    - Insert folder into database
    - Log change for SSE broadcast
    - Return created folder

PATCH /api/folders/:id
  Purpose: Update folder (name, isOpen)
  Body: Partial<Folder>
  Response: { folder: Folder }
  Logic:
    - Validate folder ID exists
    - Update folder properties
    - Log change for SSE broadcast
    - Return updated folder

POST /api/items
  Purpose: Create new item
  Body: CreateItemRequest
  Response: { item: Item }
  Logic:
    - Validate request body
    - Generate new rank in target container
    - Insert item into database
    - Log change for SSE broadcast
    - Return created item

POST /api/reorder
  Purpose: Reorder folders or items
  Body: ReorderRequest
  Response: { id: string, rank: string, parentFolderId: string | null }
  Logic:
    - Calculate new rank between neighbors
    - Update entity position and container
    - Log change for SSE broadcast
    - Return position info
```

## Server-Sent Events (SSE) Design

**SSE Connection Interface:**
```typescript
interface SSEConnection {
  id: string;
  response: Response;
  lastEventId: number;
}

interface SSEEvent {
  id: string;
  type: string;
  data: any;
}
```

**SSE Manager Responsibilities:**
```
Connection Management:
  - Track active client connections
  - Generate unique connection IDs
  - Handle client disconnections
  - Send periodic heartbeats (every 25 seconds)

Event Broadcasting:
  - Format events as SSE protocol
  - Broadcast to all connected clients
  - Handle selective broadcasting
  - Support event replay for reconnections

Event Types:
  - 'connected': Initial connection confirmation
  - 'invalidate': Data change notifications
  - 'heartbeat': Keep-alive signals
```

**SSE Endpoint Logic:**
```
GET /api/events
  Headers:
    - Content-Type: text/event-stream
    - Cache-Control: no-cache
    - Connection: keep-alive
    - Access-Control-Allow-Origin: *

  Flow:
    1. Extract Last-Event-ID from headers
    2. Generate unique connection ID
    3. Create SSEConnection object
    4. Register connection with manager
    5. If Last-Event-ID provided:
       - Replay missed events from change log
    6. Handle client disconnect cleanup

  Event Format:
    id: {event_id}
    event: {event_type}
    data: {json_data}
    
    (blank line)
```

**Event Replay Mechanism:**
```
replay_events(connection, from_id):
  missed_events = query_change_log_since(from_id)
  for each event in missed_events:
    format_and_send_to_connection(connection, event)
  limit_to_100_events_per_replay()
```

## Service Layer Architecture

**Service Interfaces:**
```typescript
interface IReorderService {
  reorder(params: ReorderRequest): Promise<ReorderResult>;
}

interface IFolderService {
  getAll(): Promise<Folder[]>;
  create(data: CreateFolderRequest): Promise<Folder>;
  update(id: string, data: Partial<Folder>): Promise<Folder>;
  delete(id: string): Promise<void>;
}

interface IItemService {
  getAll(): Promise<Item[]>;
  create(data: CreateItemRequest): Promise<Item>;
  update(id: string, data: Partial<Item>): Promise<Item>;
  delete(id: string): Promise<void>;
}

interface IChangeLogService {
  getEventsSince(lastEventId: number): Promise<ChangeLogEntry[]>;
  cleanup(olderThanDays: number): Promise<void>;
}
```

**Reorder Service Logic:**
```
reorder(params):
  BEGIN TRANSACTION
    1. Extract: entity, id, parentFolderId, beforeId, afterId
    2. Get ranks of neighboring entities:
       - beforeRank = getRank(entity, beforeId, parentFolderId)
       - afterRank = getRank(entity, afterId, parentFolderId)
    3. Generate new rank between neighbors:
       - newRank = fractional_indexing.between(beforeRank, afterRank)
    4. Update entity:
       - If folder: update rank only
       - If item: update rank and folderId
    5. Log change to changeLog table
    6. Broadcast SSE invalidation event
  COMMIT TRANSACTION
  
  return { id, rank: newRank, parentFolderId }

getRank(entity, id, parentFolderId):
  if entity == 'folder':
    return SELECT rank FROM folders WHERE id = ?
  else:
    return SELECT rank FROM items WHERE id = ? AND 
           (folderId = ? OR (folderId IS NULL AND ? IS NULL))
```

**Folder Service Logic:**
```
getAll():
  return SELECT * FROM folders ORDER BY rank

create(data):
  BEGIN TRANSACTION
    1. Get last folder rank: SELECT rank FROM folders ORDER BY rank DESC LIMIT 1
    2. Generate new rank: fractional_indexing.after(lastRank)
    3. Insert new folder with generated rank
    4. Log change to changeLog
    5. Broadcast SSE invalidation
  COMMIT TRANSACTION
  return new folder

update(id, data):
  BEGIN TRANSACTION
    1. Update folder SET {data} WHERE id = ?
    2. Log change to changeLog
    3. Broadcast SSE invalidation
  COMMIT TRANSACTION
  return updated folder

delete(id):
  BEGIN TRANSACTION
    1. Move orphaned items: UPDATE items SET folderId = NULL WHERE folderId = ?
    2. Delete folder: DELETE FROM folders WHERE id = ?
    3. Log change to changeLog
    4. Broadcast SSE invalidation
  COMMIT TRANSACTION
```

**Item Service Logic:**
```
getAll():
  return SELECT * FROM items ORDER BY rank

create(data):
  BEGIN TRANSACTION
    1. Get last item rank in target container:
       SELECT rank FROM items WHERE 
       (folderId = ? OR (folderId IS NULL AND ? IS NULL))
       ORDER BY rank DESC LIMIT 1
    2. Generate new rank: fractional_indexing.after(lastRank)
    3. Insert new item with generated rank
    4. Log change to changeLog
    5. Broadcast SSE invalidation
  COMMIT TRANSACTION
  return new item

update(id, data):
  BEGIN TRANSACTION
    1. Update item SET {data} WHERE id = ?
    2. Log change to changeLog  
    3. Broadcast SSE invalidation
  COMMIT TRANSACTION
  return updated item

delete(id):
  BEGIN TRANSACTION
    1. Delete item: DELETE FROM items WHERE id = ?
    2. Log change to changeLog
    3. Broadcast SSE invalidation
  COMMIT TRANSACTION
```

**Change Log Service Logic:**
```
getEventsSince(lastEventId):
  return SELECT * FROM changeLog 
         WHERE id > ? 
         ORDER BY id 
         LIMIT 100

cleanup(olderThanDays):
  cutoffDate = now() - olderThanDays
  DELETE FROM changeLog WHERE timestamp < cutoffDate
```

## Middleware Design

**Request Validation Interface:**
```typescript
interface ValidationSchema {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

interface ValidationError {
  error: 'Validation failed';
  details: Array<{
    path: string[];
    message: string;
    code: string;
  }>;
}
```

**Validation Middleware Logic:**
```
validateRequest(schema):
  return middleware_function(request, response, next):
    try:
      schema.parse({
        body: request.body,
        query: request.query,
        params: request.params
      })
      next() // Continue to next middleware
    catch ValidationError:
      response.status(400).json({
        error: 'Validation failed',
        details: error.issues
      })
```

**Error Handler Logic:**
```
errorHandler(error, request, response, next):
  log_error(error)
  
  if response.headers_sent:
    return next(error) // Let default handler manage
    
  switch error.type:
    case 'ValidationError':
      return response.status(400).json({
        error: 'Validation failed',
        message: error.message
      })
    case 'NotFoundError':
      return response.status(404).json({
        error: 'Resource not found',
        message: error.message
      })
    default:
      return response.status(500).json({
        error: 'Internal server error',
        message: is_development ? error.message : 'Something went wrong'
      })
```

## Express Application Setup

**Server Configuration:**
```
Application Setup:
  - Create Express application instance
  - Configure CORS for client origin
  - Add JSON and URL-encoded body parsing
  - Mount API routes under /api prefix
  - Add health check endpoint
  - Configure global error handling

Middleware Stack:
  1. CORS (origin: CLIENT_URL, credentials: true)
  2. express.json() - Parse JSON request bodies
  3. express.urlencoded() - Parse form data
  4. API routes - Business logic endpoints
  5. SSE routes - Real-time event endpoints
  6. Error handler - Global error processing

Route Structure:
  - GET /health - Server health status
  - /api/* - All API endpoints
  - /api/events - SSE endpoint

Server Startup:
  - Listen on PORT (default 3001)
  - Log startup message
  - Initialize database connections
  - Run database migrations
```

## Project Dependencies

**Required Dependencies:**
```json
Production Dependencies:
  - express: Web framework
  - cors: Cross-origin resource sharing
  - drizzle-orm: Database ORM
  - better-sqlite3: SQLite database driver
  - zod: Schema validation library
  - fractional-indexing: Ordering algorithm
  - @paralleldrive/cuid2: Unique ID generation

Development Dependencies:
  - typescript: TypeScript compiler
  - @types/express: Express type definitions
  - @types/cors: CORS type definitions
  - @types/better-sqlite3: SQLite type definitions
  - nodemon: Development server
  - ts-node: TypeScript execution
  - drizzle-kit: Database migration tool
```

**Scripts Configuration:**
```json
Scripts:
  - "dev": Start development server with hot reload
  - "build": Compile TypeScript to JavaScript
  - "start": Run production server
  - "db:generate": Generate database migrations
  - "db:migrate": Apply database migrations
```

**TypeScript Configuration:**
```json
Compiler Options:
  - target: ES2022
  - module: ESNext
  - moduleResolution: node
  - strict: true (full type checking)
  - esModuleInterop: true
  - skipLibCheck: true
  - outDir: ./dist (compiled output)
  - rootDir: ./src (source directory)
  - baseUrl: ./src (import resolution)

Path Mapping:
  - "@/*": Map to src/* for cleaner imports

Include: All files in src/
Exclude: node_modules, dist
```

## Performance Considerations

1. **Database Indexes**: Proper indexing on rank fields and foreign keys
2. **Connection Pooling**: Better-sqlite3 with WAL mode for concurrent reads
3. **SSE Connection Limits**: Monitor and limit concurrent SSE connections
4. **Event Log Cleanup**: Regular cleanup of old change log entries
5. **Request Validation**: Early validation to prevent unnecessary processing
6. **Error Boundaries**: Comprehensive error handling to prevent crashes

## Security Considerations

1. **Input Validation**: Zod schemas for all request validation
2. **CORS Configuration**: Restricted to specific client origins
3. **SQL Injection**: Drizzle ORM provides protection against SQL injection
4. **Rate Limiting**: Consider adding rate limiting for production use
5. **Authentication**: Framework ready for adding authentication middleware

This server implementation guide provides a robust, scalable foundation for the realtime folders application with proper error handling, performance optimizations, and room for future enhancements.
