import type { WorkerEventType, StoredBookmark, StoredFolder } from './worker-types';
import type { DatabaseManager } from './database-manager';

export class EventManager {
  private eventHandlers = new Map<WorkerEventType, Set<(data: unknown) => void>>();
  private databaseManager: DatabaseManager;

  constructor(databaseManager: DatabaseManager) {
    this.databaseManager = databaseManager;
  }

  async addEventListener(event: WorkerEventType, handler: (data: unknown) => void): Promise<void> {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    // Handler is automatically proxied by Comlink when passed through the API
    this.eventHandlers.get(event)!.add(handler);
  }

  async removeEventListener(event: WorkerEventType, handler: (data: unknown) => void): Promise<void> {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  emit(event: WorkerEventType, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error('Error in event handler:', error);
        }
      });
    }
  }

  /**
   * Handle server events that should update local IndexedDB state
   */
  async handleServerStateUpdate(namespace: string, eventType: string, data: Record<string, unknown>): Promise<void> {
    const db = this.databaseManager.database;
    if (!db) return;
    
    try {
      const transaction = db.transaction(['bookmarks', 'folders'], 'readwrite');
      const bookmarksStore = transaction.objectStore('bookmarks');
      const foldersStore = transaction.objectStore('folders');
      const now = Date.now();
      
      // Normalize payload: server may nest actual payload under `data`
      const baseObj = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {} as Record<string, unknown>;
      const payload = (('data' in baseObj) && typeof baseObj['data'] === 'object' && baseObj['data'] !== null)
        ? (baseObj['data'] as Record<string, unknown>)
        : baseObj;
      
      switch (eventType) {
        case 'item_deleted':
        case 'folder_deleted':
        case 'bookmark_deleted': {
          const itemId = (payload['id'] as string) || (payload['itemId'] as string);
          if (itemId) {
            console.log(`Deleting item ${itemId} from local state due to server event`);
            
            // Check if it's a folder and delete children recursively
            const folderToDelete = await this.databaseManager.getFromStore(foldersStore, itemId);
            if (folderToDelete) {
              await this.databaseManager.deleteChildrenRecursively(bookmarksStore, foldersStore, itemId, namespace);
            }
            
            // Delete the item itself
            await Promise.all([
              this.databaseManager.deleteFromStore(bookmarksStore, itemId),
              this.databaseManager.deleteFromStore(foldersStore, itemId)
            ]);
            
            // Emit data changed event so UI updates
            this.emit('dataChanged', { namespace, type: 'serverUpdate' });
          }
          break;
        }
        
        case 'folder_created': {
          const folderId = payload['id'] as string;
          const folderName = payload['name'] as string;
          const orderIdx = (payload['orderIndex'] as string) || (payload['targetOrderIndex'] as string) || '';
          if (folderId && folderName) {
            console.log(`Adding folder ${folderId} to local state due to server event`);
            const folder: StoredFolder = {
              id: folderId,
              name: folderName,
              parentId: payload['parentId'] as string | undefined,
              isOpen: (payload['isOpen'] as boolean) || false,
              namespace,
              orderIndex: orderIdx,
              createdAt: (payload['createdAt'] as number) || now,
              updatedAt: (payload['updatedAt'] as number) || now
            };
            await this.databaseManager.putInStore(foldersStore, folder);
            this.emit('dataChanged', { namespace, type: 'serverUpdate' });
          }
          break;
        }
        
        case 'bookmark_created': {
          const bookmarkId = payload['id'] as string;
          const bookmarkName = payload['name'] as string;
          const bookmarkUrl = payload['url'] as string;
          const orderIdx = (payload['orderIndex'] as string) || (payload['targetOrderIndex'] as string) || '';
          if (bookmarkId && bookmarkName && bookmarkUrl) {
            console.log(`Adding bookmark ${bookmarkId} to local state due to server event`);
            const bookmark: StoredBookmark = {
              id: bookmarkId,
              name: bookmarkName,
              url: bookmarkUrl,
              parentId: payload['parentId'] as string | undefined,
              isFavorite: (payload['isFavorite'] as boolean) || false,
              namespace,
              orderIndex: orderIdx,
              createdAt: (payload['createdAt'] as number) || now,
              updatedAt: (payload['updatedAt'] as number) || now
            };
            await this.databaseManager.putInStore(bookmarksStore, bookmark);
            this.emit('dataChanged', { namespace, type: 'serverUpdate' });
          }
          break;
        }
        
        case 'item_moved': {
          const itemId = (payload['id'] as string) || (payload['itemId'] as string);
          const newParentId = payload['newParentId'] as string | undefined;
          const targetOrderIndex = payload['targetOrderIndex'] as string | undefined;
          if (itemId && newParentId !== undefined) {
            console.log(`Moving item ${itemId} to parent ${newParentId} due to server event`);
            const [bookmark, folder] = await Promise.all([
              this.databaseManager.getFromStore(bookmarksStore, itemId),
              this.databaseManager.getFromStore(foldersStore, itemId)
            ]);

            if (bookmark) {
              await this.databaseManager.putInStore(bookmarksStore, {
                ...bookmark,
                parentId: newParentId,
                orderIndex: targetOrderIndex || (bookmark as StoredBookmark).orderIndex,
                updatedAt: now
              });
              this.emit('dataChanged', { namespace, type: 'serverUpdate' });
            }

            if (folder) {
              await this.databaseManager.putInStore(foldersStore, {
                ...folder,
                parentId: newParentId,
                orderIndex: targetOrderIndex || (folder as StoredFolder).orderIndex,
                updatedAt: now
              });
              this.emit('dataChanged', { namespace, type: 'serverUpdate' });
            }
          }
          break;
        }
        
        case 'folder_toggled': {
          const folderId = (payload['id'] as string) || (payload['folderId'] as string);
          const isOpen = (payload['isOpen'] as boolean) ?? (payload['open'] as boolean);
          if (folderId && isOpen !== undefined) {
            console.log(`Toggling folder ${folderId} open state to ${isOpen} due to server event`);
            const folder = await this.databaseManager.getFromStore(foldersStore, folderId);
            if (folder) {
              await this.databaseManager.putInStore(foldersStore, {
                ...folder,
                isOpen: isOpen,
                updatedAt: now
              });
              this.emit('dataChanged', { namespace, type: 'serverUpdate' });
            }
          }
          break;
        }
        
        case 'bookmark_favorite_toggled': {
          const bookmarkId = (payload['id'] as string) || (payload['bookmarkId'] as string);
          const isFavorite = (payload['isFavorite'] as boolean) ?? (payload['favorite'] as boolean);
          if (bookmarkId && isFavorite !== undefined) {
            console.log(`Toggling bookmark ${bookmarkId} favorite state to ${isFavorite} due to server event`);
            const bookmark = await this.databaseManager.getFromStore(bookmarksStore, bookmarkId);
            if (bookmark) {
              await this.databaseManager.putInStore(bookmarksStore, {
                ...bookmark,
                isFavorite: isFavorite,
                updatedAt: now
              });
              this.emit('dataChanged', { namespace, type: 'serverUpdate' });
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error(`Error handling server state update for ${eventType}:`, error);
    }
  }
}
