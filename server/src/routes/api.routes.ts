import { Request, Response } from 'express';
import { IEventPublisher, ISSEManager, EventType } from '../types/events.js';

/**
 * API Route Handlers following Single Responsibility Principle
 * Each handler is responsible for one specific API endpoint
 */
export class APIRoutes {
  constructor(
    private eventPublisher: IEventPublisher,
    private sseManager?: ISSEManager
  ) {}

  /**
   * GET /api/status - API status endpoint
   */
  getStatus = (req: Request, res: Response): void => {
    res.json({
      message: 'Bookmarks API Server',
      version: '1.0.0',
      status: 'running'
    });
  };

  /**
   * GET /api/health - Health check endpoint
   */
  getHealth = (req: Request, res: Response): void => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  };

  /**
   * POST /api/trigger - Trigger SSE event endpoint
   * Supports optional namespace parameter
   */
  triggerEvent = (req: Request, res: Response): void => {
    try {
      const { message, data, namespace } = req.body;
      
      // Validate request
      if (!message) {
        res.status(400).json({
          error: 'Message is required',
          code: 'MISSING_MESSAGE'
        });
        return;
      }

      // If namespace is provided, send to specific namespace
      if (namespace && this.sseManager) {
        this.sseManager.broadcastToNamespace(namespace, {
          id: this.generateId(),
          type: EventType.TRIGGER,
          data: {
            type: 'trigger',
            message,
            data: data || {},
            triggeredBy: 'api-endpoint',
            endpoint: '/api/trigger',
            namespace
          },
          timestamp: new Date().toISOString(),
          namespace
        });
      } else {
        // Publish to all clients (existing behavior)
        this.eventPublisher.publishEvent(EventType.TRIGGER, {
          message,
          data: data || {},
          triggeredBy: 'api-endpoint',
          endpoint: '/api/trigger'
        });
      }

      res.json({
        success: true,
        message: namespace 
          ? `Event triggered successfully for namespace: ${namespace}` 
          : 'Event triggered successfully for all clients',
        namespace: namespace || 'all',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error triggering event:', error);
      res.status(500).json({
        error: 'Internal server error',
        code: 'TRIGGER_ERROR'
      });
    }
  };

  /**
   * POST /api/notify - Send notification event
   * Supports optional namespace parameter
   */
  sendNotification = (req: Request, res: Response): void => {
    try {
      const { title, body, type = 'info', namespace } = req.body;
      
      if (!title) {
        res.status(400).json({
          error: 'Title is required',
          code: 'MISSING_TITLE'
        });
        return;
      }

      // If namespace is provided, send to specific namespace
      if (namespace && this.sseManager) {
        this.sseManager.broadcastToNamespace(namespace, {
          id: this.generateId(),
          type: EventType.NOTIFICATION,
          data: {
            type: 'notification',
            message: title,
            data: {
              title,
              body,
              type,
              notificationId: this.generateId(),
              namespace
            }
          },
          timestamp: new Date().toISOString(),
          namespace
        });
      } else {
        // Send to all clients (existing behavior)
        this.eventPublisher.publishEvent(EventType.NOTIFICATION, {
          message: title,
          data: {
            title,
            body,
            type,
            notificationId: this.generateId()
          }
        });
      }

      res.json({
        success: true,
        message: namespace 
          ? `Notification sent successfully to namespace: ${namespace}` 
          : 'Notification sent successfully to all clients',
        namespace: namespace || 'all',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error sending notification:', error);
      res.status(500).json({
        error: 'Internal server error',
        code: 'NOTIFICATION_ERROR'
      });
    }
  };

  /**
   * GET /api/connections?namespace=<namespace> - Get SSE connection count
   * If namespace is provided, returns count for that namespace only
   */
  getConnections = (req: Request, res: Response): void => {
    const namespace = req.query.namespace as string;
    
    if (namespace && this.sseManager) {
      const connectionCount = this.sseManager.getConnectionCountByNamespace(namespace);
      res.json({
        connections: connectionCount,
        namespace: namespace,
        message: `${connectionCount} active SSE connections in namespace: ${namespace}`,
        timestamp: new Date().toISOString()
      });
    } else {
      const connectionCount = this.sseManager ? this.sseManager.getConnectionCount() : 0;
      res.json({
        connections: connectionCount,
        namespace: 'all',
        message: `${connectionCount} total active SSE connections`,
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * POST /api/cleanup - Force cleanup all connections or specific namespace
   */
  forceCleanup = (req: Request, res: Response): void => {
    try {
      const { namespace } = req.body;
      
      if (!this.sseManager) {
        res.status(500).json({
          error: 'SSE Manager not available',
          code: 'SSE_UNAVAILABLE'
        });
        return;
      }

      if (namespace) {
        this.sseManager.forceCleanupNamespace(namespace);
        res.json({
          success: true,
          message: `Cleanup triggered for namespace: ${namespace}`,
          namespace: namespace,
          timestamp: new Date().toISOString()
        });
      } else {
        this.sseManager.forceCleanup();
        res.json({
          success: true,
          message: 'Cleanup triggered for all connections',
          namespace: 'all',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error triggering cleanup:', error);
      res.status(500).json({
        error: 'Internal server error',
        code: 'CLEANUP_ERROR'
      });
    }
  };

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
