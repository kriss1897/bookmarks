import Dexie, { type Table } from 'dexie';
import type { Operation, OperationStatus } from '../types/operations';

export interface LocalBookmark {
  id: string | number;
  name: string;
  url: string;
  parentId?: number;
  isFavorite: boolean;
  namespace: string;
  orderIndex: string;
  isTemporary: boolean; // true for temp IDs
  createdAt: number;
  updatedAt: number;
}

export interface LocalFolder {
  id: string | number;
  name: string;
  parentId?: number;
  isOpen: boolean;
  namespace: string;
  orderIndex: string;
  isTemporary: boolean; // true for temp IDs
  createdAt: number;
  updatedAt: number;
}

export interface StoredOperation {
  id: string; // operation ID
  clientId: string;
  namespace: string;
  type: string;
  payload: string; // JSON stringified
  clientCreatedAt: number;
  status: OperationStatus;
  retryCount: number;
  createdAt: number;
}

export interface SyncMeta {
  namespace: string;
  lastSyncTimestamp: number;
  pendingOperationsCount: number;
  clientId: string;
}

export class LocalDatabase extends Dexie {
  bookmarks!: Table<LocalBookmark, string | number>;
  folders!: Table<LocalFolder, string | number>;
  operations!: Table<StoredOperation, string>;
  syncMeta!: Table<SyncMeta, string>;

  constructor() {
    super('BookmarksOfflineDB');
    
    // Use a high version number to avoid conflicts with existing databases
    // Date-based versioning: YYYYMMDD
    this.version(20250814).stores({
      bookmarks: '&id, namespace, parentId, orderIndex, isTemporary, createdAt, updatedAt',
      folders: '&id, namespace, parentId, orderIndex, isTemporary, createdAt, updatedAt',
      operations: '&id, namespace, status, clientCreatedAt, createdAt',
      syncMeta: '&namespace, lastSyncTimestamp'
    });

    // Handle version upgrade errors gracefully
    this.on('versionchange', () => {
      console.log('Database version changed, closing connection');
      this.close();
    });

    // Handle blocked upgrades
    this.on('blocked', () => {
      console.warn('Database upgrade blocked by other connections');
      console.log('Please close other tabs using this app and refresh this page');
      
      // Notify the user through a custom event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('database-blocked', {
          detail: {
            message: 'Database upgrade blocked. Please close other tabs and refresh.',
            database: 'BookmarksOfflineDB'
          }
        }));
      }
    });

    // Handle database ready state
    this.on('ready', () => {
      console.log('Dexie database ready');
    });
  }

  // Development utility: reset database if version conflicts occur
  async resetDatabase(): Promise<void> {
    try {
      await this.delete();
      console.log('Database deleted successfully');
      
      // Reopen the database
      await this.open();
      console.log('Database recreated successfully');
    } catch (error) {
      console.error('Failed to reset database:', error);
      throw error;
    }
  }

  // Get all items for a namespace (bookmarks + folders)
  async getNamespaceItems(namespace: string): Promise<(LocalBookmark | LocalFolder)[]> {
    const [bookmarks, folders] = await Promise.all([
      this.bookmarks.where('namespace').equals(namespace).sortBy('orderIndex'),
      this.folders.where('namespace').equals(namespace).sortBy('orderIndex')
    ]);
    
    return [...bookmarks, ...folders].sort((a, b) => (a.orderIndex || '').localeCompare(b.orderIndex || ''));
  }

  // Get pending operations for namespace
  async getPendingOperations(namespace: string): Promise<Operation[]> {
    const stored = await this.operations
      .where('namespace').equals(namespace)
      .and(op => op.status === 'pending')
      .sortBy('clientCreatedAt');

    return stored.map((op: StoredOperation) => ({
      id: op.id,
      clientId: op.clientId,
      namespace: op.namespace,
      type: op.type as Operation['type'],
      payload: JSON.parse(op.payload),
      clientCreatedAt: op.clientCreatedAt,
      status: op.status,
      retryCount: op.retryCount
    }));
  }

  // Add operation to queue
  async enqueueOperation(operation: Operation): Promise<void> {
    const stored: StoredOperation = {
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

    await this.operations.put(stored);
    await this.updatePendingCount(operation.namespace);
  }

  // Mark operations as synced
  async markOperationsSynced(operationIds: string[]): Promise<void> {
    await this.transaction('rw', this.operations, this.syncMeta, async () => {
      // Update operation status
      for (const id of operationIds) {
        await this.operations.update(id, { status: 'synced' });
      }

      // Update pending counts for affected namespaces
      const operations = await this.operations.where('id').anyOf(operationIds).toArray();
      const namespaces = [...new Set(operations.map(op => op.namespace))];
      
      for (const namespace of namespaces) {
        await this.updatePendingCount(namespace);
      }
    });
  }

  // Mark operations as failed
  async markOperationsFailed(operationIds: string[]): Promise<void> {
    await this.transaction('rw', this.operations, this.syncMeta, async () => {
      for (const id of operationIds) {
        const operation = await this.operations.get(id);
        if (operation) {
          await this.operations.update(id, { 
            status: 'failed',
            retryCount: (operation.retryCount || 0) + 1
          });
        }
      }

      // Update pending counts
      const operations = await this.operations.where('id').anyOf(operationIds).toArray();
      const namespaces = [...new Set(operations.map(op => op.namespace))];
      
      for (const namespace of namespaces) {
        await this.updatePendingCount(namespace);
      }
    });
  }

  // Apply temp ID to real ID mappings
  async applyIdMappings(mappings: Record<string, number>): Promise<void> {
    await this.transaction('rw', this.bookmarks, this.folders, this.operations, async () => {
      for (const [tempId, realId] of Object.entries(mappings)) {
        // Update bookmarks
        const bookmark = await this.bookmarks.get(tempId);
        if (bookmark) {
          await this.bookmarks.delete(tempId);
          await this.bookmarks.put({
            ...bookmark,
            id: realId,
            isTemporary: false
          });
        }

        // Update folders
        const folder = await this.folders.get(tempId);
        if (folder) {
          await this.folders.delete(tempId);
          await this.folders.put({
            ...folder,
            id: realId,
            isTemporary: false
          });
        }

        // Update operations that reference this ID
        const operations = await this.operations.toArray();
        for (const op of operations) {
          const payload = JSON.parse(op.payload);
          if (payload.id === tempId) {
            payload.id = realId;
            await this.operations.update(op.id, {
              payload: JSON.stringify(payload)
            });
          }
          if (payload.parentId === tempId) {
            payload.parentId = realId;
            await this.operations.update(op.id, {
              payload: JSON.stringify(payload)
            });
          }
        }
      }
    });
  }

  // Get pending operation count for namespace
  async getPendingCount(namespace: string): Promise<number> {
    return await this.operations
      .where('namespace').equals(namespace)
      .and(op => op.status === 'pending')
      .count();
  }

  // Update pending count in sync meta
  private async updatePendingCount(namespace: string): Promise<void> {
    const count = await this.getPendingCount(namespace);
    await this.syncMeta.put({
      namespace,
      lastSyncTimestamp: Date.now(),
      pendingOperationsCount: count,
      clientId: '' // Will be set by worker
    });
  }

  // Get sync metadata
  async getSyncMeta(namespace: string): Promise<SyncMeta | undefined> {
    return await this.syncMeta.get(namespace);
  }

  // Update last sync timestamp
  async updateLastSync(namespace: string, clientId: string): Promise<void> {
    const existing = await this.syncMeta.get(namespace);
    await this.syncMeta.put({
      namespace,
      lastSyncTimestamp: Date.now(),
      pendingOperationsCount: existing?.pendingOperationsCount || 0,
      clientId
    });
  }
}

// Singleton instance
export const localDB = new LocalDatabase();
