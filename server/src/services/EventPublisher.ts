import { IEventPublisher, ISSEManager, EventType, SSEEvent } from '../types/events.js';

/**
 * Event Publisher following Single Responsibility Principle
 * Responsible only for publishing events to the SSE manager
 */
export class EventPublisher implements IEventPublisher {
  constructor(private sseManager: ISSEManager) {}

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

    console.log(`Publishing event: ${eventType} to ${this.sseManager.getConnectionCount()} clients`);
    this.sseManager.broadcastEvent(event);
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
