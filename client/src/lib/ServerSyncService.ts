/**
 * Service for synchronizing local operations with the server
 * Handles applying pending operations when SSE is connected
 */

import { ServerAPI } from "./serverAPI";
import type { OperationEnvelope } from "./builder/treeBuilder";
import type { DatabaseService, StoredOperation } from "../workers/database";

interface SyncConfig {
  maxRetries: number;
  retryDelayMs: number;
  batchSize: number;
}

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  batchSize: 10,
};

export class ServerSyncService {
  private databaseService: DatabaseService;
  private config: SyncConfig;
  private isSyncing = false;
  private isConnected = false; // Track SSE connection state
  private syncAbortController: AbortController | null = null;
  private onStatusChange?: (status: {
    isSyncing: boolean;
    pendingCount?: number;
    failedCount?: number;
  }) => void;
  private onOperationSynced?: (
    operationId: string,
    success: boolean,
    error?: string,
  ) => void;
  private syncQueue = new Set<string>(); // Track operations currently being synced
  private statusChangeDebounceTimer: ReturnType<typeof setTimeout> | null =
    null;

  constructor(
    databaseService: DatabaseService,
    config: Partial<SyncConfig> = {},
    callbacks?: {
      onStatusChange?: (status: {
        isSyncing: boolean;
        pendingCount?: number;
        failedCount?: number;
      }) => void;
      onOperationSynced?: (
        operationId: string,
        success: boolean,
        error?: string,
      ) => void;
    },
  ) {
    this.databaseService = databaseService;
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    this.onStatusChange = callbacks?.onStatusChange;
    this.onOperationSynced = callbacks?.onOperationSynced;
  }

  /**
   * Start syncing pending operations to the server
   * This should be called when SSE connection is established
   */
  async startSync(): Promise<void> {
    if (this.isSyncing) {
      console.log("[ServerSync] Sync already in progress");
      return;
    }

    console.log("[ServerSync] Starting operation sync to server");
    this.isSyncing = true;
    this.isConnected = true;
    this.syncAbortController = new AbortController();

    // Notify about status change
    this.notifyStatusChange();

    try {
      await this.syncPendingOperations();
      console.log("[ServerSync] Initial sync completed");
    } catch (error) {
      console.error("[ServerSync] Initial sync failed:", error);
    } finally {
      this.isSyncing = false;
      this.notifyStatusChange();
    }
  }

  /**
   * Stop syncing operations
   * This should be called when SSE connection is lost
   */
  stopSync(): void {
    console.log("[ServerSync] Stopping operation sync");
    this.isSyncing = false;
    this.isConnected = false;

    if (this.syncAbortController) {
      this.syncAbortController.abort();
      this.syncAbortController = null;
    }

    this.notifyStatusChange();
  }

  /**
   * Sync a single operation immediately (called when new operation is created while connected)
   */
  async syncOperationImmediately(operationId: string): Promise<boolean> {
    if (!this.isConnected) {
      console.log(
        `[ServerSync] Not connected, skipping immediate sync of operation ${operationId}`,
      );
      return false;
    }

    if (this.syncQueue.has(operationId)) {
      console.log(`[ServerSync] Operation ${operationId} already being synced`);
      return false;
    }

    console.log(`[ServerSync] Immediately syncing operation: ${operationId}`);

    // Get the specific operation from database more efficiently
    const allOperations = await this.databaseService.loadOperationLog();
    const operation = allOperations.find((op) => op.id === operationId);

    if (!operation) {
      console.error(
        `[ServerSync] Operation ${operationId} not found for immediate sync`,
      );
      return false;
    }

    if (operation.status === "completed") {
      console.log(`[ServerSync] Operation ${operationId} already completed`);
      return true;
    }

    // Add to sync queue to prevent duplicate syncing
    this.syncQueue.add(operationId);

    try {
      await this.syncOperation(operation);
      return true;
    } catch (error) {
      console.error(
        `[ServerSync] Failed to immediately sync operation ${operationId}:`,
        error,
      );
      return false;
    } finally {
      this.syncQueue.delete(operationId);
    }
  }

  /**
   * Sync all pending operations to the server
   */
  private async syncPendingOperations(): Promise<void> {
    const pendingOperations = await this.databaseService.getPendingOperations();
    const failedOperations = await this.databaseService.getFailedOperations();

    // Combine and sort all operations that need syncing
    const allOperationsToSync = [...pendingOperations, ...failedOperations];
    allOperationsToSync.sort((a, b) => a.ts - b.ts);

    if (allOperationsToSync.length === 0) {
      console.log("[ServerSync] No operations to sync");
      return;
    }

    console.log(
      `[ServerSync] Syncing ${allOperationsToSync.length} operations to server`,
    );

    // Process operations in batches to avoid overwhelming the server
    for (
      let i = 0;
      i < allOperationsToSync.length;
      i += this.config.batchSize
    ) {
      if (!this.isSyncing) {
        console.log("[ServerSync] Sync cancelled");
        break;
      }

      const batch = allOperationsToSync.slice(i, i + this.config.batchSize);
      await this.processBatch(batch);

      // Small delay between batches to avoid overwhelming the server
      if (i + this.config.batchSize < allOperationsToSync.length) {
        await this.delay(100);
      }
    }
  }

  /**
   * Process a batch of operations
   */
  private async processBatch(operations: StoredOperation[]): Promise<void> {
    const promises = operations.map((storedOp) => this.syncOperation(storedOp));
    await Promise.allSettled(promises);
  }

  /**
   * Sync a single operation to the server
   */
  private async syncOperation(storedOperation: StoredOperation): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    // Validate operation structure
    if (!storedOperation.op || typeof storedOperation.op !== "object") {
      console.error(
        `[ServerSync] Invalid operation data for ${storedOperation.id}`,
      );
      return;
    }

    const envelope: OperationEnvelope = {
      id: storedOperation.id,
      ts: storedOperation.ts,
      op: storedOperation.op as OperationEnvelope["op"],
    };

    const currentRetries = storedOperation.retryCount || 0;

    if (currentRetries >= this.config.maxRetries) {
      console.warn(
        `[ServerSync] Max retries exceeded for operation ${storedOperation.id}, skipping`,
      );
      return;
    }

    // Add to sync queue to prevent duplicate syncing
    this.syncQueue.add(storedOperation.id);

    try {
      console.log(
        `[ServerSync] Applying operation ${storedOperation.id} to server (attempt ${currentRetries + 1})`,
      );

      const result = await ServerAPI.applyOperation(envelope, {
        signal: this.syncAbortController?.signal,
      });

      if (result.success) {
        console.log(
          `[ServerSync] Successfully applied operation ${storedOperation.id} to server`,
        );
        await this.databaseService.updateOperationStatus(
          storedOperation.id,
          "completed",
        );
        this.onOperationSynced?.(storedOperation.id, true);
      } else {
        console.warn(
          `[ServerSync] Server rejected operation ${storedOperation.id}:`,
          result.error,
        );
        await this.handleOperationFailure(
          storedOperation,
          result.error || "Server rejected operation",
        );
        this.onOperationSynced?.(storedOperation.id, false, result.error);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[ServerSync] Failed to apply operation ${storedOperation.id} to server:`,
        errorMessage,
      );

      // Don't retry if the request was aborted
      if (errorMessage.includes("aborted")) {
        console.log(
          `[ServerSync] Operation ${storedOperation.id} sync was cancelled`,
        );
        return;
      }

      await this.handleOperationFailure(storedOperation, errorMessage);
      this.onOperationSynced?.(storedOperation.id, false, errorMessage);
    } finally {
      this.syncQueue.delete(storedOperation.id);
    }
  }

  /**
   * Handle operation failure - update status and retry count
   */
  private async handleOperationFailure(
    storedOperation: StoredOperation,
    errorMessage: string,
  ): Promise<void> {
    const newRetryCount = (storedOperation.retryCount || 0) + 1;

    if (newRetryCount >= this.config.maxRetries) {
      console.error(
        `[ServerSync] Operation ${storedOperation.id} failed permanently after ${newRetryCount} attempts`,
      );
      await this.databaseService.updateOperationStatus(
        storedOperation.id,
        "failed",
        errorMessage,
        newRetryCount,
      );
    } else {
      console.warn(
        `[ServerSync] Operation ${storedOperation.id} failed, will retry (attempt ${newRetryCount})`,
      );
      await this.databaseService.updateOperationStatus(
        storedOperation.id,
        "pending",
        errorMessage,
        newRetryCount,
      );

      // Add a delay before the next attempt to avoid rapid retries
      await this.delay(this.config.retryDelayMs * newRetryCount);
    }
  }

  /**
   * Notify about status changes (debounced to avoid excessive updates)
   */
  private notifyStatusChange(): void {
    if (!this.onStatusChange) return;

    // Clear existing timer
    if (this.statusChangeDebounceTimer) {
      clearTimeout(this.statusChangeDebounceTimer);
    }

    // Debounce the status change notification
    this.statusChangeDebounceTimer = setTimeout(async () => {
      if (!this.onStatusChange) return;

      try {
        if (this.isSyncing) {
          const [pendingOps, failedOps] = await Promise.all([
            this.databaseService.getPendingOperations(),
            this.databaseService.getFailedOperations(),
          ]);

          this.onStatusChange({
            isSyncing: true,
            pendingCount: pendingOps.length,
            failedCount: failedOps.length,
          });
        } else {
          this.onStatusChange({ isSyncing: false });
        }
      } catch (error) {
        console.error(
          "[ServerSync] Failed to get status for notification:",
          error,
        );
      }
    }, 100); // 100ms debounce
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopSync();

    if (this.statusChangeDebounceTimer) {
      clearTimeout(this.statusChangeDebounceTimer);
      this.statusChangeDebounceTimer = null;
    }

    this.syncQueue.clear();
    this.onStatusChange = undefined;
    this.onOperationSynced = undefined;
  }

  /**
   * Get sync status
   */
  getSyncStatus(): {
    isSyncing: boolean;
    isConnected: boolean;
    pendingCount?: number;
    failedCount?: number;
  } {
    return { isSyncing: this.isSyncing, isConnected: this.isConnected };
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Force sync a specific operation (useful for manual retry)
   */
  async forceSyncOperation(operationId: string): Promise<boolean> {
    const allOperations = await this.databaseService.loadOperationLog();
    const operation = allOperations.find((op) => op.id === operationId);

    if (!operation) {
      console.error(`[ServerSync] Operation ${operationId} not found`);
      return false;
    }

    if (operation.status === "completed") {
      console.log(`[ServerSync] Operation ${operationId} already completed`);
      return true;
    }

    try {
      await this.syncOperation(operation);
      return true;
    } catch (error) {
      console.error(
        `[ServerSync] Failed to force sync operation ${operationId}:`,
        error,
      );
      return false;
    }
  }
}
