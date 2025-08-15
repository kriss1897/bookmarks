/**
 * Abstract storage interface for TreeBuilder operations.
 * Implementations can persist to memory, IndexedDB, localStorage, or remote storage.
 */

import type { OperationEnvelope } from './treeOps';

// Type definitions to avoid circular dependencies
interface StoredOperation {
  id: string;
  ts: number;
  op: Record<string, unknown>; // TreeOperation data as generic object
}

interface DatabaseServiceInterface {
  appendOperation(operation: OperationEnvelope): Promise<number>;
  loadOperationLog(): Promise<StoredOperation[]>;
  clear(): Promise<void>;
  getStats(): Promise<{ nodeCount: number; operationCount: number }>;
}

/**
 * Abstract base class for operation storage
 */
export abstract class OperationStorage {
  /**
   * Persist an operation to storage
   */
  abstract persistOperation(env: OperationEnvelope): Promise<void>;

  /**
   * Load all operations from storage in chronological order
   */
  abstract loadOperations(): Promise<OperationEnvelope[]>;

  /**
   * Clear all persisted operations (useful for testing)
   */
  abstract clearOperations(): Promise<void>;

  /**
   * Check if storage is initialized and ready for use
   */
  abstract isReady(): Promise<boolean>;
}

/**
 * In-memory storage implementation - operations are lost when the application closes
 */
export class MemoryOperationStorage extends OperationStorage {
  private operations: OperationEnvelope[] = [];

  async persistOperation(env: OperationEnvelope): Promise<void> {
    this.operations.push(env);
  }

  async loadOperations(): Promise<OperationEnvelope[]> {
    return [...this.operations].sort((a, b) => a.ts - b.ts);
  }

  async clearOperations(): Promise<void> {
    this.operations = [];
  }

  async isReady(): Promise<boolean> {
    return true;
  }
}

/**
 * IndexedDB storage implementation using the existing database service
 */
export class IndexedDBOperationStorage extends OperationStorage {
  private databaseService: DatabaseServiceInterface;

  constructor(databaseService: DatabaseServiceInterface) {
    super();
    this.databaseService = databaseService;
  }

  async persistOperation(env: OperationEnvelope): Promise<void> {
    try {
      await this.databaseService.appendOperation(env);
      console.log('[IndexedDBOperationStorage] Operation persisted:', env.id);
    } catch (error) {
      console.error('[IndexedDBOperationStorage] Failed to persist operation:', error);
      // Don't throw - allow operation to succeed in memory even if persistence fails
    }
  }

  async loadOperations(): Promise<OperationEnvelope[]> {
    try {
      const storedOperations = await this.databaseService.loadOperationLog();
      // Convert stored operations back to OperationEnvelope format
      return storedOperations.map((stored: StoredOperation) => ({
        id: stored.id,
        ts: stored.ts,
        op: stored.op as OperationEnvelope['op']
      }));
    } catch (error) {
      console.error('[IndexedDBOperationStorage] Failed to load operations:', error);
      return [];
    }
  }

  async clearOperations(): Promise<void> {
    try {
      await this.databaseService.clear();
    } catch (error) {
      console.error('[IndexedDBOperationStorage] Failed to clear operations:', error);
      throw error;
    }
  }

  async isReady(): Promise<boolean> {
    try {
      // Test database connectivity by getting stats
      await this.databaseService.getStats();
      return true;
    } catch (error) {
      console.error('[IndexedDBOperationStorage] Database not ready:', error);
      return false;
    }
  }
}
