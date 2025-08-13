import express, { Request, Response } from 'express';
import { SSEManager } from './services/SSEManager.js';
import { EventPublisher } from './services/EventPublisher.js';
import { APIRoutes } from './routes/api.routes.js';
import { SSERoutes } from './routes/sse.routes.js';
import { BookmarkRoutes } from './routes/bookmark.routes.js';
import { createSyncRouter } from './routes/sync.routes.js';
import { initializeDatabase, closeDatabase } from './db/connection.js';

// Initialize database
await initializeDatabase();

// Initialize services directly
const sseManager = new SSEManager();
const eventPublisher = new EventPublisher(sseManager);
const apiRoutes = new APIRoutes(eventPublisher, sseManager);
const sseRoutes = new SSERoutes(sseManager);
const bookmarkRoutes = new BookmarkRoutes(eventPublisher);

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.get('/api/status', apiRoutes.getStatus);
app.get('/api/health', apiRoutes.getHealth);
app.post('/api/trigger', apiRoutes.triggerEvent);
app.post('/api/notify', apiRoutes.sendNotification);
app.get('/api/connections', apiRoutes.getConnections);
app.post('/api/cleanup', apiRoutes.forceCleanup);

// Bookmark API Routes
app.get('/api/bookmarks/:namespace', bookmarkRoutes.getItems);
app.post('/api/bookmarks/:namespace/folders', bookmarkRoutes.createFolder);
app.post('/api/bookmarks/:namespace/bookmarks', bookmarkRoutes.createBookmark);
app.put('/api/bookmarks/:namespace/items/:itemId/move', bookmarkRoutes.moveItem);
app.put('/api/bookmarks/:namespace/folders/:folderId/toggle', bookmarkRoutes.toggleFolderState);
app.put('/api/bookmarks/:namespace/bookmarks/:bookmarkId/favorite', bookmarkRoutes.toggleBookmarkFavorite);
app.delete('/api/bookmarks/:namespace/items/:itemId', bookmarkRoutes.deleteItem);
app.put('/api/bookmarks/:namespace/bookmarks/:bookmarkId', bookmarkRoutes.updateBookmark);
app.put('/api/bookmarks/:namespace/folders/:folderId', bookmarkRoutes.updateFolder);

// SSE Route
app.get('/api/events', sseRoutes.handleSSEConnection);

// Sync Route (for offline-first operations)
app.use('/api/sync', createSyncRouter(eventPublisher));

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  sseManager.destroy();
  closeDatabase();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  sseManager.destroy();
  closeDatabase();
  process.exit(0);
});

export default app;
