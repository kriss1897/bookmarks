import type { SyncResponse, QueuedOperation } from '../types/operations';
import type { WorkerEventType, ServerItem } from './worker-types';
import type { DatabaseManager } from './database-manager';
import { SYNC_CONFIG } from './worker-config';

export class SyncManager {
  private syncStatus = new Map<string, string>();
  private batchTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private retryAttempts = new Map<string, number>();
  private clientId: string;
  private isOnlineGetter: () => boolean;
  private eventEmitter: (event: WorkerEventType, data: unknown) => void;
  private databaseManager: DatabaseManager;

  constructor(
    clientId: string,
    isOnlineGetter: () => boolean,
    eventEmitter: (event: WorkerEventType, data: unknown) => void,
    databaseManager: DatabaseManager
  ) {
    this.clientId = clientId;
    this.isOnlineGetter = isOnlineGetter;
    this.eventEmitter = eventEmitter;
    this.databaseManager = databaseManager;
  }

  async syncNow(namespace?: string): Promise<void> {
    if (namespace) {
      await this.syncNamespace(namespace);
    } else {
      const metas = await this.databaseManager.getAllSyncMetas();
      for (const meta of metas) {
        await this.syncNamespace(meta.namespace);
      }
    }
  }

  scheduleBatchSync(namespace: string): void {
    if (this.batchTimeouts.has(namespace)) {
      clearTimeout(this.batchTimeouts.get(namespace));
    }
    
    const timeout = setTimeout(() => {
      this.batchTimeouts.delete(namespace);
      this.syncNamespace(namespace);
    }, SYNC_CONFIG.batchWindow);
    
    this.batchTimeouts.set(namespace, timeout);
  }

  async resumePendingSyncs(): Promise<void> {
    try {
      const metas = await this.databaseManager.getAllSyncMetas();
      for (const meta of metas) {
        if (meta.pendingOperationsCount > 0) {
          console.log(`Resuming sync for namespace: ${meta.namespace}`);
          this.scheduleBatchSync(meta.namespace);
        }
      }
    } catch (error) {
      console.error('Error resuming pending syncs:', error);
    }
  }

  getSyncStatus(namespace: string): string {
    return this.syncStatus.get(namespace) || 'idle';
  }

  private async syncNamespace(namespace: string): Promise<void> {
    if (!this.isOnlineGetter()) {
      console.log(`Skipping sync for ${namespace} - offline`);
      return;
    }
    
    if (this.syncStatus.get(namespace) === 'syncing') {
      console.log(`Already syncing ${namespace}`);
      return;
    }
    
    try {
      this.syncStatus.set(namespace, 'syncing');
      this.eventEmitter('syncStatus', { namespace, status: 'syncing' });
      
      const queuedOperations = await this.databaseManager.getPendingOperations(namespace);
      
      if (queuedOperations.length === 0) {
        this.syncStatus.set(namespace, 'synced');
        this.eventEmitter('syncStatus', { namespace, status: 'synced' });
        return;
      }
      
      console.log(`Syncing ${queuedOperations.length} operations for ${namespace}`);
      
      // Process operations individually instead of bulk sync
      const syncResults: SyncResponse['applied'] = [];
      const failedOperationIds: string[] = [];
      const succeededOperationIds: string[] = [];
      
      for (const queuedOp of queuedOperations) {
        try {
          const result = await this.syncIndividualOperation(namespace, queuedOp);
          
          if (result.success) {
            succeededOperationIds.push(queuedOp.id);
            syncResults.push({
              operationId: queuedOp.id,
              status: 'success',
              data: result.data,
              duplicate: result.duplicate
            });
          } else {
            failedOperationIds.push(queuedOp.id);
            syncResults.push({
              operationId: queuedOp.id,
              status: 'failed',
              error: result.error
            });
          }
        } catch (error) {
          console.error(`Failed to sync operation ${queuedOp.id}:`, error);
          failedOperationIds.push(queuedOp.id);
          syncResults.push({
            operationId: queuedOp.id,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      // Create synthetic SyncResponse for compatibility with existing processSyncResult
      const result: SyncResponse = {
        applied: syncResults,
        updatedItems: [], // Not used in individual operation mode
        mappings: {}, // Not needed with UUIDs
        serverTimestamp: Date.now()
      };
      
      await this.processSyncResult(namespace, result);
      
      this.syncStatus.set(namespace, 'synced');
      this.eventEmitter('syncStatus', { namespace, status: 'synced' });
      
    } catch (error) {
      console.error(`Sync failed for ${namespace}:`, error);
      this.syncStatus.set(namespace, 'error');
      this.eventEmitter('syncStatus', { 
        namespace, 
        status: 'error',
        error: (error as Error).message 
      });
      
      this.scheduleRetrySync(namespace);
    }
  }

  private async processSyncResult(namespace: string, result: SyncResponse): Promise<void> {
    const { applied = [] } = result || {};
    
    console.log('Processing sync result:', { applied });
    
    const syncedIds: string[] = [];
    const failedIds: string[] = [];
    
    if (Array.isArray(applied)) {
      for (const appliedOp of applied) {
        if (appliedOp && appliedOp.operationId) {
          if (appliedOp.status === 'success') {
            syncedIds.push(appliedOp.operationId);
            
            // Apply server response data to local database for state reconciliation
            if (appliedOp.data && !appliedOp.duplicate) {
              await this.applyServerData(namespace, appliedOp.data);
            }
          } else {
            failedIds.push(appliedOp.operationId);
          }
        }
      }
    }
    
    if (syncedIds.length > 0) {
      await this.databaseManager.markOperationsSynced(syncedIds);
    }
    
    if (failedIds.length > 0) {
      await this.databaseManager.markOperationsFailed(failedIds);
    }
    
    await this.updatePendingCount(namespace);
    this.eventEmitter('dataChanged', { namespace });
  }

  private async updatePendingCount(namespace: string): Promise<void> {
    const count = await this.databaseManager.getPendingOperationsCount(namespace);
    
    this.eventEmitter('pendingCount', { namespace, count });
  }

  /**
   * Apply server response data to local database for state reconciliation
   */
  private async applyServerData(namespace: string, serverData: unknown): Promise<void> {
    if (!serverData || typeof serverData !== 'object') {
      return;
    }

    const data = serverData as Record<string, unknown>;
    
    try {
      // Use the database manager's reconcileWithServer method to update the item
      // This ensures the server data takes precedence and updates local state
      await this.databaseManager.reconcileWithServer(namespace, [data as unknown as ServerItem]);
      
      console.log('Applied server data to local database:', data);
    } catch (error) {
      console.error('Failed to apply server data:', error, data);
    }
  }

  private scheduleRetrySync(namespace: string): void {
    const retryCount = this.retryAttempts?.get(namespace) || 0;
    const delay = SYNC_CONFIG.retryDelays[Math.min(retryCount, SYNC_CONFIG.retryDelays.length - 1)];
    
    this.retryAttempts.set(namespace, retryCount + 1);
    
    setTimeout(() => {
      if (this.isOnlineGetter()) {
        this.syncNamespace(namespace);
      }
    }, delay);
  }

  private async syncIndividualOperation(namespace: string, queuedOp: QueuedOperation): Promise<{ 
    success: boolean; 
    error?: string; 
    data?: unknown; 
    operationId?: string; 
    duplicate?: boolean; 
  }> {
    // Convert QueuedOperation to Operation for server sync (remove client-specific fields)
    const operation = {
      id: queuedOp.id,
      type: queuedOp.type,
      namespace: queuedOp.namespace,
      payload: queuedOp.payload,
      clientId: queuedOp.clientId,
      timestamp: queuedOp.timestamp
    };

    // Map operation types to individual endpoints (matching server routes exactly)
    const endpointMap: Record<string, { method: string; path: string }> = {
      'createBookmark': { method: 'POST', path: '/api/operations/{namespace}/create-bookmark' },
      'createFolder': { method: 'POST', path: '/api/operations/{namespace}/create-folder' },
      'updateBookmark': { method: 'PUT', path: '/api/operations/{namespace}/update-bookmark' },
      'updateFolder': { method: 'PUT', path: '/api/operations/{namespace}/update-folder' },
      'deleteBookmark': { method: 'DELETE', path: '/api/operations/{namespace}/delete-bookmark' },
      'deleteFolder': { method: 'DELETE', path: '/api/operations/{namespace}/delete-folder' },
      'moveBookmark': { method: 'POST', path: '/api/operations/{namespace}/move-bookmark' },
      'moveFolder': { method: 'POST', path: '/api/operations/{namespace}/move-folder' }
    };

    const endpoint = endpointMap[operation.type];
    if (!endpoint) {
      return { success: false, error: `Unknown operation type: ${operation.type}` };
    }

    const url = endpoint.path.replace('{namespace}', encodeURIComponent(namespace));

    try {
      const response = await fetch(url, {
        method: endpoint.method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(operation)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { 
          success: false, 
          error: `HTTP ${response.status}: ${errorText}` 
        };
      }

      // For successful responses, the server returns the operation result
      const result = await response.json();
      
      // Check if this was a duplicate operation (already processed)
      if (result.message === 'Operation already processed') {
        console.log(`Operation ${operation.id} was already processed on server`);
        return { success: true, duplicate: true };
      }

      // Extract the updated data from the server response for state reconciliation
      let updatedData = null;
      if (result.success && result.data) {
        updatedData = result.data;
      }

      return { 
        success: true, 
        data: updatedData,
        operationId: result.operationId 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }
}
