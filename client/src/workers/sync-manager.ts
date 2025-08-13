import type { SyncResponse } from '../types/operations';
import type { WorkerEventType } from './worker-types';
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
      
      const operations = await this.databaseManager.getPendingOperations(namespace);
      
      if (operations.length === 0) {
        this.syncStatus.set(namespace, 'synced');
        this.eventEmitter('syncStatus', { namespace, status: 'synced' });
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
    
    await this.databaseManager.updateSyncMeta(namespace, count, this.clientId);
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
}
