import { Response } from 'express';
import { ISSEManager, SSEConnection, SSEEvent, EventType, EventData } from '../types/events.js';

/**
 * SSE Manager following Single Responsibility Principle
 * Responsible only for managing SSE connections and broadcasting events
 */
export class SSEManager implements ISSEManager {
  private connections: Map<number, SSEConnection> = new Map();
  private namespaceConnections: Map<string, Set<number>> = new Map(); // Track connections by namespace
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private connectionCleanupInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly CONNECTION_CLEANUP_INTERVAL = 60000; // 1 minute (better for testing)

  constructor() {
    this.startHeartbeat();
    this.startConnectionCleanup();
  }

  /**
   * Add a new SSE connection
   */
  addConnection(connection: SSEConnection): void {
    this.connections.set(connection.clientId, connection);
    
    // Add to namespace tracking
    if (!this.namespaceConnections.has(connection.namespace)) {
      this.namespaceConnections.set(connection.namespace, new Set());
    }
    this.namespaceConnections.get(connection.namespace)!.add(connection.clientId);
    
    console.log(`SSE connection added (Client #${connection.clientId}, Namespace: ${connection.namespace}). Total connections: ${this.connections.size}`);
    
    // Send initial connection event
    this.sendToConnection(connection, {
      id: this.generateEventId(),
      type: EventType.CONNECTION,
      data: {
        type: 'connection',
        message: `Connected to SSE (Client #${connection.clientId}, Namespace: ${connection.namespace})`,
        timestamp: new Date().toISOString(),
        namespace: connection.namespace
      },
      timestamp: new Date().toISOString(),
      namespace: connection.namespace
    });
  }

  /**
   * Remove an SSE connection
   */
  removeConnection(clientId: number): void {
    const connection = this.connections.get(clientId);
    if (connection) {
      // Remove from namespace tracking
      const namespaceSet = this.namespaceConnections.get(connection.namespace);
      if (namespaceSet) {
        namespaceSet.delete(clientId);
        if (namespaceSet.size === 0) {
          this.namespaceConnections.delete(connection.namespace);
        }
      }
      
      this.connections.delete(clientId);
      console.log(`SSE connection removed (Client #${clientId}, Namespace: ${connection.namespace}). Total connections: ${this.connections.size}`);
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcastEvent(event: SSEEvent): void {
    const deadConnections: number[] = [];

    this.connections.forEach((connection, clientId) => {
      try {
        this.sendToConnection(connection, event);
      } catch (error) {
        console.error(`Failed to send event to client #${clientId}:`, error);
        deadConnections.push(clientId);
      }
    });

    // Clean up dead connections
    deadConnections.forEach(clientId => {
      this.removeConnection(clientId);
    });
  }

  /**
   * Broadcast event to all clients in a specific namespace
   */
  broadcastToNamespace(namespace: string, event: SSEEvent): void {
    const deadConnections: number[] = [];
    const clientIds = this.namespaceConnections.get(namespace);
    
    if (!clientIds || clientIds.size === 0) {
      console.log(`No clients connected to namespace: ${namespace}`);
      return;
    }

    console.log(`Broadcasting to namespace "${namespace}" with ${clientIds.size} clients`);
    
    clientIds.forEach(clientId => {
      const connection = this.connections.get(clientId);
      if (connection) {
        try {
          // Add namespace to event if not already present
          const namespacedEvent = { ...event, namespace };
          this.sendToConnection(connection, namespacedEvent);
        } catch (error) {
          console.error(`Failed to send event to client #${clientId} in namespace ${namespace}:`, error);
          deadConnections.push(clientId);
        }
      }
    });

    // Clean up dead connections
    deadConnections.forEach(clientId => {
      this.removeConnection(clientId);
    });
  }

  /**
   * Get current connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get connection count for a specific namespace
   */
  getConnectionCountByNamespace(namespace: string): number {
    const clientIds = this.namespaceConnections.get(namespace);
    return clientIds ? clientIds.size : 0;
  }

  /**
   * Manually trigger connection cleanup
   * Useful for testing or administrative purposes
   */
  forceCleanup(): void {
    const connectionCount = this.connections.size;
    console.log(`Manual connection cleanup triggered. Clearing ${connectionCount} connections.`);
    
    if (connectionCount > 0) {
      // Notify all clients that connections will be reset
      const cleanupEvent: SSEEvent = {
        id: this.generateEventId(),
        type: EventType.CONNECTION,
        data: {
          type: 'forced_cleanup',
          message: 'Manual connection cleanup - will reconnect shortly',
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };

      this.broadcastEvent(cleanupEvent);
      
      // Clear all connections after a brief delay
      setTimeout(() => {
        // Gracefully close all connections
        this.connections.forEach((connection, clientId) => {
          try {
            // Send a final close event before ending the connection
            const closeData = `id: ${this.generateEventId()}\nevent: close\ndata: {"type":"connection_closing"}\n\n`;
            connection.response.write(closeData);
            
            // Close the connection after a small delay
            setTimeout(() => {
              connection.response.end();
            }, 500);
          } catch (error) {
            console.error(`Error closing connection for client #${clientId}:`, error);
          }
        });
        
        this.connections.clear();
        console.log(`Manual cleanup completed. Active clients will reconnect.`);
      }, 3000); // Increased delay to 3 seconds for better message delivery
    }
  }

  /**
   * Manually trigger connection cleanup for a specific namespace
   * Useful for testing or administrative purposes
   */
  forceCleanupNamespace(namespace: string): void {
    const clientIds = this.namespaceConnections.get(namespace);
    
    if (!clientIds || clientIds.size === 0) {
      console.log(`No connections found in namespace: ${namespace}`);
      return;
    }

    const connectionCount = clientIds.size;
    console.log(`Manual namespace cleanup triggered for "${namespace}". Clearing ${connectionCount} connections.`);
    
    // Notify all clients in namespace that connections will be reset
    const cleanupEvent: SSEEvent = {
      id: this.generateEventId(),
      type: EventType.CONNECTION,
      data: {
        type: 'forced_cleanup',
        message: `Manual namespace cleanup - will reconnect shortly`,
        timestamp: new Date().toISOString(),
        namespace
      },
      timestamp: new Date().toISOString(),
      namespace
    };

    this.broadcastToNamespace(namespace, cleanupEvent);
    
    // Clear namespace connections after a brief delay
    setTimeout(() => {
      // Gracefully close connections in this namespace
      const currentClientIds = [...clientIds]; // Create copy as we'll be modifying the set
      currentClientIds.forEach(clientId => {
        const connection = this.connections.get(clientId);
        if (connection) {
          try {
            // Send a final close event before ending the connection
            const closeData = `id: ${this.generateEventId()}\nevent: close\ndata: {"type":"connection_closing","namespace":"${namespace}"}\n\n`;
            connection.response.write(closeData);
            
            // Close the connection after a small delay
            setTimeout(() => {
              connection.response.end();
            }, 500);
          } catch (error) {
            console.error(`Error closing connection for client #${clientId} in namespace ${namespace}:`, error);
          }
        }
        
        // Remove from tracking
        this.removeConnection(clientId);
      });
      
      console.log(`Manual namespace cleanup completed for "${namespace}". Active clients will reconnect.`);
    }, 3000); // Increased delay to 3 seconds for better message delivery
  }

  /**
   * Send event to a specific connection
   */
  private sendToConnection(connection: SSEConnection, event: SSEEvent): void {
    const response = connection.response;
    const sseData = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    response.write(sseData);
  }

  /**
   * Start heartbeat to keep connections alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const heartbeatEvent: SSEEvent = {
        id: this.generateEventId(),
        type: EventType.HEARTBEAT,
        data: {
          type: 'heartbeat',
          message: 'Heartbeat',
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };

      this.broadcastEvent(heartbeatEvent);
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Start periodic connection cleanup
   * Clears all connections at regular intervals - active clients will reconnect
   */
  private startConnectionCleanup(): void {
    this.connectionCleanupInterval = setInterval(() => {
      const connectionCount = this.connections.size;
      if (connectionCount > 0) {
        console.log(`Performing periodic connection cleanup. Clearing ${connectionCount} connections.`);
        
        // Notify all clients that connections will be reset
        const cleanupEvent: SSEEvent = {
          id: this.generateEventId(),
          type: EventType.CONNECTION,
          data: {
            type: 'cleanup',
            message: 'Connection cleanup - will reconnect shortly',
            timestamp: new Date().toISOString()
          },
          timestamp: new Date().toISOString()
        };

        this.broadcastEvent(cleanupEvent);
        
        // Clear all connections after a brief delay to ensure the cleanup event is sent
        setTimeout(() => {
          // Gracefully close all connections
          this.connections.forEach((connection, clientId) => {
            try {
              // Send a final close event before ending the connection
              const closeData = `id: ${this.generateEventId()}\nevent: close\ndata: {"type":"connection_closing"}\n\n`;
              connection.response.write(closeData);
              
              // Close the connection after a small delay
              setTimeout(() => {
                connection.response.end();
              }, 500);
            } catch (error) {
              console.error(`Error closing connection for client #${clientId}:`, error);
            }
          });
          
          this.connections.clear();
          console.log(`Connection cleanup completed. Active clients will reconnect.`);
        }, 3000); // Increased delay to 3 seconds for better message delivery
      }
    }, this.CONNECTION_CLEANUP_INTERVAL);
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.connectionCleanupInterval) {
      clearInterval(this.connectionCleanupInterval);
    }
    this.connections.clear();
  }
}
