import { Router, Request, Response } from 'express';
import { BookmarkService } from '../db/bookmarkService';
import { EventPublisher } from '../services/EventPublisher';

export function createSyncRouter(eventPublisher: EventPublisher) {
  const syncRouter = Router();

// Types for sync operations
interface SyncOperation {
  id: string;
  type: 'CREATE_FOLDER' | 'CREATE_BOOKMARK' | 'UPDATE_FOLDER' | 'UPDATE_BOOKMARK' | 'DELETE_ITEM' | 'MOVE_ITEM';
  payload: any;
  timestamp: number;
}

interface SyncRequest {
  operations: SyncOperation[];
}

interface SyncResponse {
  applied: {
    operationId: string;
    status: 'success' | 'failed';
    serverId?: number;
    tempId?: string | number;
    error?: string;
  }[];
  updatedItems: any[]; // Items that were updated/created
  mappings: Record<string, number>; // tempId -> serverId mappings
  serverTimestamp: number;
}

// POST /api/sync/:namespace/operations
syncRouter.post('/:namespace/operations', async (req: Request, res: Response) => {
  try {
    const { namespace } = req.params;
    const { operations }: SyncRequest = req.body;

    if (!operations || !Array.isArray(operations)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: operations array required'
      });
    }

    const bookmarkService = new BookmarkService();
    const applied: SyncResponse['applied'] = [];
    const mappings: Record<string, number> = {};
    const updatedItems: any[] = [];
    const serverTimestamp = Date.now();

    // Process operations in order (important for consistency)
    for (const operation of operations) {
      try {
        const result = await processOperation(bookmarkService, namespace, operation, eventPublisher);
        
        // Convert to expected format
        const appliedOp = {
          operationId: operation.id,
          status: result.success ? 'success' as const : 'failed' as const,
          serverId: result.serverId,
          tempId: result.tempId,
          error: result.error
        };
        
        applied.push(appliedOp);

        // Build ID mappings for temp -> server ID
        if (result.success && result.tempId && result.serverId) {
          mappings[result.tempId.toString()] = result.serverId;
        }

        // TODO: Add updated items if needed for state reconciliation
        // updatedItems.push(...);
        
      } catch (error) {
        console.error(`Error processing operation ${operation.id}:`, error);
        applied.push({
          operationId: operation.id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const response: SyncResponse = {
      applied,
      updatedItems,
      mappings,
      serverTimestamp
    };

    res.json(response);
  } catch (error) {
    console.error('Sync endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

async function processOperation(
  bookmarkService: BookmarkService, 
  namespace: string, 
  operation: SyncOperation,
  eventPublisher: EventPublisher
): Promise<{ success: boolean; serverId?: number; tempId?: string | number; error?: string }> {
  
  switch (operation.type) {
    case 'CREATE_FOLDER': {
      const { id: tempId, name, parentId } = operation.payload;
      
      // Check if we already processed this operation (idempotency)
      const existing = await bookmarkService.findByTempId(namespace, tempId);
      if (existing) {
        return {
          success: true,
          serverId: existing.id,
          tempId
        };
      }

      const folder = await bookmarkService.createFolderWithTempId(namespace, {
        name,
        parentId: parentId || null,
        tempId
      });

      // Broadcast the folder creation event
      eventPublisher.publishToNamespace(namespace, {
        type: 'folder_created',
        data: folder,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        serverId: folder.id,
        tempId
      };
    }

    case 'CREATE_BOOKMARK': {
      const { id: tempId, name, url, parentId, isFavorite = false } = operation.payload;
      
      // Check if we already processed this operation (idempotency)
      const existing = await bookmarkService.findByTempId(namespace, tempId);
      if (existing) {
        return {
          success: true,
          serverId: existing.id,
          tempId
        };
      }

      const bookmark = await bookmarkService.createBookmarkWithTempId(namespace, {
        title: name,
        url,
        parentId: parentId || null,
        favorite: isFavorite,
        tempId
      });

      // Broadcast the bookmark creation event
      eventPublisher.publishToNamespace(namespace, {
        type: 'bookmark_created',
        data: bookmark,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        serverId: bookmark.id,
        tempId
      };
    }

    case 'UPDATE_FOLDER': {
      const { id, name, isOpen } = operation.payload;
      
      // Resolve temp ID to server ID if needed
      const serverId = await resolveId(bookmarkService, namespace, id);
      if (!serverId) {
        return {
          success: false,
          error: 'Item not found'
        };
      }

      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (isOpen !== undefined) updates.open = isOpen;

      await bookmarkService.updateItem(namespace, serverId, updates);

      // If this is a toggle operation, broadcast the folder toggle event
      if (isOpen !== undefined) {
        eventPublisher.publishToNamespace(namespace, {
          type: 'folder_toggled',
          data: { 
            folderId: serverId, 
            open: isOpen 
          },
          timestamp: new Date().toISOString(),
        });
      }

      return {
        success: true,
        serverId
      };
    }

    case 'UPDATE_BOOKMARK': {
      const { id, name, url, isFavorite } = operation.payload;
      
      // Resolve temp ID to server ID if needed
      const serverId = await resolveId(bookmarkService, namespace, id);
      if (!serverId) {
        return {
          success: false,
          error: 'Item not found'
        };
      }

      const updates: any = {};
      if (name !== undefined) updates.title = name;
      if (url !== undefined) updates.url = url;
      if (isFavorite !== undefined) updates.favorite = isFavorite;

      await bookmarkService.updateItem(namespace, serverId, updates);

      // If this is a favorite toggle operation, broadcast the event
      if (isFavorite !== undefined) {
        eventPublisher.publishToNamespace(namespace, {
          type: 'bookmark_favorite_toggled',
          data: { 
            bookmarkId: serverId, 
            favorite: isFavorite 
          },
          timestamp: new Date().toISOString(),
        });
      }

      return {
        success: true,
        serverId
      };
    }

    case 'DELETE_ITEM': {
      const { id } = operation.payload;
      
      // Resolve temp ID to server ID if needed
      const serverId = await resolveId(bookmarkService, namespace, id);
      if (!serverId) {
        // Item already deleted or doesn't exist - that's fine for idempotency
        return {
          success: true
        };
      }

      await bookmarkService.deleteItem(serverId);

      // Broadcast the item deletion event
      eventPublisher.publishToNamespace(namespace, {
        type: 'item_deleted',
        data: { itemId: serverId },
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        serverId
      };
    }

    case 'MOVE_ITEM': {
      const { id, newParentId, afterId } = operation.payload;
      
      // Resolve all IDs
      const serverId = await resolveId(bookmarkService, namespace, id);
      if (!serverId) {
        return {
          success: false,
          error: 'Item not found'
        };
      }

      let resolvedNewParentId: number | null = null;
      if (newParentId !== undefined && newParentId !== null) {
        resolvedNewParentId = await resolveId(bookmarkService, namespace, newParentId);
      }

      let resolvedAfterId: number | undefined = undefined;
      if (afterId !== undefined && afterId !== null) {
        resolvedAfterId = await resolveId(bookmarkService, namespace, afterId) || undefined;
      }

      await bookmarkService.moveItem(serverId, resolvedNewParentId, resolvedAfterId);

      // Broadcast the item move event
      eventPublisher.publishToNamespace(namespace, {
        type: 'item_moved',
        data: { 
          itemId: serverId, 
          newParentId: resolvedNewParentId, 
          afterItemId: resolvedAfterId || null 
        },
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        serverId
      };
    }

    default:
      return {
        success: false,
        error: `Unknown operation type: ${(operation as any).type}`
      };
  }
}

// Helper function to resolve temp IDs to server IDs
async function resolveId(
  bookmarkService: BookmarkService, 
  namespace: string, 
  id: string | number
): Promise<number | null> {
  if (typeof id === 'number') {
    return id; // Already a server ID
  }

  // It's a temp ID, resolve it
  const item = await bookmarkService.findByTempId(namespace, id);
  return item ? item.id : null;
}

  return syncRouter;
}
