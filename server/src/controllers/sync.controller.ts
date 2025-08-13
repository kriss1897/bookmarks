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
    serverId?: string;
    tempId?: string;
    error?: string;
  }[];
  updatedItems: any[]; // Items that were updated/created
  mappings: Record<string, string>; // tempId -> serverId mappings (now mostly empty with UUIDs)
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
      const mappings: Record<string, string> = {};
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

          // With UUIDs, mappings are rarely needed since client generates final IDs
          if (result.success && result.tempId && result.serverId && result.tempId !== result.serverId) {
            mappings[result.tempId] = result.serverId;
          }

          // Since we're broadcasting events via SSE, clients will be notified
          // of changes and can fetch updated data as needed
          
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
  ): Promise<{ success: boolean; serverId?: string; tempId?: string; error?: string }> {
    
    switch (operation.type) {
      case 'CREATE_FOLDER': {
        const { id: tempId, name, parentId, orderIndex } = operation.payload;
        
        // With UUIDs, check if item already exists (idempotency)
        const existing = await this.itemExists(namespace, tempId);
        if (existing) {
          return {
            success: true,
            serverId: tempId,
            tempId
          };
        }

        if (!orderIndex || typeof orderIndex !== 'string') {
          return { success: false, error: 'orderIndex is required' };
        }

        const folder = await this.bookmarkService.createFolderWithId(namespace, {
          id: tempId,
          name,
          parentId: parentId || null,
          orderIndex
        });

        // Broadcast the folder creation event
        this.eventPublisher.publishToNamespace(namespace, {
          type: 'folder_created',
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
          orderIndex: folder.orderIndex,
          isOpen: folder.open,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          timestamp: new Date().toISOString(),
        });

        return {
          success: true,
          serverId: folder.id,
          tempId
        };
      }

      case 'CREATE_BOOKMARK': {
        const { id: tempId, name, url, parentId, isFavorite = false, orderIndex } = operation.payload;
        
        // With UUIDs, check if item already exists (idempotency)
        const existing = await this.itemExists(namespace, tempId);
        if (existing) {
          return {
            success: true,
            serverId: tempId,
            tempId
          };
        }

        if (!orderIndex || typeof orderIndex !== 'string') {
          return { success: false, error: 'orderIndex is required' };
        }

        const bookmark = await this.bookmarkService.createBookmarkWithId(namespace, {
          id: tempId,
          title: name,
          url,
          parentId: parentId || null,
          favorite: isFavorite,
          orderIndex
        });

        // Broadcast the bookmark creation event
        this.eventPublisher.publishToNamespace(namespace, {
          type: 'bookmark_created',
          id: bookmark.id,
          name: bookmark.title,
          url: bookmark.url,
          parentId: bookmark.parentId,
          orderIndex: bookmark.orderIndex,
          isFavorite: bookmark.favorite,
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
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
        
        // With UUIDs, ID is final - no resolution needed
        const itemExists = await this.itemExists(namespace, id);
        if (!itemExists) {
          return {
            success: false,
            error: 'Item not found'
          };
        }

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (isOpen !== undefined) updates.open = isOpen;

        await this.bookmarkService.updateItem(namespace, id, updates);

        // If this is a toggle operation, broadcast the folder toggle event
        if (isOpen !== undefined) {
          this.eventPublisher.publishToNamespace(namespace, {
            type: 'folder_toggled',
            id: id,
            isOpen: isOpen,
            timestamp: new Date().toISOString(),
          });
        }

        return {
          success: true,
          serverId: id
        };
      }

      case 'UPDATE_BOOKMARK': {
        const { id, name, url, isFavorite } = operation.payload;
        
        // With UUIDs, ID is final - no resolution needed
        const itemExists = await this.itemExists(namespace, id);
        if (!itemExists) {
          return {
            success: false,
            error: 'Item not found'
          };
        }

        const updates: any = {};
        if (name !== undefined) updates.title = name;
        if (url !== undefined) updates.url = url;
        if (isFavorite !== undefined) updates.favorite = isFavorite;

        await this.bookmarkService.updateItem(namespace, id, updates);

        // If this is a favorite toggle operation, broadcast the event
        if (isFavorite !== undefined) {
          this.eventPublisher.publishToNamespace(namespace, {
            type: 'bookmark_favorite_toggled',
            id: id,
            isFavorite: isFavorite,
            timestamp: new Date().toISOString(),
          });
        }

        return {
          success: true,
          serverId: id
        };
      }

      case 'DELETE_ITEM': {
        const { id } = operation.payload;
        
        // With UUIDs, check if item exists
        const itemExists = await this.itemExists(namespace, id);
        if (!itemExists) {
          // Item already deleted or doesn't exist - that's fine for idempotency
          return {
            success: true,
            serverId: id
          };
        }

        await this.bookmarkService.deleteItem(id);

        // Broadcast the item deletion event
        this.eventPublisher.publishToNamespace(namespace, {
          type: 'item_deleted',
          id: id,
          timestamp: new Date().toISOString(),
        });

        return {
          success: true,
          serverId: id
        };
      }

      case 'MOVE_ITEM': {
        const { id, newParentId, targetOrderIndex } = operation.payload;
        
        // With UUIDs, no ID resolution needed - validate existence
        const itemExists = await this.itemExists(namespace, id);
        if (!itemExists) {
          return {
            success: false,
            error: 'Item not found'
          };
        }

        // Validate parent exists if specified
        if (newParentId !== undefined && newParentId !== null) {
          const parentExists = await this.itemExists(namespace, newParentId);
          if (!parentExists) {
            return {
              success: false,
              error: 'Parent item not found'
            };
          }
        }

        if (!targetOrderIndex || typeof targetOrderIndex !== 'string') {
          return { success: false, error: 'targetOrderIndex is required' };
        }

        await this.bookmarkService.moveItem(id, newParentId || null, targetOrderIndex);

        // Broadcast the item move event
        this.eventPublisher.publishToNamespace(namespace, {
          type: 'item_moved',
          id: id,
          newParentId: newParentId || null,
          targetOrderIndex,
          timestamp: new Date().toISOString(),
        });

        return {
          success: true,
          serverId: id
        };
      }

      default:
        return {
          success: false,
          error: `Unknown operation type: ${(operation as any).type}`
        };
    }
  }

  // Helper function to check if an item exists
  private async itemExists(namespace: string, id: string): Promise<boolean> {
    try {
      const items = await this.bookmarkService.getNamespaceItems(namespace);
      return items.some(item => item.id === id);
    } catch (error) {
      console.error('Error checking if item exists:', error);
      return false;
    }
  }
}
