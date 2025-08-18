export type EventType =
  | 'connection'
  | 'operation'
  | 'sync_status'
  | 'conflict'
  | 'bookmark_created'
  | 'bookmark_updated'
  | 'bookmark_deleted'
  | 'folder_created'
  | 'folder_updated'
  | 'folder_deleted'
  | 'item_moved'
  | 'open_folder'
  | 'close_folder';

export interface ServerEvent {
  id: string;
  type: EventType;
  data: Record<string, unknown>;
  timestamp: string;
  namespace?: string;
}

import { Response } from 'express';

export interface EventsConnection {
  id: string;
  response: Response;
  clientId: number;
  namespace: string;
}

export interface IEventsManager {
  addConnection(connection: EventsConnection): void;
  removeConnection(clientId: number): void;
  broadcastEvent(event: ServerEvent): void;
  broadcastToNamespace(namespace: string, event: ServerEvent): void;
  getConnectionCount(): number;
  getConnectionCountByNamespace(namespace: string): number;
}

export interface IEventPublisher {
  publishEvent(eventType: EventType, data: any): void;
  publishToNamespace(namespace: string, data: any): void;
}
