// Types matching the server
export interface BookmarkItem {
  id: number;
  type: 'folder' | 'bookmark';
  namespace: string;
  parentId: number | null;
  prevSiblingId: number | null;
  nextSiblingId: number | null;
  createdAt: number;
  updatedAt: number;
  // Folder-specific fields
  name?: string;
  open?: boolean;
  // Bookmark-specific fields
  title?: string;
  url?: string;
  icon?: string;
  favorite?: boolean;
}

export interface CreateFolderRequest {
  name: string;
  parentId?: number;
}

export interface CreateBookmarkRequest {
  title: string;
  url: string;
  icon?: string;
  parentId?: number;
}

export interface MoveItemRequest {
  newParentId?: number;
  afterItemId?: number;
}

// Import offline services
import { offlineWorkerService } from './offlineWorkerService';
import { localDataService, type LocalBookmarkItem } from './localDataService';

export class BookmarkAPI {
  private baseURL: string;
  private initializedNamespaces: Set<string> = new Set();

  constructor(baseURL = '/api') {
    this.baseURL = baseURL;
  }

  // Initialize a namespace with server data if it's a fresh session
  async initializeNamespace(namespace: string): Promise<void> {
    if (this.initializedNamespaces.has(namespace)) {
      return; // Already initialized
    }

    try {
      console.log(`Initializing namespace: ${namespace}`);
      
      // Check if we have any local data
      const localItems = await localDataService.getBookmarks(namespace);
      const hasLocalData = localItems.length > 0;
      
      if (!hasLocalData) {
        console.log(`No local data found for namespace ${namespace}, fetching from server...`);
        // Fresh session - fetch initial server data
        await localDataService.fetchInitialData(namespace);
      } else {
        console.log(`Local data exists for namespace ${namespace}, skipping initial fetch`);
      }
      
      this.initializedNamespaces.add(namespace);
    } catch (error) {
      console.error(`Failed to initialize namespace ${namespace}:`, error);
      // Mark as initialized anyway to avoid repeated failures
      this.initializedNamespaces.add(namespace);
    }
  }

  // === OFFLINE-FIRST METHODS ===
  // These methods work with the local data and operation queue

  // Get bookmarks (always from local storage)
  async getBookmarks(namespace: string): Promise<LocalBookmarkItem[]> {
    // Initialize namespace with server data if needed
    await this.initializeNamespace(namespace);
    
    // Subscribe to this namespace for updates
    await offlineWorkerService.subscribe(namespace);
    
    // Return local data
    return localDataService.getBookmarks(namespace);
  }

  // Create folder (enqueue operation)
  async createFolder(namespace: string, request: CreateFolderRequest): Promise<LocalBookmarkItem> {
    const operation = offlineWorkerService.createFolderOperation(namespace, {
      name: request.name,
      parentId: request.parentId
    });

    await offlineWorkerService.enqueueOperation(namespace, operation);
    
    // Apply optimistically to local storage
    await localDataService.applyOperationOptimistically(operation);
    
    // Return the created folder item for UI optimistic update
    return {
      id: typeof operation.payload.id === 'string' ? parseInt(operation.payload.id) || -1 : operation.payload.id,
      type: 'folder' as const,
      namespace,
      parentId: request.parentId || null,
      prevSiblingId: null,
      nextSiblingId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      name: request.name,
      open: true
    };
  }

  // Create bookmark (enqueue operation)
  async createBookmark(namespace: string, request: CreateBookmarkRequest): Promise<LocalBookmarkItem> {
    const operation = offlineWorkerService.createBookmarkOperation(namespace, {
      name: request.title,
      url: request.url,
      parentId: request.parentId,
      isFavorite: false
    });

    await offlineWorkerService.enqueueOperation(namespace, operation);
    
    // Apply optimistically to local storage
    await localDataService.applyOperationOptimistically(operation);
    
    // Return the created bookmark item for UI optimistic update
    return {
      id: typeof operation.payload.id === 'string' ? parseInt(operation.payload.id) || -1 : operation.payload.id,
      type: 'bookmark' as const,
      namespace,
      parentId: request.parentId || null,
      prevSiblingId: null,
      nextSiblingId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: request.title,
      url: request.url,
      icon: request.icon,
      favorite: false
    };
  }

  // Update bookmark
  async updateBookmark(namespace: string, id: number | string, updates: {
    title?: string;
    url?: string;
    favorite?: boolean;
  }): Promise<void> {
    const operation = offlineWorkerService.updateBookmarkOperation(namespace, {
      id,
      name: updates.title,
      url: updates.url,
      isFavorite: updates.favorite
    });

    await offlineWorkerService.enqueueOperation(namespace, operation);
  }

  // Update folder
  async updateFolder(namespace: string, id: number | string, updates: {
    name?: string;
    open?: boolean;
  }): Promise<void> {
    const operation = offlineWorkerService.updateFolderOperation(namespace, {
      id,
      name: updates.name,
      isOpen: updates.open
    });

    await offlineWorkerService.enqueueOperation(namespace, operation);
  }

  // Toggle folder open/close
  async toggleFolder(namespace: string, id: number | string, isOpen: boolean): Promise<void> {
    await this.updateFolder(namespace, id, { open: isOpen });
  }

  // Toggle bookmark favorite
  async toggleBookmarkFavorite(namespace: string, id: number | string, isFavorite: boolean): Promise<void> {
    await this.updateBookmark(namespace, id, { favorite: isFavorite });
  }

  // Move item
  async moveItem(namespace: string, itemId: number | string, newParentId?: number, afterId?: number): Promise<void> {
    const operation = offlineWorkerService.moveItemOperation(namespace, {
      id: itemId,
      newParentId,
      afterId
    });

    await offlineWorkerService.enqueueOperation(namespace, operation);
  }

  // Delete item
  async deleteItem(namespace: string, id: number | string): Promise<void> {
    const operation = offlineWorkerService.deleteItemOperation(namespace, id);
    await offlineWorkerService.enqueueOperation(namespace, operation);
  }

  // Trigger manual sync
  async syncNow(namespace?: string): Promise<void> {
    await offlineWorkerService.syncNow(namespace);
  }

  // === LEGACY METHODS FOR BACKWARDS COMPATIBILITY ===
  // These methods make direct HTTP requests and are used for scenarios
  // where immediate server response is needed (e.g., initial load, export)

  // Direct HTTP request to get items (bypasses offline system)
  async getItemsDirect(namespace: string): Promise<BookmarkItem[]> {
    const response = await fetch(`${this.baseURL}/namespaces/${encodeURIComponent(namespace)}/items`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.success ? data.data : [];
  }

  // Legacy methods (now proxy to offline-first versions for backwards compatibility)
  
  async getItems(namespace: string): Promise<LocalBookmarkItem[]> {
    return this.getBookmarks(namespace);
  }

  async toggleFolderState(namespace: string, folderId: number | string): Promise<boolean> {
    // Get current state first
    const bookmarks = await this.getBookmarks(namespace);
    const folder = bookmarks.find(b => b.id === folderId && b.type === 'folder');
    const newState = !folder?.open;
    
    await this.toggleFolder(namespace, folderId, newState);
    return newState;
  }
}

export const bookmarkAPI = new BookmarkAPI();
