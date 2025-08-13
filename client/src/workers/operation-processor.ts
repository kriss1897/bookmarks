import type { 
  Operation, 
  CreateBookmarkPayload,
  CreateFolderPayload,
  UpdateBookmarkPayload,
  UpdateFolderPayload,
  DeleteItemPayload,
  MoveItemPayload 
} from '../types/operations';
import type { WorkerEventType } from './worker-types';
import type { DatabaseManager } from './database-manager';

export class OperationProcessor {
  private clientId: string;
  private eventEmitter: (event: WorkerEventType, data: unknown) => void;
  private databaseManager: DatabaseManager;

  constructor(
    clientId: string,
    eventEmitter: (event: WorkerEventType, data: unknown) => void,
    databaseManager: DatabaseManager
  ) {
    this.clientId = clientId;
    this.eventEmitter = eventEmitter;
    this.databaseManager = databaseManager;
  }

  async enqueueOperation(namespace: string, operation: Omit<Operation, 'clientId'>): Promise<void> {
    // Generate UUIDs for CREATE operations if they don't have IDs
    // This eliminates the need for temporary IDs and complex ID mapping during sync
    let modifiedOperation = operation;
    if ((operation.type === 'CREATE_BOOKMARK' || operation.type === 'CREATE_FOLDER') && !operation.payload.id) {
      modifiedOperation = {
        ...operation,
        payload: {
          ...operation.payload,
          id: this.generateUUID()
        }
      };
    }

    const fullOperation: Operation = {
      ...modifiedOperation,
      clientId: this.clientId
    };

    try {
      await this.databaseManager.enqueueOperationInDB(fullOperation);
      await this.applyOperationOptimistically(fullOperation);
      
      this.eventEmitter('dataChanged', { namespace });
      
      console.log(`Operation enqueued: ${operation.type} for namespace: ${namespace}`);
    } catch (error) {
      console.error('Error enqueuing operation:', error);
      this.eventEmitter('error', { 
        reason: 'Failed to enqueue operation',
        operationId: operation.id 
      });
      throw error;
    }
  }

  async applyOperationOptimistically(operation: Operation): Promise<void> {
    const db = this.databaseManager.database;
    if (!db) return;
    
    const transaction = db.transaction(['bookmarks', 'folders'], 'readwrite');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    const now = Date.now();
    
    try {
      switch (operation.type) {
        case 'CREATE_BOOKMARK': {
          const payload = operation.payload as CreateBookmarkPayload;
          const bookmark = {
            id: payload.id,
            name: payload.name,
            url: payload.url,
            parentId: payload.parentId,
            isFavorite: payload.isFavorite || false,
            namespace: operation.namespace,
            orderIndex: payload.orderIndex,
            createdAt: now,
            updatedAt: now
          };
          await this.databaseManager.putInStore(bookmarksStore, bookmark);
          break;
        }
        
        case 'CREATE_FOLDER': {
          const payload = operation.payload as CreateFolderPayload;
          const folder = {
            id: payload.id,
            name: payload.name,
            parentId: payload.parentId,
            isOpen: false,
            namespace: operation.namespace,
            orderIndex: payload.orderIndex,
            createdAt: now,
            updatedAt: now
          };
          await this.databaseManager.putInStore(foldersStore, folder);
          break;
        }
        
        case 'UPDATE_BOOKMARK': {
          const payload = operation.payload as UpdateBookmarkPayload;
          const existing = await this.databaseManager.getFromStore(bookmarksStore, payload.id);
          if (existing) {
            const updated = {
              ...existing,
              ...(payload.name !== undefined && { name: payload.name }),
              ...(payload.url !== undefined && { url: payload.url }),
              ...(payload.isFavorite !== undefined && { isFavorite: payload.isFavorite }),
              updatedAt: now
            };
            await this.databaseManager.putInStore(bookmarksStore, updated);
          }
          break;
        }
        
        case 'UPDATE_FOLDER': {
          const payload = operation.payload as UpdateFolderPayload;
          const existing = await this.databaseManager.getFromStore(foldersStore, payload.id);
          if (existing) {
            const updated = {
              ...existing,
              ...(payload.name !== undefined && { name: payload.name }),
              ...(payload.isOpen !== undefined && { isOpen: payload.isOpen }),
              updatedAt: now
            };
            await this.databaseManager.putInStore(foldersStore, updated);
          }
          break;
        }
        
        case 'DELETE_ITEM': {
          const payload = operation.payload as DeleteItemPayload;
          
          // First check if it's a folder, and if so, recursively delete all children
          const folderToDelete = await this.databaseManager.getFromStore(foldersStore, payload.id);
          if (folderToDelete) {
            // Recursively delete all children of this folder
            await this.databaseManager.deleteChildrenRecursively(bookmarksStore, foldersStore, payload.id.toString(), operation.namespace);
          }
          
          // Delete the item itself (folder or bookmark)
          await Promise.all([
            this.databaseManager.deleteFromStore(bookmarksStore, payload.id),
            this.databaseManager.deleteFromStore(foldersStore, payload.id)
          ]);
          break;
        }
        
        case 'MOVE_ITEM': {
          const payload = operation.payload as MoveItemPayload;
          const [bookmark, folder] = await Promise.all([
            this.databaseManager.getFromStore(bookmarksStore, payload.id),
            this.databaseManager.getFromStore(foldersStore, payload.id)
          ]);

          if (bookmark) {
            await this.databaseManager.putInStore(bookmarksStore, {
              ...bookmark,
              parentId: payload.newParentId,
              orderIndex: (payload as MoveItemPayload).targetOrderIndex,
              updatedAt: now
            });
          }

          if (folder) {
            await this.databaseManager.putInStore(foldersStore, {
              ...folder,
              parentId: payload.newParentId,
              orderIndex: (payload as MoveItemPayload).targetOrderIndex,
              updatedAt: now
            });
          }
          break;
        }
      }
    } catch (error) {
      console.error('Error applying operation optimistically:', error);
      throw error;
    }
  }

  async fetchInitialData(namespace: string, isOnline: boolean): Promise<void> {
    if (!isOnline) {
      console.log('Offline - skipping initial server data fetch');
      return;
    }

    try {
      console.log(`Fetching initial server data for namespace: ${namespace}`);
      
      const response = await fetch(`/api/bookmarks/${encodeURIComponent(namespace)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success && result.data) {
        console.log(`Received ${result.data.length} items from server for namespace: ${namespace}`);
        
        const serverItems = result.data.map((item: Record<string, unknown>) => ({
          id: item.id,
          type: item.type,
          namespace: item.namespace,
          parentId: item.parentId,
          orderIndex: item.orderIndex,
          createdAt: item.createdAt || Date.now(),
          updatedAt: item.updatedAt || Date.now(),
          ...(item.type === 'bookmark' ? {
            title: item.title,
            url: item.url,
            favorite: item.favorite
          } : {
            name: item.name,
            open: item.open
          })
        }));

        await this.databaseManager.reconcileWithServer(namespace, serverItems);
        await this.databaseManager.updateLastSync(namespace, this.clientId);
        
        console.log(`Initial sync completed for namespace: ${namespace}`);
        this.eventEmitter('dataChanged', { namespace, type: 'initialDataLoaded', itemCount: serverItems.length });
      }
    } catch (error) {
      console.error(`Failed to fetch initial server data for namespace ${namespace}:`, error);
      this.eventEmitter('error', { namespace, type: 'initialDataError', error: (error as Error).message });
      throw error;
    }
  }

  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}
