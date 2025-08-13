import * as Comlink from 'comlink';
import type { 
  Operation, 
  SyncResponse,
  CreateBookmarkPayload,
  CreateFolderPayload,
  UpdateBookmarkPayload,
  UpdateFolderPayload,
  DeleteItemPayload,
  MoveItemPayload
} from '../types/operations';

// Database object interfaces
interface StoredBookmark {
  id: string;
  name: string;
  url: string;
  parentId?: string;
  isFavorite: boolean;
  namespace: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredFolder {
  id: string;
  name: string;
  parentId?: string;
  isOpen: boolean;
  namespace: string;
  createdAt: number;
  updatedAt: number;
}

interface ServerItem {
  id: string;
  type: 'bookmark' | 'folder';
  namespace: string;
  parentId?: string | null;
  prevSiblingId?: string | null;
  nextSiblingId?: string | null;
  createdAt: number;
  updatedAt: number;
  title?: string;
  url?: string;
  favorite?: boolean;
  name?: string;
  open?: boolean;
  children?: unknown[];
}

// Worker API interface exposed via Comlink
export interface WorkerAPI {
  // Connection management
  connect(namespace: string): Promise<void>;
  disconnect(namespace: string): Promise<void>;
  cleanup(namespace?: string): Promise<void>;
  
  // Operation queue management
  enqueueOperation(namespace: string, operation: Omit<Operation, 'clientId'>): Promise<void>;
  syncNow(namespace?: string): Promise<void>;
  subscribe(namespace: string): Promise<void>;
  getStatus(namespace?: string): Promise<WorkerStatus>;
  
  // Database operations
  getNamespaceItems(namespace: string): Promise<(StoredBookmark | StoredFolder)[]>;
  applyOperationOptimistically(operation: Operation): Promise<void>;
  getItemById(namespace: string, id: string | number): Promise<ServerItem | null>;
  reconcileWithServer(namespace: string, serverItems: ServerItem[]): Promise<void>;
  fetchInitialData(namespace: string): Promise<void>;
  
  // Utility operations
  getPendingOperationsCount(namespace: string): Promise<number>;
  resetDatabase(): Promise<void>;
  
  // Event subscription
  addEventListener(event: WorkerEventType, handler: (data: unknown) => void): Promise<void>;
  removeEventListener(event: WorkerEventType, handler: (data: unknown) => void): Promise<void>;
}

export type WorkerEventType = 
  | 'dataChanged'
  | 'pendingCount'
  | 'syncStatus'
  | 'connectivityChanged'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'event';

export interface WorkerStatus {
  namespace?: string;
  isOnline: boolean;
  pendingCount?: number;
  syncStatus?: string;
  clientId?: string;
}

interface ConnectionManager {
  namespace: string;
  eventSource: EventSource | null;
  isConnecting: boolean;
  reconnectAttempt: number;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  lastSuccessfulConnection: number | null;
  connectionStartTime: number | null;
  isStable: boolean;
  nextRetryAt: string | null;
  stabilityTimeout?: ReturnType<typeof setTimeout> | null;
}

class SSESharedWorkerImpl implements WorkerAPI {
  private db: IDBDatabase | null = null;
  private connections = new Map<string, ConnectionManager>();
  private syncStatus = new Map<string, string>();
  private batchTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private clientId: string;
  private isOnline: boolean = navigator.onLine;
  private eventHandlers = new Map<WorkerEventType, Set<(data: unknown) => void>>();
  private retryAttempts = new Map<string, number>();
  
  // Configuration
  private readonly reconnectConfig = {
    baseDelay: 1000,
    maxDelay: 60000,
    maxAttempts: Infinity,
    jitterFactor: 0.3,
    stableThreshold: 30000,
    backoffMultiplier: 2
  };
  
  private readonly syncConfig = {
    batchWindow: 100,
    maxRetries: 5,
    retryDelays: [1000, 2000, 5000, 10000, 30000]
  };

  constructor() {
    this.clientId = this.generateClientId();
    this.initializeDB();
    this.startReachabilityCheck();
    console.log('SSE Shared Worker (Comlink) initialized with offline-first capabilities');
  }

  // Event handling for clients
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

  private emit(event: WorkerEventType, data: unknown): void {
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

  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

  // Connection management
  async connect(namespace: string): Promise<void> {
    if (!namespace?.trim()) {
      throw new Error('Namespace is required');
    }

    console.log(`Connect called for namespace: ${namespace}`);

    let connectionManager = this.connections.get(namespace);

    if (!connectionManager) {
      console.log(`Creating new connection manager for namespace: ${namespace}`);
      connectionManager = {
        namespace,
        eventSource: null,
        isConnecting: false,
        reconnectAttempt: 0,
        reconnectTimeout: null,
        lastSuccessfulConnection: null,
        connectionStartTime: null,
        isStable: false,
        nextRetryAt: null
      };
      this.connections.set(namespace, connectionManager);
    }

    const needsConnection = !connectionManager.eventSource || 
                           connectionManager.eventSource.readyState === EventSource.CLOSED;
    const notReconnecting = !connectionManager.reconnectTimeout && !connectionManager.isConnecting;
    
    if (needsConnection && notReconnecting) {
      console.log(`Creating SSE connection for namespace: ${namespace}`);
      await this.createSSEConnection(connectionManager);
    }
  }

  async disconnect(namespace: string): Promise<void> {
    const connectionManager = this.connections.get(namespace);
    if (connectionManager) {
      this.closeSSEConnection(connectionManager);
      this.connections.delete(namespace);
      console.log(`Disconnected from namespace: ${namespace}`);
    }
  }

  async cleanup(namespace?: string): Promise<void> {
    if (namespace) {
      await this.disconnect(namespace);
    } else {
      for (const [, manager] of this.connections) {
        this.closeSSEConnection(manager);
      }
      this.connections.clear();
    }
  }

  // Operation management
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
      await this.enqueueOperationInDB(fullOperation);
      await this.applyOperationOptimistically(fullOperation);
      
      this.emit('dataChanged', { namespace });
      this.scheduleBatchSync(namespace);
      
      console.log(`Operation enqueued: ${operation.type} for namespace: ${namespace}`);
    } catch (error) {
      console.error('Error enqueuing operation:', error);
      this.emit('error', { 
        reason: 'Failed to enqueue operation',
        operationId: operation.id 
      });
      throw error;
    }
  }

  async syncNow(namespace?: string): Promise<void> {
    if (namespace) {
      await this.syncNamespace(namespace);
    } else {
      const namespaces = Array.from(this.connections.keys());
      for (const ns of namespaces) {
        await this.syncNamespace(ns);
      }
    }
  }

  async subscribe(namespace: string): Promise<void> {
    const pendingCount = await this.getPendingOperationsCount(namespace);
    this.emit('pendingCount', { namespace, count: pendingCount });
  }

  async getStatus(namespace?: string): Promise<WorkerStatus> {
    if (namespace) {
      const pendingCount = await this.getPendingOperationsCount(namespace);
      const syncStatus = this.syncStatus.get(namespace) || 'idle';
      
      return {
        namespace,
        isOnline: this.isOnline,
        pendingCount,
        syncStatus
      };
    } else {
      return {
        isOnline: this.isOnline,
        clientId: this.clientId
      };
    }
  }

  // Database operations
  async getNamespaceItems(namespace: string): Promise<(StoredBookmark | StoredFolder)[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readonly');
    const bookmarksStore = transaction.objectStore('bookmarks');
    const foldersStore = transaction.objectStore('folders');
    
    const [bookmarks, folders] = await Promise.all([
      this.getAllFromStore(bookmarksStore, 'namespace', namespace) as Promise<StoredBookmark[]>,
      this.getAllFromStore(foldersStore, 'namespace', namespace) as Promise<StoredFolder[]>
    ]);
    
    return [...bookmarks, ...folders].sort((a, b) => a.createdAt - b.createdAt);
  }

  async applyOperationOptimistically(operation: Operation): Promise<void> {
    if (!this.db) return;
    
    const transaction = this.db.transaction(['bookmarks', 'folders'], 'readwrite');
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
            createdAt: now,
            updatedAt: now
          };
          await this.putInStore(bookmarksStore, bookmark);
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
            createdAt: now,
            updatedAt: now
          };
          await this.putInStore(foldersStore, folder);
          break;
        }
        
        case 'UPDATE_BOOKMARK': {
          const payload = operation.payload as UpdateBookmarkPayload;
          const existing = await this.getFromStore(bookmarksStore, payload.id);
          if (existing) {
            const updated = {
              ...existing,
              ...(payload.name !== undefined && { name: payload.name }),
              ...(payload.url !== undefined && { url: payload.url }),
              ...(payload.isFavorite !== undefined && { isFavorite: payload.isFavorite }),
              updatedAt: now
            };
            await this.putInStore(bookmarksStore, updated);
          }
          break;
        }
        
        case 'UPDATE_FOLDER': {
          const payload = operation.payload as UpdateFolderPayload;
          const existing = await this.getFromStore(foldersStore, payload.id);
          if (existing) {
            const updated = {
              ...existing,
              ...(payload.name !== undefined && { name: payload.name }),
              ...(payload.isOpen !== undefined && { isOpen: payload.isOpen }),
              updatedAt: now
            };
            await this.putInStore(foldersStore, updated);
          }
          break;
        }
        
        case 'DELETE_ITEM': {
          const payload = operation.payload as DeleteItemPayload;
          
          // First check if it's a folder, and if so, recursively delete all children
          const folderToDelete = await this.getFromStore(foldersStore, payload.id);
          if (folderToDelete) {
            // Recursively delete all children of this folder
            await this.deleteChildrenRecursively(bookmarksStore, foldersStore, payload.id.toString(), operation.namespace);
          }
          
          // Delete the item itself (folder or bookmark)
          await Promise.all([
            this.deleteFromStore(bookmarksStore, payload.id),
            this.deleteFromStore(foldersStore, payload.id)
          ]);
          break;
        }
        
        case 'MOVE_ITEM': {
          const payload = operation.payload as MoveItemPayload;
          const [bookmark, folder] = await Promise.all([
            this.getFromStore(bookmarksStore, payload.id),
            this.getFromStore(foldersStore, payload.id)
          ]);

          if (bookmark) {
            await this.putInStore(bookmarksStore, {
              ...bookmark,
              parentId: payload.newParentId,
              updatedAt: now
            });
          }

          if (folder) {
            await this.putInStore(foldersStore, {
              ...folder,
              parentId: payload.newParentId,
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
        prevSiblingId: null,
        nextSiblingId: null,
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
        prevSiblingId: null,
        nextSiblingId: null,
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
          createdAt: now,
          updatedAt: now
        };
        await this.putInStore(foldersStore, folder);
      }
    }
  }

  private isUUID(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }

  async fetchInitialData(namespace: string): Promise<void> {
    if (!this.isOnline) {
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
        
        const serverItems = result.data.map((item: ServerItem) => ({
          id: item.id,
          type: item.type,
          namespace: item.namespace,
          parentId: item.parentId,
          prevSiblingId: item.prevSiblingId,
          nextSiblingId: item.nextSiblingId,
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

        await this.reconcileWithServer(namespace, serverItems);
        await this.updateLastSync(namespace);
        
        console.log(`Initial sync completed for namespace: ${namespace}`);
        this.emit('dataChanged', { namespace, type: 'initialDataLoaded', itemCount: serverItems.length });
      }
    } catch (error) {
      console.error(`Failed to fetch initial server data for namespace ${namespace}:`, error);
      this.emit('error', { namespace, type: 'initialDataError', error: (error as Error).message });
      throw error;
    }
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

  async resetDatabase(): Promise<void> {
    try {
      console.log('Resetting database as requested...');
      
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      
      const deleteReq = indexedDB.deleteDatabase('BookmarksOfflineDB');
      
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
      await this.initializeDB();
      console.log('Database recreated successfully');
      
    } catch (error) {
      console.error('Failed to reset database:', error);
      throw error;
    }
  }

  // Private implementation methods
  private async initializeDB(): Promise<void> {
    try {
      this.db = await this.openDB();
      console.log('IndexedDB initialized in worker');
      await this.resumePendingSyncs();
    } catch (error) {
      console.error('Failed to initialize IndexedDB:', error);
      
      if ((error as Error).name === 'VersionError') {
        console.log('Attempting to reset IndexedDB due to version conflict...');
        await this.resetDatabase();
      }
    }
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const dbVersion = 20250813;
      const request = indexedDB.open('BookmarksOfflineDB', dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onblocked = () => {
        console.warn('Database upgrade blocked by other connections.');
        
        setTimeout(() => {
          console.log('Retrying database opening after blocked upgrade...');
          const retryRequest = indexedDB.open('BookmarksOfflineDB', dbVersion);
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
        
        const foldersStore = db.createObjectStore('folders', { keyPath: 'id' });
        foldersStore.createIndex('namespace', 'namespace');
        
        const operationsStore = db.createObjectStore('operations', { keyPath: 'id' });
        operationsStore.createIndex('namespace', 'namespace');
        operationsStore.createIndex('status', 'status');
        operationsStore.createIndex('clientCreatedAt', 'clientCreatedAt');
        
        db.createObjectStore('syncMeta', { keyPath: 'namespace' });
        
        console.log('Database stores created successfully');
      };
    });
  }

  private startReachabilityCheck(): void {
    this.isOnline = navigator.onLine;
    
    self.addEventListener('online', () => {
      console.log('Worker detected online');
      this.isOnline = true;
      this.onConnectivityChange();
    });
    
    self.addEventListener('offline', () => {
      console.log('Worker detected offline');
      this.isOnline = false;
      this.onConnectivityChange();
    });
    
    setInterval(() => {
      this.checkReachability();
    }, 10000);
  }

  private async checkReachability(): Promise<void> {
    try {
      const response = await fetch('/api/ping', { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      const isReachable = response.ok;
      
      if (this.isOnline !== isReachable) {
        this.isOnline = isReachable;
        this.onConnectivityChange();
      }
    } catch {
      if (this.isOnline) {
        this.isOnline = false;
        this.onConnectivityChange();
      }
    }
  }

  private onConnectivityChange(): void {
    this.emit('connectivityChanged', { isOnline: this.isOnline });
    
    if (this.isOnline) {
      this.resumePendingSyncs();
    }
  }

  private async resumePendingSyncs(): Promise<void> {
    if (!this.db) return;
    
    try {
      const transaction = this.db.transaction(['syncMeta'], 'readonly');
      const store = transaction.objectStore('syncMeta');
      const request = store.getAll();
      
      request.onsuccess = () => {
        const metas = request.result;
        for (const meta of metas) {
          if (meta.pendingOperationsCount > 0) {
            console.log(`Resuming sync for namespace: ${meta.namespace}`);
            this.scheduleBatchSync(meta.namespace);
          }
        }
      };
    } catch (error) {
      console.error('Error resuming pending syncs:', error);
    }
  }

  private async createSSEConnection(connectionManager: ConnectionManager): Promise<void> {
    if (connectionManager.isConnecting) {
      return;
    }
    
    if (connectionManager.eventSource && connectionManager.eventSource.readyState === EventSource.OPEN) {
      return;
    }
    
    connectionManager.isConnecting = true;
    console.log(`Creating EventSource for namespace: ${connectionManager.namespace}`);
    
    try {
      const eventSource = new EventSource(`/api/events?namespace=${encodeURIComponent(connectionManager.namespace)}`);
      connectionManager.eventSource = eventSource;
      
      eventSource.onopen = () => {
        console.log(`SSE connection opened for namespace: ${connectionManager.namespace}`);
        connectionManager.isConnecting = false;
        connectionManager.lastSuccessfulConnection = Date.now();
        connectionManager.connectionStartTime = Date.now();
        connectionManager.isStable = false;
        
        this.scheduleStabilityCheck(connectionManager);
        this.emit('connected', { namespace: connectionManager.namespace });
      };
      
      // Handle different event types
      const eventTypes = [
        'connection', 'trigger', 'notification', 'heartbeat', 'close',
        'folder_created', 'bookmark_created', 'item_moved', 'folder_toggled',
        'bookmark_favorite_toggled', 'item_deleted'
      ];
      
      eventTypes.forEach(eventType => {
        eventSource.addEventListener(eventType, (event) => {
          this.handleSSEEvent(connectionManager.namespace, eventType, event);
        });
      });
      
      eventSource.onmessage = (event) => {
        this.handleSSEEvent(connectionManager.namespace, 'message', event);
      };
      
      eventSource.onerror = () => {
        console.error(`SSE connection error for namespace: ${connectionManager.namespace}`);
        
        if (connectionManager.isConnecting) {
          connectionManager.isConnecting = false;
        }
        
        if (connectionManager.reconnectTimeout) {
          return;
        }
        
        connectionManager.isStable = false;
        
        if (connectionManager.stabilityTimeout) {
          clearTimeout(connectionManager.stabilityTimeout);
          connectionManager.stabilityTimeout = null;
        }
        
        if (connectionManager.eventSource && 
            (connectionManager.lastSuccessfulConnection || connectionManager.eventSource.readyState !== EventSource.CONNECTING)) {
          this.emit('disconnected', { namespace: connectionManager.namespace });
        }
        
        this.scheduleReconnectWithBackoff(connectionManager);
      };
      
    } catch (error) {
      console.error('Error creating SSE connection:', error);
      connectionManager.isConnecting = false;
      this.scheduleReconnectWithBackoff(connectionManager);
    }
  }

  private handleSSEEvent(namespace: string, eventType: string, event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log(`SSE ${eventType} event for namespace ${namespace}:`, data);
      
      const actualEventType = data.type || eventType;
      
      // Handle server events that should update local state
      this.handleServerStateUpdate(namespace, actualEventType, data);
      
      this.emit('event', {
        namespace,
        data: {
          ...data,
          type: actualEventType,
          eventType: actualEventType,
          id: data.id || Date.now().toString(),
          timestamp: data.timestamp || new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error(`Error parsing SSE ${eventType} event:`, error);
    }
  }

  /**
   * Handle server events that should update local IndexedDB state
   */
  private async handleServerStateUpdate(namespace: string, eventType: string, data: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    
    try {
      const transaction = this.db.transaction(['bookmarks', 'folders'], 'readwrite');
      const bookmarksStore = transaction.objectStore('bookmarks');
      const foldersStore = transaction.objectStore('folders');
      const now = Date.now();
      
      switch (eventType) {
        case 'item_deleted':
        case 'folder_deleted':
        case 'bookmark_deleted': {
          const itemId = data.id as string;
          if (itemId) {
            console.log(`Deleting item ${itemId} from local state due to server event`);
            
            // Check if it's a folder and delete children recursively
            const folderToDelete = await this.getFromStore(foldersStore, itemId);
            if (folderToDelete) {
              await this.deleteChildrenRecursively(bookmarksStore, foldersStore, itemId, namespace);
            }
            
            // Delete the item itself
            await Promise.all([
              this.deleteFromStore(bookmarksStore, itemId),
              this.deleteFromStore(foldersStore, itemId)
            ]);
            
            // Emit data changed event so UI updates
            this.emit('dataChanged', { namespace, type: 'serverUpdate' });
          }
          break;
        }
        
        case 'folder_created': {
          const folderId = data.id as string;
          const folderName = data.name as string;
          if (folderId && folderName) {
            console.log(`Adding folder ${folderId} to local state due to server event`);
            const folder: StoredFolder = {
              id: folderId,
              name: folderName,
              parentId: data.parentId as string | undefined,
              isOpen: (data.isOpen as boolean) || false,
              namespace,
              createdAt: (data.createdAt as number) || now,
              updatedAt: (data.updatedAt as number) || now
            };
            await this.putInStore(foldersStore, folder);
            this.emit('dataChanged', { namespace, type: 'serverUpdate' });
          }
          break;
        }
        
        case 'bookmark_created': {
          const bookmarkId = data.id as string;
          const bookmarkName = data.name as string;
          const bookmarkUrl = data.url as string;
          if (bookmarkId && bookmarkName && bookmarkUrl) {
            console.log(`Adding bookmark ${bookmarkId} to local state due to server event`);
            const bookmark: StoredBookmark = {
              id: bookmarkId,
              name: bookmarkName,
              url: bookmarkUrl,
              parentId: data.parentId as string | undefined,
              isFavorite: (data.isFavorite as boolean) || false,
              namespace,
              createdAt: (data.createdAt as number) || now,
              updatedAt: (data.updatedAt as number) || now
            };
            await this.putInStore(bookmarksStore, bookmark);
            this.emit('dataChanged', { namespace, type: 'serverUpdate' });
          }
          break;
        }
        
        case 'item_moved': {
          const itemId = data.id as string;
          const newParentId = data.newParentId as string | undefined;
          if (itemId && newParentId !== undefined) {
            console.log(`Moving item ${itemId} to parent ${newParentId} due to server event`);
            const [bookmark, folder] = await Promise.all([
              this.getFromStore(bookmarksStore, itemId),
              this.getFromStore(foldersStore, itemId)
            ]);

            if (bookmark) {
              await this.putInStore(bookmarksStore, {
                ...bookmark,
                parentId: newParentId,
                updatedAt: now
              });
              this.emit('dataChanged', { namespace, type: 'serverUpdate' });
            }

            if (folder) {
              await this.putInStore(foldersStore, {
                ...folder,
                parentId: newParentId,
                updatedAt: now
              });
              this.emit('dataChanged', { namespace, type: 'serverUpdate' });
            }
          }
          break;
        }
        
        case 'folder_toggled': {
          const folderId = data.id as string;
          const isOpen = data.isOpen as boolean;
          if (folderId && isOpen !== undefined) {
            console.log(`Toggling folder ${folderId} open state to ${isOpen} due to server event`);
            const folder = await this.getFromStore(foldersStore, folderId);
            if (folder) {
              await this.putInStore(foldersStore, {
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
          const bookmarkId = data.id as string;
          const isFavorite = data.isFavorite as boolean;
          if (bookmarkId && isFavorite !== undefined) {
            console.log(`Toggling bookmark ${bookmarkId} favorite state to ${isFavorite} due to server event`);
            const bookmark = await this.getFromStore(bookmarksStore, bookmarkId);
            if (bookmark) {
              await this.putInStore(bookmarksStore, {
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

  private scheduleStabilityCheck(connectionManager: ConnectionManager): void {
    if (connectionManager.stabilityTimeout) {
      clearTimeout(connectionManager.stabilityTimeout);
    }
    
    connectionManager.stabilityTimeout = setTimeout(() => {
      if (connectionManager.eventSource && connectionManager.eventSource.readyState === EventSource.OPEN) {
        console.log(`Connection stable for namespace: ${connectionManager.namespace}, resetting reconnect attempts`);
        connectionManager.reconnectAttempt = 0;
        connectionManager.isStable = true;
        connectionManager.stabilityTimeout = null;
      }
    }, this.reconnectConfig.stableThreshold);
  }

  private calculateReconnectDelay(attempt: number): number {
    const { baseDelay, maxDelay, backoffMultiplier, jitterFactor } = this.reconnectConfig;
    
    const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);
    const finalDelay = Math.max(cappedDelay + jitter, baseDelay);
    
    return Math.round(finalDelay);
  }

  private scheduleReconnectWithBackoff(connectionManager: ConnectionManager): void {
    if (connectionManager.reconnectTimeout) {
      return;
    }
    
    const delay = this.calculateReconnectDelay(connectionManager.reconnectAttempt);
    const nextRetryAt = new Date(Date.now() + delay);
    connectionManager.nextRetryAt = nextRetryAt.toISOString();
    
    console.log(`Scheduling reconnect for ${connectionManager.namespace} in ${delay}ms (attempt ${connectionManager.reconnectAttempt + 1})`);
    
    this.emit('reconnecting', {
      namespace: connectionManager.namespace,
      data: { 
        attempt: connectionManager.reconnectAttempt + 1,
        delayMs: delay,
        nextRetryAt: connectionManager.nextRetryAt
      }
    });
    
    connectionManager.reconnectTimeout = setTimeout(() => {
      connectionManager.reconnectAttempt++;
      connectionManager.reconnectTimeout = null;
      connectionManager.nextRetryAt = null;
      
      console.log(`Attempting reconnect for ${connectionManager.namespace} (attempt ${connectionManager.reconnectAttempt})`);
      this.createSSEConnection(connectionManager);
    }, delay);
  }

  private closeSSEConnection(connectionManager: ConnectionManager): void {
    if (connectionManager.eventSource) {
      connectionManager.eventSource.close();
      connectionManager.eventSource = null;
    }
    
    if (connectionManager.reconnectTimeout) {
      clearTimeout(connectionManager.reconnectTimeout);
      connectionManager.reconnectTimeout = null;
    }
    
    if (connectionManager.stabilityTimeout) {
      clearTimeout(connectionManager.stabilityTimeout);
      connectionManager.stabilityTimeout = null;
    }
    
    connectionManager.isConnecting = false;
    connectionManager.reconnectAttempt = 0;
    connectionManager.lastSuccessfulConnection = null;
    connectionManager.connectionStartTime = null;
    connectionManager.isStable = false;
    connectionManager.nextRetryAt = null;
  }

  private async enqueueOperationInDB(operation: Operation): Promise<void> {
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
    
    await this.updatePendingCount(operation.namespace);
  }

  private scheduleBatchSync(namespace: string): void {
    if (this.batchTimeouts.has(namespace)) {
      clearTimeout(this.batchTimeouts.get(namespace));
    }
    
    const timeout = setTimeout(() => {
      this.batchTimeouts.delete(namespace);
      this.syncNamespace(namespace);
    }, this.syncConfig.batchWindow);
    
    this.batchTimeouts.set(namespace, timeout);
  }

  private async syncNamespace(namespace: string): Promise<void> {
    if (!this.isOnline) {
      console.log(`Skipping sync for ${namespace} - offline`);
      return;
    }
    
    if (this.syncStatus.get(namespace) === 'syncing') {
      console.log(`Already syncing ${namespace}`);
      return;
    }
    
    try {
      this.syncStatus.set(namespace, 'syncing');
      this.emit('syncStatus', { namespace, status: 'syncing' });
      
      const operations = await this.getPendingOperations(namespace);
      
      if (operations.length === 0) {
        this.syncStatus.set(namespace, 'synced');
        this.emit('syncStatus', { namespace, status: 'synced' });
        return;
      }
      
      console.log(`Syncing ${operations.length} operations for ${namespace}`);
      
      const response = await fetch(`/api/sync/${encodeURIComponent(namespace)}/operations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: this.clientId,
          operations: operations
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result: SyncResponse = await response.json();
      await this.processSyncResult(namespace, result);
      
      this.syncStatus.set(namespace, 'synced');
      this.emit('syncStatus', { namespace, status: 'synced' });
      
    } catch (error) {
      console.error(`Sync failed for ${namespace}:`, error);
      this.syncStatus.set(namespace, 'error');
      this.emit('syncStatus', { 
        namespace, 
        status: 'error',
        error: (error as Error).message 
      });
      
      this.scheduleRetrySync(namespace);
    }
  }

  private async getPendingOperations(namespace: string): Promise<Operation[]> {
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

  private async processSyncResult(namespace: string, result: SyncResponse): Promise<void> {
    if (!this.db) return;
    
    const { applied = [] } = result || {};
    
    console.log('Processing sync result:', { applied });
    
    const syncedIds: string[] = [];
    const failedIds: string[] = [];
    
    if (Array.isArray(applied)) {
      for (const appliedOp of applied) {
        if (appliedOp && appliedOp.operationId) {
          if (appliedOp.status === 'success') {
            syncedIds.push(appliedOp.operationId);
          } else {
            failedIds.push(appliedOp.operationId);
          }
        }
      }
    }
    
    if (syncedIds.length > 0) {
      await this.markOperationsSynced(syncedIds);
    }
    
    if (failedIds.length > 0) {
      await this.markOperationsFailed(failedIds);
    }
    
    // No more ID mapping needed with UUIDs!
    
    await this.updatePendingCount(namespace);
    this.emit('dataChanged', { namespace });
  }

  private async markOperationsSynced(operationIds: string[]): Promise<void> {
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

  private async markOperationsFailed(operationIds: string[]): Promise<void> {
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

  private async updatePendingCount(namespace: string): Promise<void> {
    const count = await this.getPendingOperationsCount(namespace);
    
    this.emit('pendingCount', { namespace, count });
    
    if (this.db) {
      const transaction = this.db.transaction(['syncMeta'], 'readwrite');
      const store = transaction.objectStore('syncMeta');
      
      const request = store.get(namespace);
      request.onsuccess = () => {
        const meta = request.result || { namespace };
        meta.lastSyncTimestamp = Date.now();
        meta.pendingOperationsCount = count;
        meta.clientId = this.clientId;
        store.put(meta);
      };
    }
  }

  private async updateLastSync(namespace: string): Promise<void> {
    if (!this.db) return;
    
    const transaction = this.db.transaction(['syncMeta'], 'readwrite');
    const store = transaction.objectStore('syncMeta');
    
    const existing = await this.getFromStore(store, namespace) as { pendingOperationsCount?: number } | undefined;
    await this.putInStore(store, {
      namespace,
      lastSyncTimestamp: Date.now(),
      pendingOperationsCount: existing?.pendingOperationsCount || 0,
      clientId: this.clientId
    });
  }

  private scheduleRetrySync(namespace: string): void {
    const retryCount = this.retryAttempts?.get(namespace) || 0;
    const delay = this.syncConfig.retryDelays[Math.min(retryCount, this.syncConfig.retryDelays.length - 1)];
    
    this.retryAttempts.set(namespace, retryCount + 1);
    
    setTimeout(() => {
      if (this.isOnline) {
        this.syncNamespace(namespace);
      }
    }, delay);
  }

  // Helper methods for IndexedDB operations
  private async getFromStore(store: IDBObjectStore, key: IDBValidKey): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async deleteChildrenRecursively(
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

  private async putInStore(store: IDBObjectStore, value: StoredBookmark | StoredFolder | Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = store.put(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async deleteFromStore(store: IDBObjectStore, key: IDBValidKey): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async getAllFromStore(store: IDBObjectStore, indexName: string, value: IDBValidKey): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// SharedWorker connection handler
interface SharedWorkerEvent extends MessageEvent {
  ports: MessagePort[];
}

// Singleton worker instance shared across all tabs
let sharedWorkerInstance: SSESharedWorkerImpl | null = null;

function getSharedWorkerInstance(): SSESharedWorkerImpl {
  if (!sharedWorkerInstance) {
    sharedWorkerInstance = new SSESharedWorkerImpl();
    console.log('Created new shared SSE worker instance');
  }
  return sharedWorkerInstance;
}

self.addEventListener('connect', (event: Event) => {
  const connectEvent = event as SharedWorkerEvent;
  const port = connectEvent.ports[0];
  
  // Get the singleton worker instance
  const worker = getSharedWorkerInstance();
  
  // Expose the worker API via Comlink on this port
  Comlink.expose(worker, port);
  
  console.log('New SharedWorker connection established with Comlink - reusing existing instance');
});
