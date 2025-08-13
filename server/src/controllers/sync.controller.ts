import { Request, Response } from 'express';
import { BookmarkService } from '../services/bookmarkService.js';
import { EventPublisher } from '../services/EventPublisher.js';

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

export class SyncController {
  private bookmarkService: BookmarkService;
  private eventPublisher: EventPublisher;

  constructor(eventPublisher: EventPublisher) {
    this.bookmarkService = new BookmarkService();
    this.eventPublisher = eventPublisher;
  }

  // POST /api/sync/:namespace/operations
  syncOperations = async (req: Request, res: Response): Promise<void> => {
    try {
      const { namespace } = req.params;
      const { operations }: SyncRequest = req.body;

      if (!operations || !Array.isArray(operations)) {
        res.status(400).json({
          success: false,
          error: 'Invalid request: operations array required'
        });
        return;
      }

      const applied: SyncResponse['applied'] = [];
      const mappings: Record<string, number> = {};
      const updatedItems: any[] = [];
      const serverTimestamp = Date.now();

      // Process operations in order (important for consistency)
      for (const operation of operations) {
        try {
          const result = await this.processOperation(namespace, operation);
          
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
  };

  private async processOperation(
    namespace: string, 
    operation: SyncOperation
  ): Promise<{ success: boolean; serverId?: number; tempId?: string | number; error?: string }> {
    
    switch (operation.type) {
      case 'CREATE_FOLDER': {
        const { id: tempId, name, parentId } = operation.payload;
        
        // Check if we already processed this operation (idempotency)
        const existing = await this.bookmarkService.findByTempId(namespace, tempId);
        if (existing) {
          return {
            success: true,
            serverId: existing.id,
            tempId
          };
        }

        const folder = await this.bookmarkService.createFolderWithTempId(namespace, {
          name,
          parentId: parentId || null,
          tempId
        });

        // Broadcast the folder creation event
        this.eventPublisher.publishToNamespace(namespace, {
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
        const existing = await this.bookmarkService.findByTempId(namespace, tempId);
        if (existing) {
          return {
            success: true,
            serverId: existing.id,
            tempId
          };
        }

        const bookmark = await this.bookmarkService.createBookmarkWithTempId(namespace, {
          title: name,
          url,
          parentId: parentId || null,
          favorite: isFavorite,
          tempId
        });

        // Broadcast the bookmark creation event
        this.eventPublisher.publishToNamespace(namespace, {
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
        const serverId = await this.resolveId(namespace, id);
        if (!serverId) {
          return {
            success: false,
            error: 'Item not found'
          };
        }

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (isOpen !== undefined) updates.open = isOpen;

        await this.bookmarkService.updateItem(namespace, serverId, updates);

        // If this is a toggle operation, broadcast the folder toggle event
        if (isOpen !== undefined) {
          this.eventPublisher.publishToNamespace(namespace, {
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
        const serverId = await this.resolveId(namespace, id);
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

        await this.bookmarkService.updateItem(namespace, serverId, updates);

        // If this is a favorite toggle operation, broadcast the event
        if (isFavorite !== undefined) {
          this.eventPublisher.publishToNamespace(namespace, {
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
        const serverId = await this.resolveId(namespace, id);
        if (!serverId) {
          // Item already deleted or doesn't exist - that's fine for idempotency
          return {
            success: true
          };
        }

        await this.bookmarkService.deleteItem(serverId);

        // Broadcast the item deletion event
        this.eventPublisher.publishToNamespace(namespace, {
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
        const serverId = await this.resolveId(namespace, id);
        if (!serverId) {
          return {
            success: false,
            error: 'Item not found'
          };
        }

        let resolvedNewParentId: number | null = null;
        if (newParentId !== undefined && newParentId !== null) {
          resolvedNewParentId = await this.resolveId(namespace, newParentId);
        }

        let resolvedAfterId: number | undefined = undefined;
        if (afterId !== undefined && afterId !== null) {
          resolvedAfterId = await this.resolveId(namespace, afterId) || undefined;
        }

        await this.bookmarkService.moveItem(serverId, resolvedNewParentId, resolvedAfterId);

        // Broadcast the item move event
        this.eventPublisher.publishToNamespace(namespace, {
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
  private async resolveId(
    namespace: string, 
    id: string | number
  ): Promise<number | null> {
    if (typeof id === 'number') {
      return id; // Already a server ID
    }

    // It's a temp ID, resolve it
    const item = await this.bookmarkService.findByTempId(namespace, id);
    return item ? item.id : null;
  }
}
