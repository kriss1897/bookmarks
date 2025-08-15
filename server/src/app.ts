import express, { Request, Response } from 'express';
import { EventsManager } from './services/EventsManager.js';
import { EventPublisher } from './services/EventPublisher.js';
import { EventsController } from './controllers/EventsController.js';

const app = express();

// Initialize SSE services
const eventsManager = new EventsManager();
const eventPublisher = new EventPublisher(eventsManager);
const eventsController = new EventsController(eventsManager);

// Middleware
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

// Ping endpoint for connectivity checks
app.head('/api/ping', (req: Request, res: Response) => {
  res.status(200).end();
});

// Example route to test SSE broadcasting
app.post('/api/broadcast', (req: Request, res: Response) => {
  const { namespace, type, message, data } = req.body;
  
  if (!namespace || !type) {
    res.status(400).json({ error: 'namespace and type are required' });
    return;
  }
  
  eventPublisher.publishToNamespace(namespace, {
    type,
    message: message || `Test broadcast: ${type}`,
    timestamp: new Date().toISOString(),
    ...data // Spread any additional data fields
  });
  
  res.json({ 
    success: true, 
    message: `Broadcasted ${type} to namespace ${namespace}` 
  });
});

export default app;
