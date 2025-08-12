import express, { Request, Response } from 'express';
import { SSEManager } from './services/SSEManager.js';
import { EventPublisher } from './services/EventPublisher.js';
import { APIRoutes } from './routes/api.routes.js';
import { SSERoutes } from './routes/sse.routes.js';

// Initialize services directly
const sseManager = new SSEManager();
const eventPublisher = new EventPublisher(sseManager);
const apiRoutes = new APIRoutes(eventPublisher, sseManager);
const sseRoutes = new SSERoutes(sseManager);

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

// SSE Route
app.get('/api/events', sseRoutes.handleSSEConnection);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  sseManager.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  sseManager.destroy();
  process.exit(0);
});

export default app;
