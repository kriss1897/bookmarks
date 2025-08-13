import type { Operation } from '../types/operations';
import type { BookmarkItem } from './bookmarkAPI';
import { offlineWorkerService } from './offlineWorkerService';

// Extended type for local UI with children support
export interface LocalBookmarkItem extends BookmarkItem {
  children?: LocalBookmarkItem[];
}

// Database item types
interface LocalDBBookmark {
  id: string;
  name: string;
  url: string;
  parentId?: string;
  isFavorite: boolean;
  namespace: string;
  orderIndex: string;
  isTemporary: boolean;
  createdAt: number;
  updatedAt: number;
}

interface LocalDBFolder {
  id: string;
  name: string;
  parentId?: string;
  isOpen: boolean;
  namespace: string;
  orderIndex: string;
  isTemporary: boolean;
  createdAt: number;
  updatedAt: number;
}

export class LocalDataService {
  // Get root items for a namespace
  async getRootItems(namespace: string): Promise<LocalBookmarkItem[]> {
    const items = await offlineWorkerService.getRootItems(namespace) as (LocalDBBookmark | LocalDBFolder)[];
    
    // Convert to BookmarkItem format
    const bookmarkItems: LocalBookmarkItem[] = items.map((item: LocalDBBookmark | LocalDBFolder) => {
      // Check if it's a bookmark by checking for url property
      if ('url' in item && item.url) {
        // It's a bookmark
        const bookmark = item as LocalDBBookmark;
        return {
          id: bookmark.id,
          type: 'bookmark' as const,
          namespace: bookmark.namespace,
          parentId: bookmark.parentId || null,
          orderIndex: bookmark.orderIndex,
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
          title: bookmark.name, // LocalBookmark uses 'name', UI expects 'title'
          url: bookmark.url,
          favorite: bookmark.isFavorite
        };
      } else {
        // It's a folder
        const folder = item as LocalDBFolder;
        return {
          id: folder.id,
          type: 'folder' as const,
          namespace: folder.namespace,
          parentId: folder.parentId || null,
          orderIndex: folder.orderIndex,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          name: folder.name, // Folders use 'name' in both local and UI
          open: folder.isOpen // LocalFolder uses 'isOpen', UI expects 'open'
        };
      }
    });

    // Sort by orderIndex
    return bookmarkItems.sort((a, b) => (a.orderIndex || '').localeCompare(b.orderIndex || ''));
  }

  // Get children of a specific folder
  async getFolderChildren(namespace: string, folderId: string): Promise<LocalBookmarkItem[]> {
    const items = await offlineWorkerService.getFolderChildren(namespace, folderId) as (LocalDBBookmark | LocalDBFolder)[];
    
    // Convert to BookmarkItem format (same logic as getRootItems)
    const bookmarkItems: LocalBookmarkItem[] = items.map((item: LocalDBBookmark | LocalDBFolder) => {
      if ('url' in item && item.url) {
        const bookmark = item as LocalDBBookmark;
        return {
          id: bookmark.id,
          type: 'bookmark' as const,
          namespace: bookmark.namespace,
          parentId: bookmark.parentId || null,
          orderIndex: bookmark.orderIndex,
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
          title: bookmark.name,
          url: bookmark.url,
          favorite: bookmark.isFavorite
        };
      } else {
        const folder = item as LocalDBFolder;
        return {
          id: folder.id,
          type: 'folder' as const,
          namespace: folder.namespace,
          parentId: folder.parentId || null,
          orderIndex: folder.orderIndex,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          name: folder.name,
          open: folder.isOpen
        };
      }
    });

    return bookmarkItems.sort((a, b) => (a.orderIndex || '').localeCompare(b.orderIndex || ''));
  }

  // Get all bookmarks for a namespace (LEGACY - for backwards compatibility)
  async getBookmarks(namespace: string): Promise<LocalBookmarkItem[]> {
  const items = await offlineWorkerService.getNamespaceItems(namespace) as (LocalDBBookmark | LocalDBFolder)[];
    
    // Convert to BookmarkItem format
    const bookmarkItems: LocalBookmarkItem[] = items.map((item: LocalDBBookmark | LocalDBFolder) => {
      // Check if it's a bookmark by checking for url property
      if ('url' in item && item.url) {
        // It's a bookmark
        const bookmark = item as LocalDBBookmark;
        return {
          id: bookmark.id,
          type: 'bookmark' as const,
          namespace: bookmark.namespace,
          parentId: bookmark.parentId || null,
          orderIndex: bookmark.orderIndex,
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
          title: bookmark.name, // LocalBookmark uses 'name', UI expects 'title'
          url: bookmark.url,
          favorite: bookmark.isFavorite
        };
      } else {
        // It's a folder
        const folder = item as LocalDBFolder;
        return {
          id: folder.id,
          type: 'folder' as const,
          namespace: folder.namespace,
          parentId: folder.parentId || null,
          orderIndex: folder.orderIndex,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          name: folder.name, // Folders use 'name' in both local and UI
          open: folder.isOpen // LocalFolder uses 'isOpen', UI expects 'open'
        };
      }
    });

    // Build hierarchy
    return this.buildHierarchy(bookmarkItems);
  }

  // Apply operation optimistically to local storage
  async applyOperationOptimistically(operation: Operation): Promise<void> {
    await offlineWorkerService.applyOperationOptimistically(operation);
  }

  // Reconcile with server state after sync
  async reconcileWithServerState(namespace: string, serverItems: LocalBookmarkItem[]): Promise<void> {
    await offlineWorkerService.reconcileWithServer(namespace, serverItems);
  }

  // Get item by ID (useful for immediate reference after creation)
  async getById(namespace: string, id: string | number): Promise<LocalBookmarkItem | null> {
    const item = await offlineWorkerService.getItemById(namespace, id);
    return item as LocalBookmarkItem | null;
  }

  // Fetch initial server data for fresh sessions
  async fetchInitialData(namespace: string): Promise<void> {
    await offlineWorkerService.fetchInitialData(namespace);
  }

  // Build hierarchical structure from flat array
  private buildHierarchy(items: LocalBookmarkItem[]): LocalBookmarkItem[] {
    const itemMap = new Map<string, LocalBookmarkItem>();
    const rootItems: LocalBookmarkItem[] = [];

    // First pass: create map and identify root items
    for (const item of items) {
      itemMap.set(item.id, { ...item });
      if (!item.parentId) {
        rootItems.push(itemMap.get(item.id)!);
      }
    }

    // Second pass: build parent-child relationships
    for (const item of items) {
      if (item.parentId) {
        const parent = itemMap.get(item.parentId);
        const child = itemMap.get(item.id);
        if (parent && child && parent.type === 'folder') {
          if (!parent.children) parent.children = [];
          parent.children.push(child);
        }
      }
    }
    // Sort children by orderIndex for each folder
    for (const [, node] of itemMap) {
      if (node.type === 'folder' && node.children && node.children.length > 1) {
        node.children.sort((a, b) => (a.orderIndex || '').localeCompare(b.orderIndex || ''));
      }
    }

    // Sort roots as well
    rootItems.sort((a, b) => (a.orderIndex || '').localeCompare(b.orderIndex || ''));
    return rootItems;
  }

  // === FOLDER METADATA METHODS ===

  // Check if folder's children are already cached
  async hasFolderChildrenCached(namespace: string, folderId: string): Promise<boolean> {
    try {
      // Get folder metadata to check if children have been loaded
      const metadata = await offlineWorkerService.getFolderMetadata(namespace, folderId);
      return metadata?.hasLoadedChildren || false;
    } catch {
      console.log(`No metadata found for folder ${folderId}, assuming not cached`);
      return false;
    }
  }

  // Check if root items are cached
  async hasRootItemsCached(namespace: string): Promise<boolean> {
    try {
      const rootItems = await this.getRootItems(namespace);
      return rootItems.length > 0;
    } catch {
      return false;
    }
  }

  // === CONVERSION UTILITY ===

  // Convert raw database items to UI-friendly BookmarkItem format
  private convertToBookmarkItems(items: (LocalDBBookmark | LocalDBFolder)[]): LocalBookmarkItem[] {
    return items.map((item: LocalDBBookmark | LocalDBFolder) => {
      if ('url' in item && item.url) {
        const bookmark = item as LocalDBBookmark;
        return {
          id: bookmark.id,
          type: 'bookmark' as const,
          namespace: bookmark.namespace,
          parentId: bookmark.parentId || null,
          orderIndex: bookmark.orderIndex,
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
          title: bookmark.name,
          url: bookmark.url,
          favorite: bookmark.isFavorite
        };
      } else {
        const folder = item as LocalDBFolder;
        return {
          id: folder.id,
          type: 'folder' as const,
          namespace: folder.namespace,
          parentId: folder.parentId || null,
          orderIndex: folder.orderIndex,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          name: folder.name,
          open: folder.isOpen
        };
      }
    });
  }
}

// Singleton instance
export const localDataService = new LocalDataService();
