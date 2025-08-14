// Types matching the server
export interface BookmarkItem {
  id: string;
  type: 'folder' | 'bookmark';
  namespace: string;
  parentId: string | null;
  orderIndex: string;
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
  parentId?: string;
  orderIndex: string;
}

export interface CreateBookmarkRequest {
  title: string;
  url: string;
  icon?: string;
  parentId?: string;
  orderIndex: string;
}

export interface MoveItemRequest {
  newParentId?: string;
  targetOrderIndex: string;
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
  parentId: request.parentId,
  orderIndex: request.orderIndex
    });

    await offlineWorkerService.enqueueOperation(namespace, operation);
    
    // Apply optimistically to local storage
    await localDataService.applyOperationOptimistically(operation);
    
    // Return the created folder item for UI optimistic update
    return {
      id: operation.payload.id,
      type: 'folder' as const,
      namespace,
      parentId: request.parentId || null,
  orderIndex: request.orderIndex,
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
  isFavorite: false,
  orderIndex: request.orderIndex
    });

    await offlineWorkerService.enqueueOperation(namespace, operation);
    
    // Apply optimistically to local storage
    await localDataService.applyOperationOptimistically(operation);
    
    // Return the created bookmark item for UI optimistic update
    return {
      id: operation.payload.id,
      type: 'bookmark' as const,
      namespace,
      parentId: request.parentId || null,
  orderIndex: request.orderIndex,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: request.title,
      url: request.url,
      icon: request.icon,
      favorite: false
    };
  }

  // Update bookmark
  async updateBookmark(namespace: string, id: string | string, updates: {
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
  async updateFolder(namespace: string, id: string | string, updates: {
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
  async toggleFolder(namespace: string, id: string | string, isOpen: boolean): Promise<void> {
    await this.updateFolder(namespace, id, { open: isOpen });
  }

  // Toggle bookmark favorite
  async toggleBookmarkFavorite(namespace: string, id: string | string, isFavorite: boolean): Promise<void> {
    await this.updateBookmark(namespace, id, { favorite: isFavorite });
  }

  // Move item
  async moveItem(namespace: string, itemId: string | string, newParentId: string | undefined, targetOrderIndex: string): Promise<void> {
    // First, get the item to determine its type
    const items = await localDataService.getBookmarks(namespace);
    const item = items.find(item => item.id === itemId);
    
    if (!item) {
      throw new Error(`Item with id ${itemId} not found`);
    }

    const payload = {
      id: itemId,
      newParentId,
      targetOrderIndex
    };

    // Create the appropriate operation based on item type
    const operation = item.type === 'bookmark' 
      ? offlineWorkerService.moveBookmarkOperation(namespace, payload)
      : offlineWorkerService.moveFolderOperation(namespace, payload);

    await offlineWorkerService.enqueueOperation(namespace, operation);
  }

  // Delete item
  async deleteItem(namespace: string, id: string): Promise<void> {
    // First, get the item to determine its type
    const items = await localDataService.getBookmarks(namespace);
    const item = items.find(item => item.id === id);
    
    if (!item) {
      throw new Error(`Item with id ${id} not found`);
    }

    // Create the appropriate operation based on item type
    const operation = item.type === 'bookmark' 
      ? offlineWorkerService.deleteBookmarkOperation(namespace, id)
      : offlineWorkerService.deleteFolderOperation(namespace, id);
      
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
  async getItemsDirect(namespace: string, parentId?: string): Promise<BookmarkItem[]> {
    const url = new URL(`${this.baseURL}/bookmarks/${encodeURIComponent(namespace)}`, window.location.origin);
    if (parentId !== undefined) {
      url.searchParams.set('parentId', parentId);
    }
    
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.success ? data.data : [];
  }

  // Get items at a specific level (direct children of a parent folder)
  async getItemsByParent(namespace: string, parentId: string | null = null): Promise<BookmarkItem[]> {
    return this.getItemsDirect(namespace, parentId || undefined);
  }

  // Get root-level items (items with no parent)
  async getRootItems(namespace: string): Promise<BookmarkItem[]> {
    return this.getItemsByParent(namespace, null);
  }

  // Get direct children of a specific folder
  async getFolderChildren(namespace: string, folderId: string): Promise<BookmarkItem[]> {
    return this.getItemsByParent(namespace, folderId);
  }

  // === NEW RECURSIVE LOADING METHODS ===
  
  // Load folder contents with caching - for lazy loading
  async loadFolderContents(namespace: string, folderId: string): Promise<LocalBookmarkItem[]> {
    // Check if we already have this folder's children cached
    const hasChildren = await localDataService.hasFolderChildrenCached(namespace, folderId);
    
    if (hasChildren) {
      console.log(`Folder ${folderId} children already cached, returning from local storage`);
      return localDataService.getFolderChildren(namespace, folderId);
    }
    
    console.log(`Loading children for folder ${folderId} from server`);
    // Fetch from server
    // const serverItems = await this.getItemsDirect(namespace, folderId);
    
    // Store incrementally in IndexedDB
    // TODO: Implement storeFolderChildren in localDataService for legacy support
    // await localDataService.storeFolderChildren(namespace, folderId, serverItems);
    
    // Convert to LocalBookmarkItem format and return
    return localDataService.getFolderChildren(namespace, folderId);
  }

  // Get only root items (for initial load)
  async getRootItemsOnly(namespace: string): Promise<LocalBookmarkItem[]> {
    // Initialize namespace if needed
    await this.initializeNamespace(namespace);
    
    // Subscribe to this namespace for updates
    await offlineWorkerService.subscribe(namespace);
    
    // Check if we have root items cached
    const hasRootItems = await localDataService.hasRootItemsCached(namespace);
    
    if (hasRootItems) {
      console.log(`Root items for ${namespace} already cached`);
      return localDataService.getRootItems(namespace);
    }
    
    console.log(`Loading root items for ${namespace} from server`);
    // Fetch only root items from server
    // const serverItems = await this.getRootItems(namespace);
    
    // Store in IndexedDB
    // TODO: Implement storeRootItems in localDataService for legacy support
    // await localDataService.storeRootItems(namespace, serverItems);
    
    return localDataService.getRootItems(namespace);
  }

  // Check if folder has been loaded
  async isFolderLoaded(namespace: string, folderId: string): Promise<boolean> {
    return localDataService.hasFolderChildrenCached(namespace, folderId);
  }

  // Legacy methods (now proxy to offline-first versions for backwards compatibility)
  
  async getItems(namespace: string): Promise<LocalBookmarkItem[]> {
    return this.getBookmarks(namespace);
  }

  async toggleFolderState(namespace: string, folderId: string): Promise<boolean> {
    // Get current state first
    const bookmarks = await this.getBookmarks(namespace);
    const folder = bookmarks.find(b => b.id === folderId && b.type === 'folder');
    const newState = !folder?.open;
    
    await this.toggleFolder(namespace, folderId, newState);
    return newState;
  }
}

export const bookmarkAPI = new BookmarkAPI();
