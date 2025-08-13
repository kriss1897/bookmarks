import { Request, Response } from 'express';
import { IEventsManager, EventsConnection } from '../types/events.js';

/**
 * SSE Controller following Single Responsibility Principle
 * Responsible only for handling SSE connection setup
 */
export class EventsController {
  private clientCounter = 0;

  constructor(private sseManager: IEventsManager) {}

  /**
   * GET /api/events?namespace=<namespace> - Server-Sent Events endpoint
   */
  handleEventsConnection = (req: Request, res: Response): void => {
    const clientId = ++this.clientCounter;
    const namespace = req.query.namespace as string || 'default';
    
    console.log(`New SSE client connecting (Client #${clientId}, Namespace: ${namespace})`);
    
    // Validate namespace
    if (!namespace || typeof namespace !== 'string' || namespace.trim() === '') {
      res.status(400).json({ error: 'Namespace parameter is required' });
      return;
    }
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control, Last-Event-ID',
      'Access-Control-Allow-Methods': 'GET'
    });

    // Create connection object
    const connection: EventsConnection = {
      id: `connection-${clientId}`,
      response: res,
      clientId,
      namespace: namespace.trim()
    };

    // Add connection to manager
    this.sseManager.addConnection(connection);

    // Send initial connection confirmation event
    const connectionEvent = {
      id: `${Date.now()}-${clientId}`,
      event: 'connection',
      data: JSON.stringify({
        type: 'connected',
        clientId,
        namespace: namespace.trim(),
        timestamp: new Date().toISOString(),
        message: 'Events connection established successfully'
      })
    };
    
    const sseData = `id: ${connectionEvent.id}\nevent: ${connectionEvent.event}\ndata: ${connectionEvent.data}\n\n`;
    res.write(sseData);

    // Handle client disconnect
    req.on('close', () => {
      console.log(`SSE client disconnected (Client #${clientId}, Namespace: ${namespace})`);
      this.sseManager.removeConnection(clientId);
    });

    req.on('error', (err) => {
      if (err.message === 'aborted') {
        return
      }

      console.error(`SSE connection error for Client #${clientId}, Namespace: ${namespace}:`, err);
      this.sseManager.removeConnection(clientId);
    });

    // Handle aborted connections
    req.on('aborted', () => {
      console.log(`SSE connection aborted for Client #${clientId}, Namespace: ${namespace}`);
      this.sseManager.removeConnection(clientId);
    });
  };
}
