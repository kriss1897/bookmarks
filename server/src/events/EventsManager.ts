import { IEventsManager, EventsConnection, ServerEvent } from '../types/events.js';

/**
 * Events Manager following Single Responsibility Principle
 * Responsible only for managing event connections and broadcasting events
 */
export class EventsManager implements IEventsManager {
  private connections: Map<number, EventsConnection> = new Map();
  private namespaceConnections: Map<string, Set<number>> = new Map();

  constructor() {
    console.log('EventsManager initialized');
  }

  /**
   * Add a new SSE connection with disconnect detection
   */
  addConnection(connection: EventsConnection): void {
    this.connections.set(connection.clientId, connection);

    // Add to namespace tracking
    if (!this.namespaceConnections.has(connection.namespace)) {
      this.namespaceConnections.set(connection.namespace, new Set());
    }
    this.namespaceConnections.get(connection.namespace)!.add(connection.clientId);

    // Set up disconnect detection
    this.setupDisconnectDetection(connection);

    console.log(
      `SSE connection added (Client #${connection.clientId}, Namespace: ${connection.namespace}). Total connections: ${this.connections.size}`,
    );
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
      console.log(
        `SSE connection removed (Client #${clientId}, Namespace: ${connection.namespace}). Total connections: ${this.connections.size}`,
      );
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcastEvent(event: ServerEvent): void {
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
    deadConnections.forEach((clientId) => {
      this.removeConnection(clientId);
    });
  }

  /**
   * Broadcast event to all clients in a specific namespace
   */
  broadcastToNamespace(namespace: string, event: ServerEvent): void {
    const deadConnections: number[] = [];
    const clientIds = this.namespaceConnections.get(namespace);

    if (!clientIds || clientIds.size === 0) {
      console.log(`No clients connected to namespace: ${namespace}`);
      return;
    }

    console.log(`Broadcasting to namespace "${namespace}" with ${clientIds.size} clients`);

    clientIds.forEach((clientId) => {
      const connection = this.connections.get(clientId);
      if (connection) {
        try {
          // Add namespace to event if not already present
          const namespacedEvent = { ...event, namespace };
          this.sendToConnection(connection, namespacedEvent);
        } catch (error) {
          console.error(
            `Failed to send event to client #${clientId} in namespace ${namespace}:`,
            error,
          );
          deadConnections.push(clientId);
        }
      }
    });

    // Clean up dead connections
    deadConnections.forEach((clientId) => {
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
   * Send event to a specific connection with validation
   */
  private sendToConnection(connection: EventsConnection, event: ServerEvent): void {
    const response = connection.response;

    // Check if the response is still writable
    if (response.destroyed || response.headersSent === false) {
      // Response is still active, we can write to it
    } else if (response.headersSent && !response.destroyed) {
      // Headers sent but connection still alive
    } else {
      throw new Error(`Connection ${connection.clientId} is no longer writable`);
    }

    try {
      const sseData = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
      response.write(sseData);
    } catch (error) {
      throw new Error(`Failed to write to connection ${connection.clientId}: ${error}`);
    }
  }

  /**
   * Set up automatic detection of client disconnections
   */
  private setupDisconnectDetection(connection: EventsConnection): void {
    const { response, clientId } = connection;

    // Detect when client closes the connection
    response.on('close', () => {
      console.log(`Client #${clientId} disconnected (close event)`);
      this.removeConnection(clientId);
    });

    // Detect when connection ends
    response.on('finish', () => {
      console.log(`Client #${clientId} connection finished`);
      this.removeConnection(clientId);
    });

    // Detect connection errors
    response.on('error', (error) => {
      console.error(`Client #${clientId} connection error:`, error);
      this.removeConnection(clientId);
    });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.connections.clear();
    this.namespaceConnections.clear();
  }
}
