import type { Operation } from '../types/operations';
import type { BookmarkItem } from './bookmarkAPI';

// Extended type for local UI with children support
export interface LocalBookmarkItem extends BookmarkItem {
  children?: LocalBookmarkItem[];
}

// Database item types
interface LocalDBBookmark {
  id: string | number;
  name: string;
  url: string;
  parentId?: number;
  isFavorite: boolean;
  namespace: string;
  isTemporary: boolean;
  createdAt: number;
  updatedAt: number;
}

interface LocalDBFolder {
  id: string | number;
  name: string;
  parentId?: number;
  isOpen: boolean;
  namespace: string;
  isTemporary: boolean;
  createdAt: number;
  updatedAt: number;
}

type LocalDBItem = LocalDBBookmark | LocalDBFolder;

// SharedWorker communication helper
class SharedWorkerClient {
  private worker: SharedWorker;
  private port: MessagePort;
  private requestId = 0;
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();

  constructor() {
    this.worker = new SharedWorker('/sse-shared-worker.js');
    this.port = this.worker.port;
    
    this.port.onmessage = (event) => {
      const { requestId, data, error } = event.data;
      
      if (requestId && this.pendingRequests.has(requestId)) {
        const { resolve, reject } = this.pendingRequests.get(requestId)!;
        this.pendingRequests.delete(requestId);
        
        if (error) {
          reject(new Error(error));
        } else {
          resolve(data);
        }
      }
    };
    
    this.port.start();
  }

  private async sendRequest(type: string, data: Record<string, unknown>): Promise<unknown> {
    const requestId = `req_${++this.requestId}`;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      
      this.port.postMessage({
        type,
        data: { ...data, requestId }
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  async getNamespaceItems(namespace: string): Promise<LocalDBItem[]> {
    return this.sendRequest('GET_NAMESPACE_ITEMS', { namespace }) as Promise<LocalDBItem[]>;
  }

  async applyOperationOptimistically(operation: Operation): Promise<void> {
    await this.sendRequest('APPLY_OPERATION_OPTIMISTICALLY', { operation });
  }

  async getById(namespace: string, id: string | number): Promise<LocalBookmarkItem | null> {
    return this.sendRequest('GET_BY_ID', { namespace, id }) as Promise<LocalBookmarkItem | null>;
  }

  async reconcileWithServer(namespace: string, serverItems: LocalBookmarkItem[]): Promise<void> {
    await this.sendRequest('RECONCILE_WITH_SERVER', { namespace, serverItems });
  }

  async fetchInitialData(namespace: string): Promise<void> {
    await this.sendRequest('FETCH_INITIAL_DATA', { namespace });
  }
}

const workerClient = new SharedWorkerClient();

export class LocalDataService {
  // Get all bookmarks for a namespace
  async getBookmarks(namespace: string): Promise<LocalBookmarkItem[]> {
    const items = await workerClient.getNamespaceItems(namespace);
    
    // Convert to BookmarkItem format
    const bookmarkItems: LocalBookmarkItem[] = items.map(item => {
      // Check if it's a bookmark by checking for url property
      if ('url' in item && item.url) {
        // It's a bookmark
        const bookmark = item as LocalDBBookmark;
        return {
          id: typeof bookmark.id === 'string' ? parseInt(bookmark.id) || -1 : bookmark.id,
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
          id: typeof folder.id === 'string' ? parseInt(folder.id) || -1 : folder.id,
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
    await workerClient.applyOperationOptimistically(operation);
  }

  // Reconcile with server state after sync
  async reconcileWithServerState(namespace: string, serverItems: LocalBookmarkItem[]): Promise<void> {
    await workerClient.reconcileWithServer(namespace, serverItems);
  }

  // Get item by ID (useful for immediate reference after creation)
  async getById(namespace: string, id: string | number): Promise<LocalBookmarkItem | null> {
    return await workerClient.getById(namespace, id);
  }

  // Fetch initial server data for fresh sessions
  async fetchInitialData(namespace: string): Promise<void> {
    await workerClient.fetchInitialData(namespace);
  }

  // Build hierarchical structure from flat array
  private buildHierarchy(items: LocalBookmarkItem[]): LocalBookmarkItem[] {
    const itemMap = new Map<number, LocalBookmarkItem>();
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
