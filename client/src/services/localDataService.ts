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
  isTemporary: boolean;
  createdAt: number;
  updatedAt: number;
}

export class LocalDataService {
  // Get all bookmarks for a namespace
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
          prevSiblingId: null, // Will be calculated if needed
          nextSiblingId: null, // Will be calculated if needed
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
          prevSiblingId: null, // Will be calculated if needed
          nextSiblingId: null, // Will be calculated if needed
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

    return rootItems;
  }
}

// Singleton instance
export const localDataService = new LocalDataService();
