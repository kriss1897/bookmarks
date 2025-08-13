import type { Operation } from '../types/operations';
import type { StoredBookmark, StoredFolder, ServerItem } from './worker-types';
import { DATABASE_CONFIG } from './worker-config';

export class DatabaseManager {
  private db: IDBDatabase | null = null;

  async initialize(): Promise<void> {
    try {
      this.db = await this.openDB();
      console.log('IndexedDB initialized in worker');
    } catch (error) {
      console.error('Failed to initialize IndexedDB:', error);
      
      if ((error as Error).name === 'VersionError') {
        console.log('Attempting to reset IndexedDB due to version conflict...');
        await this.resetDatabase();
      }
    }
  }

  async resetDatabase(): Promise<void> {
    try {
      console.log('Resetting database as requested...');
      
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      
      const deleteReq = indexedDB.deleteDatabase(DATABASE_CONFIG.name);
      
      await new Promise<void>((resolve, reject) => {
        deleteReq.onsuccess = () => resolve();
        deleteReq.onerror = () => reject(deleteReq.error);
        deleteReq.onblocked = () => {
          console.warn('Database deletion blocked - close all tabs and try again');
          reject(new Error('Database deletion blocked'));
        };
      });
      
      console.log('Database deleted successfully');
      
      // Reinitialize
      await this.initialize();
      console.log('Database recreated successfully');
      
    } catch (error) {
      console.error('Failed to reset database:', error);
      throw error;
    }
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_CONFIG.name, DATABASE_CONFIG.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onblocked = () => {
        console.warn('Database upgrade blocked by other connections.');
        
        setTimeout(() => {
          console.log('Retrying database opening after blocked upgrade...');
          const retryRequest = indexedDB.open(DATABASE_CONFIG.name, DATABASE_CONFIG.version);
          retryRequest.onsuccess = () => resolve(retryRequest.result);
          retryRequest.onerror = () => reject(retryRequest.error);
          retryRequest.onblocked = () => {
            reject(new Error('Database upgrade permanently blocked by other connections.'));
          };
        }, 2000);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        console.log(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);
        
        // Clear existing stores for clean upgrade
        const existingStoreNames = Array.from(db.objectStoreNames);
        existingStoreNames.forEach(storeName => {
          console.log(`Removing existing store: ${storeName}`);
          db.deleteObjectStore(storeName);
        });
        
        // Create fresh stores
        const bookmarksStore = db.createObjectStore('bookmarks', { keyPath: 'id' });
        bookmarksStore.createIndex('namespace', 'namespace');
        bookmarksStore.createIndex('by-namespace-parent', ['namespace', 'parentId']);
        
        const foldersStore = db.createObjectStore('folders', { keyPath: 'id' });
        foldersStore.createIndex('namespace', 'namespace');
        foldersStore.createIndex('by-namespace-parent', ['namespace', 'parentId']);
        
        const operationsStore = db.createObjectStore('operations', { keyPath: 'id' });
        operationsStore.createIndex('namespace', 'namespace');
        operationsStore.createIndex('status', 'status');
        operationsStore.createIndex('clientCreatedAt', 'clientCreatedAt');
        
        db.createObjectStore('syncMeta', { keyPath: 'namespace' });
        
        // NEW: Create folder metadata store for tracking loaded children
        const metadataStore = db.createObjectStore('folderMetadata', { keyPath: ['namespace', 'folderId'] });
        metadataStore.createIndex('namespace', 'namespace');
        
        console.log('Database stores created successfully');
      };
    });
  }

  async getNamespaceItems(namespace: string): Promise<(StoredBookmark | StoredFolder)[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readonly');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    
    const [bookmarks, folders] = await Promise.all([
      this.getAllFromStore(bookmarksStore, 'namespace', namespace) as Promise<StoredBookmark[]>,
      this.getAllFromStore(foldersStore, 'namespace', namespace) as Promise<StoredFolder[]>
    ]);
    
    return [...bookmarks, ...folders].sort((a, b) => {
      const aIdx = (a as StoredBookmark | StoredFolder).orderIndex || '';
      const bIdx = (b as StoredBookmark | StoredFolder).orderIndex || '';
      return aIdx.localeCompare(bIdx);
    });
  }

  async getItemById(namespace: string, id: string | number): Promise<ServerItem | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readonly');
    const [bookmark, folder] = await Promise.all([
      this.getFromStore(transaction.objectStore('bookmarks'), id) as Promise<StoredBookmark | undefined>,
      this.getFromStore(transaction.objectStore('folders'), id) as Promise<StoredFolder | undefined>
    ]);

    if (bookmark && bookmark.namespace === namespace) {
      return {
        id: bookmark.id,
        type: 'bookmark',
        namespace: bookmark.namespace,
        parentId: bookmark.parentId || null,
        orderIndex: (bookmark as StoredBookmark).orderIndex,
        createdAt: bookmark.createdAt,
        updatedAt: bookmark.updatedAt,
        title: bookmark.name,
        url: bookmark.url,
        favorite: bookmark.isFavorite
      };
    }

    if (folder && folder.namespace === namespace) {
      return {
        id: folder.id,
        type: 'folder',
        namespace: folder.namespace,
        parentId: folder.parentId || null,
        orderIndex: (folder as StoredFolder).orderIndex,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        name: folder.name,
        open: folder.isOpen,
        children: []
      };
    }

    return null;
  }

  async reconcileWithServer(namespace: string, serverItems: ServerItem[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readwrite');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    
    // Clear existing items for this namespace (keeping local-only items with UUID IDs)
    const bookmarks = await this.getAllFromStore(bookmarksStore, 'namespace', namespace) as StoredBookmark[];
    const folders = await this.getAllFromStore(foldersStore, 'namespace', namespace) as StoredFolder[];
    
    // Only remove items that might have come from server (we'll identify by pattern or keep all)
    // For now, we'll clear all and re-add from server, keeping any with UUID format
    for (const bookmark of bookmarks) {
      // Keep bookmarks with UUID format (local-only), remove others
      if (!this.isUUID(bookmark.id)) {
        await this.deleteFromStore(bookmarksStore, bookmark.id);
      }
    }
    
    for (const folder of folders) {
      // Keep folders with UUID format (local-only), remove others
      if (!this.isUUID(folder.id)) {
        await this.deleteFromStore(foldersStore, folder.id);
      }
    }

    // Add server items
    const now = Date.now();
    for (const item of serverItems) {
      if (item.type === 'bookmark') {
        const bookmark: StoredBookmark = {
          id: item.id,
          name: item.title || '',
          url: item.url || '',
          parentId: item.parentId || undefined,
          isFavorite: item.favorite || false,
          namespace,
          orderIndex: item.orderIndex || '',
          createdAt: now,
          updatedAt: now
        };
        await this.putInStore(bookmarksStore, bookmark);
      } else if (item.type === 'folder') {
        const folder: StoredFolder = {
          id: item.id,
          name: item.name || '',
          parentId: item.parentId || undefined,
          isOpen: item.open || false,
          namespace,
          orderIndex: item.orderIndex || '',
          createdAt: now,
          updatedAt: now
        };
        await this.putInStore(foldersStore, folder);
      }
    }
  }

  async enqueueOperationInDB(operation: Operation): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['operations'], 'readwrite');
    const store = transaction.objectStore('operations');
    
    const storedOperation = {
      id: operation.id,
      clientId: operation.clientId,
      namespace: operation.namespace,
      type: operation.type,
      payload: JSON.stringify(operation.payload),
      clientCreatedAt: operation.clientCreatedAt,
      status: operation.status,
      retryCount: operation.retryCount || 0,
      createdAt: Date.now()
    };
    
    await new Promise<void>((resolve, reject) => {
      const request = store.put(storedOperation);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingOperationsCount(namespace: string): Promise<number> {
    if (!this.db) return 0;
    
    const transaction = this.db.transaction(['operations'], 'readonly');
    const store = transaction.objectStore('operations');
    const index = store.index('namespace');
    
    return new Promise((resolve, reject) => {
      let count = 0;
      const request = index.openCursor(IDBKeyRange.only(namespace));
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          if (cursor.value.status === 'pending') {
            count++;
          }
          cursor.continue();
        } else {
          resolve(count);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingOperations(namespace: string): Promise<Operation[]> {
    if (!this.db) return [];
    
    const transaction = this.db.transaction(['operations'], 'readonly');
    const store = transaction.objectStore('operations');
    const index = store.index('namespace');
    
    return new Promise((resolve, reject) => {
      const operations: Operation[] = [];
      const request = index.openCursor(IDBKeyRange.only(namespace));
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const op = cursor.value;
          if (op.status === 'pending') {
            operations.push({
              id: op.id,
              clientId: op.clientId,
              namespace: op.namespace,
              type: op.type,
              payload: JSON.parse(op.payload),
              clientCreatedAt: op.clientCreatedAt,
              status: op.status,
              retryCount: op.retryCount
            });
          }
          cursor.continue();
        } else {
          operations.sort((a, b) => a.clientCreatedAt - b.clientCreatedAt);
          resolve(operations);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  async markOperationsSynced(operationIds: string[]): Promise<void> {
    if (!this.db || operationIds.length === 0) return;
    
    const transaction = this.db.transaction(['operations'], 'readwrite');
    const store = transaction.objectStore('operations');
    
    for (const id of operationIds) {
      const request = store.get(id);
      request.onsuccess = () => {
        const operation = request.result;
        if (operation) {
          operation.status = 'synced';
          store.put(operation);
        }
      };
    }
  }

  async markOperationsFailed(operationIds: string[]): Promise<void> {
    if (!this.db || operationIds.length === 0) return;
    
    const transaction = this.db.transaction(['operations'], 'readwrite');
    const store = transaction.objectStore('operations');
    
    for (const id of operationIds) {
      const request = store.get(id);
      request.onsuccess = () => {
        const operation = request.result;
        if (operation) {
          operation.status = 'failed';
          operation.retryCount = (operation.retryCount || 0) + 1;
          store.put(operation);
        }
      };
    }
  }

  async updateSyncMeta(namespace: string, pendingCount: number, clientId: string): Promise<void> {
    if (!this.db) return;
    
    const transaction = this.db.transaction(['syncMeta'], 'readwrite');
    const store = transaction.objectStore('syncMeta');
    
    const request = store.get(namespace);
    request.onsuccess = () => {
      const meta = request.result || { namespace };
      meta.lastSyncTimestamp = Date.now();
      meta.pendingOperationsCount = pendingCount;
      meta.clientId = clientId;
      store.put(meta);
    };
  }

  async updateLastSync(namespace: string, clientId: string): Promise<void> {
    if (!this.db) return;
    
    const transaction = this.db.transaction(['syncMeta'], 'readwrite');
    const store = transaction.objectStore('syncMeta');
    
    const existing = await this.getFromStore(store, namespace) as { pendingOperationsCount?: number } | undefined;
    await this.putInStore(store, {
      namespace,
      lastSyncTimestamp: Date.now(),
      pendingOperationsCount: existing?.pendingOperationsCount || 0,
      clientId: clientId
    });
  }

  async getAllSyncMetas(): Promise<Array<{ namespace: string; pendingOperationsCount: number }>> {
    if (!this.db) return [];
    
    const transaction = this.db.transaction(['syncMeta'], 'readonly');
    const store = transaction.objectStore('syncMeta');
    
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteChildrenRecursively(
    bookmarksStore: IDBObjectStore, 
    foldersStore: IDBObjectStore, 
    parentId: string, 
    namespace: string
  ): Promise<void> {
    // Find all children (both bookmarks and folders) with this parentId
    const bookmarks = await this.getAllFromStore(bookmarksStore, 'namespace', namespace) as StoredBookmark[];
    const folders = await this.getAllFromStore(foldersStore, 'namespace', namespace) as StoredFolder[];
    
    // Delete all bookmarks that are children of this folder
    for (const bookmark of bookmarks) {
      if (bookmark.parentId === parentId) {
        await this.deleteFromStore(bookmarksStore, bookmark.id);
      }
    }
    
    // For folders that are children, recursively delete their children too
    for (const folder of folders) {
      if (folder.parentId === parentId) {
        // Recursively delete this subfolder's children first
        await this.deleteChildrenRecursively(bookmarksStore, foldersStore, folder.id, namespace);
        // Then delete the subfolder itself
        await this.deleteFromStore(foldersStore, folder.id);
      }
    }
  }

  // Helper methods for IndexedDB operations
  async getFromStore(store: IDBObjectStore, key: IDBValidKey): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async putInStore(store: IDBObjectStore, value: StoredBookmark | StoredFolder | Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = store.put(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteFromStore(store: IDBObjectStore, key: IDBValidKey): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllFromStore(store: IDBObjectStore, indexName: string, value: IDBValidKey): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private isUUID(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }

  // === NEW METHODS FOR INCREMENTAL LOADING ===

  // Store individual item
    // Helper method to get all items from an index
  private async getAllFromIndex<T>(store: IDBObjectStore, indexName: string, key: IDBValidKey): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const index = store.index(indexName);
      const request = index.getAll(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // NEW: Incremental loading database methods
  async getRootItems(namespace: string): Promise<(StoredBookmark | StoredFolder)[]> {
    if (!this.database) return [];
    
    const transaction = this.database.transaction(['bookmarks', 'folders'], 'readonly');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    
    // Get all items for the namespace and filter for root items (parentId is null, undefined, or empty string)
    const [allBookmarks, allFolders] = await Promise.all([
      this.getAllFromIndex<StoredBookmark>(bookmarksStore, 'namespace', namespace),
      this.getAllFromIndex<StoredFolder>(foldersStore, 'namespace', namespace)
    ]);
    
    // Filter for root items (no parent)
    const rootBookmarks = allBookmarks.filter(item => !item.parentId || item.parentId === '');
    const rootFolders = allFolders.filter(item => !item.parentId || item.parentId === '');
    
    return [...rootBookmarks, ...rootFolders].sort((a, b) => 
      (a.orderIndex || '').localeCompare(b.orderIndex || '')
    );
  }

  async getFolderChildren(namespace: string, folderId: string): Promise<(StoredBookmark | StoredFolder)[]> {
    if (!this.database) return [];
    
    const transaction = this.database.transaction(['bookmarks', 'folders'], 'readonly');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    
    const [bookmarks, folders] = await Promise.all([
      this.getAllFromIndex<StoredBookmark>(bookmarksStore, 'by-namespace-parent', [namespace, folderId]),
      this.getAllFromIndex<StoredFolder>(foldersStore, 'by-namespace-parent', [namespace, folderId])
    ]);
    
    return [...bookmarks, ...folders].sort((a, b) => 
      (a.orderIndex || '').localeCompare(b.orderIndex || '')
    );
  }

  async storeItem(namespace: string, item: ServerItem): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readwrite');
    const now = Date.now();
    
    if (item.type === 'bookmark') {
      const bookmarksStore = transaction.objectStore('bookmarks');
      const bookmark: StoredBookmark = {
        id: item.id,
        name: item.title || '',
        url: item.url || '',
        parentId: item.parentId || undefined,
        isFavorite: item.favorite || false,
        namespace,
        orderIndex: item.orderIndex || '',
        createdAt: now,
        updatedAt: now
      };
      await this.putInStore(bookmarksStore, bookmark);
    } else if (item.type === 'folder') {
      const foldersStore = transaction.objectStore('folders');
      const folder: StoredFolder = {
        id: item.id,
        name: item.name || '',
        parentId: item.parentId || undefined,
        isOpen: item.open || false,
        namespace,
        orderIndex: item.orderIndex || '',
        createdAt: now,
        updatedAt: now
      };
      await this.putInStore(foldersStore, folder);
    }
  }

  // Get folder metadata
  async getFolderMetadata(namespace: string, folderId: string): Promise<{ hasLoadedChildren: boolean; lastLoadedAt: number; childrenCount: number } | null> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['folderMetadata'], 'readonly');
    const store = transaction.objectStore('folderMetadata');
    
    const result = await this.getFromStore(store, [namespace, folderId]) as { 
      hasLoadedChildren: boolean; 
      lastLoadedAt: number; 
      childrenCount: number 
    } | undefined;
    
    return result || null;
  }

  // Set folder metadata
  async setFolderMetadata(namespace: string, folderId: string, metadata: { hasLoadedChildren: boolean; lastLoadedAt: number; childrenCount: number }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['folderMetadata'], 'readwrite');
    const store = transaction.objectStore('folderMetadata');
    
    const record = {
      namespace,
      folderId,
      ...metadata
    };
    
    await this.putInStore(store, record);
  }

  get database(): IDBDatabase | null {
    return this.db;
  }
}
