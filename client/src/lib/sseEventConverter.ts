/**
 * Converter utilities for transforming SSE server events into TreeBuilder operations
 */

import type { ServerEvent } from '../types/sse';
import type { TreeOperation, OperationEnvelope } from '../lib/builder/treeBuilder';

/**
 * Convert a server SSE event to a TreeOperation
 */
export function convertServerEventToOperation(event: ServerEvent): TreeOperation | null {
  const { type, data } = event;

  try {
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
          type: 'move_node',
          nodeId: data.id as string,
          toFolderId: data.parentId as string,
          index: data.index as number
        };

      case 'folder_toggled':
        return {
          type: 'toggle_folder',
          folderId: data.id as string,
          open: data.isOpen as boolean
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
  const operation = convertServerEventToOperation(event);
  if (!operation) {
    return null;
  }

  return {
    id: event.id, // Use server-provided event ID
    ts: new Date(event.timestamp).getTime(), // Convert ISO timestamp to epoch ms
    op: operation,
    remote: true, // Mark as remote operation
    processed: true // Mark as already processed by server
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
    // Check common fields
    for (const field of commonFields) {
      if (!data[field]) {
        console.warn(`[SSE Converter] Missing required field '${field}' in ${type} event`);
        return false;
      }
    }

    // Check type-specific fields
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
      case 'folder_toggled':
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
