import express, { Request, Response } from 'express';
import cors from 'cors';

import { EventsManager } from './events/EventsManager.js';
import { EventPublisher } from './events/EventPublisher.js';
import { EventsController } from './controllers/EventsController.js';
import { BookmarkController } from './controllers/BookmarkController.js';
import { OperationsController } from './controllers/OperationsController.js';

import { BookmarkService, OperationsService } from './services';

const app = express();

// Initialize SSE services
const eventsManager = new EventsManager();
const eventPublisher = new EventPublisher(eventsManager);
const eventsController = new EventsController(eventsManager);

const operationsService = new OperationsService();
const bookmarkService = new BookmarkService(operationsService);
const bookmarkController = new BookmarkController(eventPublisher, bookmarkService, operationsService);
const operationsController = new OperationsController(eventPublisher, operationsService);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SSE Events endpoint
app.get('/api/events', eventsController.handleEventsConnection);

// Basic route
app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    message: 'Bookmarks API Server',
    version: '1.0.0',
    status: 'running',
    sseConnections: eventsManager.getConnectionCount()
  });
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Get tree starting from a specific node, only loading children for open folders
app.get('/api/:namespace/tree/node/:nodeId', bookmarkController.getNodeTree);

// Get operations history
app.get('/api/:namespace/operations', operationsController.getOperations);

// Ping endpoint for connectivity checks
app.head('/api/ping', (req: Request, res: Response) => {
  res.status(200).end();
});

// Apply an operation envelope (client sync)
app.post('/api/:namespace/operations/apply', operationsController.applyOperation);

export default app;
