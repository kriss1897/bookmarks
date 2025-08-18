/**
 * Converter utilities for transforming SSE server events into TreeBuilder operations
 */

import type { ServerEvent } from '../types/sse';
import type { TreeOperation, OperationEnvelope } from '../lib/builder/treeBuilder';

type OperationEventData = {
  id?: string;
  ts?: number;
  op?: TreeOperation & { type: string };
  [key: string]: unknown;
};

/**
 * Convert a server SSE event to a TreeOperation
 */
export function convertServerEventToOperation(event: ServerEvent): TreeOperation | null {
  const { type, data } = event;

  try {
    // New unified 'operation' event: server sends full envelope: { id, ts, op }
    if (type === 'operation' && typeof data === 'object' && data && 'op' in (data as OperationEventData)) {
      const op = (data as OperationEventData).op;
      if (!op?.type) {
        console.warn('[SSE Converter] Missing op.type in operation event');
        return null;
      }
      // Pass through operation as-is; it already matches TreeOperation schema
      return op as TreeOperation;
    }

    switch (type) {
      case 'bookmark_created':
        return {
          type: 'create_bookmark',
          id: data.id as string,
          parentId: data.parentId as string,
          title: data.title as string,
          url: data.url as string,
          index: data.index as number
        };

      case 'folder_created':
        return {
          type: 'create_folder',
          id: data.id as string,
          parentId: data.parentId as string,
          title: data.title as string,
          isOpen: data.isOpen as boolean,
          index: data.index as number
        };

      case 'bookmark_updated':
        // For updates, we might need to handle this differently
        // For now, treat as creation with updated data
        return {
          type: 'create_bookmark',
          id: data.id as string,
          parentId: data.parentId as string,
          title: data.title as string,
          url: data.url as string,
          index: data.index as number
        };

      case 'folder_updated':
        return {
          type: 'create_folder',
          id: data.id as string,
          parentId: data.parentId as string,
          title: data.title as string,
          isOpen: data.isOpen as boolean,
          index: data.index as number
        };

      case 'bookmark_deleted':
      case 'folder_deleted':
        return {
          type: 'remove_node',
          nodeId: data.id as string
        };

      case 'item_moved':
        return {
          // Map legacy move to new unified update_node
          type: 'update_node',
          nodeId: data.id as string,
          parentId: data.parentId as string,
          orderKey: data.orderKey as string
        };

  // folder_toggled event removed; server now emits explicit open_folder/close_folder

      case 'open_folder':
        return {
          type: 'open_folder',
          folderId: data.id as string
        };

      case 'close_folder':
        return {
          type: 'close_folder',
          folderId: data.id as string
        };

      default:
        console.warn(`[SSE Converter] Unhandled event type: ${type}`);
        return null;
    }
  } catch (error) {
    console.error(`[SSE Converter] Failed to convert event ${type}:`, error, data);
    return null;
  }
}

/**
 * Convert a server SSE event to a complete OperationEnvelope for persistence
 */
export function convertServerEventToEnvelope(event: ServerEvent): OperationEnvelope | null {
  // If the event already carries a full envelope (operation type), use it directly
  if (event.type === 'operation' && typeof event.data === 'object' && event.data && 'op' in (event.data as OperationEventData)) {
    const d = event.data as OperationEventData;
    const envelope: OperationEnvelope = {
      id: d.id ?? event.id,
      ts: typeof d.ts === 'number' ? d.ts : new Date(event.timestamp).getTime(),
      op: d.op!,
      remote: true,
      processed: true
    };
    return envelope;
  }

  const operation = convertServerEventToOperation(event);
  if (!operation) return null;

  return {
    id: event.id,
    ts: new Date(event.timestamp).getTime(),
    op: operation,
    remote: true,
    processed: true
  };
}

/**
 * Validate that server event has required data for conversion
 */
export function validateServerEventData(event: ServerEvent): boolean {
  const { type, data } = event;

  const commonFields = ['id'];
  const creationFields = ['parentId', 'title'];
  const bookmarkFields = ['url'];
  const moveFields = ['parentId'];

  try {
    // Special case first: new operation envelope shouldn't require legacy common fields on data
    if (type === 'operation') {
      const od = data as OperationEventData;
      const hasOp = typeof od?.op?.type === 'string';
      const hasId = typeof od?.id === 'string' || typeof event.id === 'string';
      const hasTs = typeof od?.ts === 'number' || typeof event.timestamp === 'string';
      if (!hasOp) console.warn(`[SSE Converter] Missing 'op.type' in operation event`);
      return !!(hasOp && hasId && hasTs);
    }

    // For legacy typed events, check common fields exist in data
    for (const field of commonFields) {
      if (!(field in data)) {
        console.warn(`[SSE Converter] Missing required field '${field}' in ${type} event`);
        return false;
      }
    }

    // Check type-specific fields for legacy events
    switch (type) {
      case 'bookmark_created':
      case 'bookmark_updated':
        return [...creationFields, ...bookmarkFields].every(field => {
          if (!data[field]) {
            console.warn(`[SSE Converter] Missing required field '${field}' in ${type} event`);
            return false;
          }
          return true;
        });

      case 'folder_created':
      case 'folder_updated':
        return creationFields.every(field => {
          if (!data[field]) {
            console.warn(`[SSE Converter] Missing required field '${field}' in ${type} event`);
            return false;
          }
          return true;
        });

      case 'item_moved':
  return moveFields.every(field => {
          if (!data[field]) {
            console.warn(`[SSE Converter] Missing required field '${field}' in ${type} event`);
            return false;
          }
          return true;
        });

      case 'bookmark_deleted':
      case 'folder_deleted':
        // Only need ID for these operations
        return true;

      default:
        return true;
    }
  } catch (error) {
    console.error(`[SSE Converter] Validation error for ${type}:`, error);
    return false;
  }
}
