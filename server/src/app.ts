import express, { Request, Response } from 'express';
import { EventsManager } from './services/EventsManager.js';
import { EventPublisher } from './services/EventPublisher.js';
import { APIController } from './controllers/api.controller.js';
import { SSEController } from './controllers/sse.controller.js';
import { BookmarkController } from './controllers/bookmark.controller.js';
import { SyncController } from './controllers/sync.controller.js';
import { initializeDatabase, closeDatabase } from './db/connection.js';

// Initialize database
await initializeDatabase();

// Initialize services directly
const eventsManager = new EventsManager();
const eventPublisher = new EventPublisher(eventsManager);
const apiController = new APIController(eventPublisher, eventsManager);
const sseController = new SSEController(eventsManager);
const bookmarkController = new BookmarkController(eventPublisher);
const syncController = new SyncController(eventPublisher);

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Bookmark API Routes
app.get('/api/bookmarks/:namespace', bookmarkController.getItems);
app.post('/api/bookmarks/:namespace/folders', bookmarkController.createFolder);
app.post('/api/bookmarks/:namespace/bookmarks', bookmarkController.createBookmark);
app.put('/api/bookmarks/:namespace/items/:itemId/move', bookmarkController.moveItem);
app.put('/api/bookmarks/:namespace/folders/:folderId/toggle', bookmarkController.toggleFolderState);
app.put('/api/bookmarks/:namespace/bookmarks/:bookmarkId/favorite', bookmarkController.toggleBookmarkFavorite);
app.delete('/api/bookmarks/:namespace/items/:itemId', bookmarkController.deleteItem);
app.put('/api/bookmarks/:namespace/bookmarks/:bookmarkId', bookmarkController.updateBookmark);
app.put('/api/bookmarks/:namespace/folders/:folderId', bookmarkController.updateFolder);

// Events Route
app.get('/api/events', sseController.handleEventsConnection);

// Sync Route (for offline-first operations)
app.post('/api/sync/:namespace/operations', syncController.syncOperations);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  eventsManager.destroy();
  closeDatabase();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  eventsManager.destroy();
  closeDatabase();
  process.exit(0);
});

export default app;
