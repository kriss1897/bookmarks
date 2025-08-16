/**
 * Hook for monitoring server synchronization status
 * Provides real-time updates on sync progress and operation status
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useBroadcastChannel } from './useBroadcastChannel';
import { useSharedWorkerConnection } from './useSharedWorkerConnection';
import type { BroadcastMessage } from '../workers/sharedWorkerAPI';

export interface SyncStatus {
  isSyncing: boolean;
  pendingCount?: number;
  failedCount?: number;
  lastSyncedOperation?: string;
  lastSyncError?: string;
  isConnected?: boolean;
}

export const useServerSync = () => {
  const { workerProxy, isConnected: workerConnected } = useSharedWorkerConnection();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSyncing: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const lastStatusFetch = useRef<number>(0);

  // Listen for sync-related broadcast messages
  const { error: broadcastError } = useBroadcastChannel(
    'bookmarks-sync',
    useCallback((message: BroadcastMessage) => {
      switch (message.type) {
        case 'sync_status_changed':
          setSyncStatus(prev => ({
            ...prev,
            isSyncing: message.isSyncing,
            pendingCount: message.pendingCount,
            failedCount: message.failedCount
          }));
          break;
          
        case 'operation_sync_completed':
          setSyncStatus(prev => ({
            ...prev,
            lastSyncedOperation: message.operationId,
            lastSyncError: message.success ? undefined : message.error
          }));
          break;
          
        default:
          // Ignore other message types
          break;
      }
    }, [])
  );

  // Get initial sync status with debouncing
  const fetchSyncStatus = useCallback(async () => {
    if (!workerProxy || !workerConnected) return;

    const now = Date.now();
    if (now - lastStatusFetch.current < 1000) {
      // Debounce: don't fetch more than once per second
      return;
    }
    lastStatusFetch.current = now;

    setIsLoading(true);
    try {
      const status = await workerProxy.getSyncStatus();
      setSyncStatus(prev => ({
        ...prev,
        ...status
      }));
    } catch (error) {
      console.error('Failed to get sync status:', error);
    } finally {
      setIsLoading(false);
    }
  }, [workerProxy, workerConnected]);

  // Get initial sync status when worker becomes available
  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  // Methods to interact with sync service
  const forceSyncOperation = useCallback(async (operationId: string): Promise<boolean> => {
    if (!workerProxy || !workerConnected) {
      console.error('SharedWorker not available');
      return false;
    }

    try {
      const result = await workerProxy.forceSyncOperation(operationId);
      // Refresh status after force sync
      setTimeout(fetchSyncStatus, 100);
      return result;
    } catch (error) {
      console.error('Failed to force sync operation:', error);
      return false;
    }
  }, [workerProxy, workerConnected, fetchSyncStatus]);

  const refreshSyncStatus = useCallback(async (): Promise<void> => {
    await fetchSyncStatus();
  }, [fetchSyncStatus]);

  const syncOperationImmediately = useCallback(async (operationId: string): Promise<boolean> => {
    if (!workerProxy || !workerConnected) {
      console.error('SharedWorker not available');
      return false;
    }

    try {
      const result = await workerProxy.syncOperationImmediately(operationId);
      // Refresh status after immediate sync
      setTimeout(fetchSyncStatus, 100);
      return result;
    } catch (error) {
      console.error('Failed to immediately sync operation:', error);
      return false;
    }
  }, [workerProxy, workerConnected, fetchSyncStatus]);

  return {
    syncStatus: {
      ...syncStatus,
      isConnected: workerConnected
    },
    isLoading,
    forceSyncOperation,
    refreshSyncStatus,
    syncOperationImmediately,
    error: broadcastError
  };
};
