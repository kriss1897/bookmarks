import express, { Request, Response } from 'express';
import { EventsManager } from './services/EventsManager.js';
import { EventPublisher } from './services/EventPublisher.js';
import { APIRoutes } from './routes/api.routes.js';
import { SSERoutes } from './routes/sse.routes.js';
import { BookmarkRoutes } from './routes/bookmark.routes.js';
import { createSyncRouter } from './routes/sync.routes.js';
import { initializeDatabase, closeDatabase } from './db/connection.js';

// Initialize database
await initializeDatabase();

// Initialize services directly
const eventsManager = new EventsManager();
const eventPublisher = new EventPublisher(eventsManager);
const apiRoutes = new APIRoutes(eventPublisher, eventsManager);
const sseRoutes = new SSERoutes(eventsManager);
const bookmarkRoutes = new BookmarkRoutes(eventPublisher);

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Events Route
app.get('/api/events', sseRoutes.handleEventsConnection);

// Sync Route (for offline-first operations)
app.use('/api/sync', createSyncRouter(eventPublisher));

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
