// Event types and interfaces following SOLID principles
import { Response } from 'express';

export interface ServerEvent {
  id: string;
  type: string;
  data: any;
  timestamp: string;
  namespace?: string; // Optional namespace for targeted events
}

export interface EventsConnection {
  id: string;
  response: Response;
  clientId: number;
  namespace: string; // Namespace this connection is subscribed to
}

export interface EventData {
  type: string;
  message: string;
  timestamp: string;
  data?: any;
}

// Event types enum for better type safety
export enum EventType {
  CONNECTION = 'connection',
  TRIGGER = 'trigger',
  HEARTBEAT = 'heartbeat',
  NOTIFICATION = 'notification'
}

// Interface for event publishers (Open/Closed Principle)
export interface IEventPublisher {
  publishEvent(eventType: EventType, data: any): void;
}

// Interface for Events manager (Dependency Inversion Principle)
export interface IEventsManager {
  addConnection(connection: EventsConnection): void;
  removeConnection(clientId: number): void;
  broadcastEvent(event: ServerEvent): void;
  broadcastToNamespace(namespace: string, event: ServerEvent): void;
  getConnectionCount(): number;
  getConnectionCountByNamespace(namespace: string): number;
  forceCleanup(): void;
  forceCleanupNamespace(namespace: string): void;
}
