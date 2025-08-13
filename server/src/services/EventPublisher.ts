import { IEventPublisher, IEventsManager, EventType, SSEEvent } from '../types/events.js';

/**
 * Event Publisher following Single Responsibility Principle
 * Responsible only for publishing events to the SSE manager
 */
export class EventPublisher implements IEventPublisher {
  constructor(private eventsManager: IEventsManager) {}

  /**
   * Publish an event to all connected clients
   */
  publishEvent(eventType: EventType, data: any): void {
    const event: SSEEvent = {
      id: this.generateEventId(),
      type: eventType,
      data: {
        type: eventType,
        message: data.message || `Event: ${eventType}`,
        timestamp: new Date().toISOString(),
        ...data
      },
      timestamp: new Date().toISOString()
    };

    console.log(`Publishing event: ${eventType} to ${this.eventsManager.getConnectionCount()} clients`);
    this.eventsManager.broadcastEvent(event);
  }

  /**
   * Publish an event to all clients in a specific namespace
   */
  publishToNamespace(namespace: string, data: any): void {
    const event: SSEEvent = {
      id: this.generateEventId(),
      type: data.type || 'update',
      data: {
        ...data,
        namespace,
        timestamp: data.timestamp || new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      namespace
    };

    console.log(`Publishing event to namespace "${namespace}": ${data.type}`);
    this.eventsManager.broadcastToNamespace(namespace, event);
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
