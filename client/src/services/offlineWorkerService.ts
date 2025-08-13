import * as Comlink from 'comlink';
import type { WorkerAPI } from '../workers/sse-shared-worker';
import type { 
  Operation
} from '../types/operations';
import { 
  generateClientId,
  generateTempId,
  OperationType
} from '../types/operations';

export class OfflineWorkerService {
  private worker: SharedWorker | null = null;
  private workerAPI: Comlink.Remote<WorkerAPI> | null = null;
  private clientId: string;
  private listenerProxyMap = new WeakMap<(data: unknown) => void, Comlink.ProxyMarked>();

  constructor() {
    this.clientId = generateClientId();
    this.initializeWorker();
  }

  private async initializeWorker() {
    try {
      this.worker = new SharedWorker(
        new URL('../workers/sse-shared-worker.ts', import.meta.url),
        { type: 'module', name: 'sse-worker' }
      );
      
      // Wrap the worker port with Comlink
      this.workerAPI = Comlink.wrap<WorkerAPI>(this.worker.port);
      
      console.log('OfflineWorkerService initialized with Comlink');
    } catch (error) {
      console.error('Failed to initialize SharedWorker:', error);
      // Fallback to local operation queue could be implemented here
    }
  }

  // Event handling methods
  async addEventListener(type: 'dataChanged' | 'pendingCount' | 'syncStatus' | 'connectivityChanged' | 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'event', 
                       listener: (data: unknown) => void): Promise<void> {
    if (!this.workerAPI) return;
    
    // Create and store the proxy if it doesn't exist
    if (!this.listenerProxyMap.has(listener)) {
      const proxy = Comlink.proxy(listener);
      this.listenerProxyMap.set(listener, proxy);
    }
    
    const proxy = this.listenerProxyMap.get(listener)! as unknown as (data: unknown) => void;
    await this.workerAPI.addEventListener(type, proxy);
  }

  async removeEventListener(type: 'dataChanged' | 'pendingCount' | 'syncStatus' | 'connectivityChanged' | 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'event', 
                           listener: (data: unknown) => void): Promise<void> {
    if (!this.workerAPI) return;
    
    // Use the stored proxy for removal
    const proxy = this.listenerProxyMap.get(listener);
    if (proxy) {
      await this.workerAPI.removeEventListener(type, proxy as unknown as (data: unknown) => void);
    }
  }

  // Connection management
  async connect(namespace: string): Promise<void> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    await this.workerAPI.connect(namespace);
  }

  async disconnect(namespace: string): Promise<void> {
    if (!this.workerAPI) return;
    await this.workerAPI.disconnect(namespace);
  }

  async cleanup(namespace?: string): Promise<void> {
    if (!this.workerAPI) return;
    await this.workerAPI.cleanup(namespace);
  }

  // Request pending operations count
  async getPendingOperationsCount(namespace: string): Promise<number> {
    if (!this.workerAPI) return 0;
    return await this.workerAPI.getPendingOperationsCount(namespace);
  }

  // Development utility: reset database to resolve version conflicts
  async resetDatabase(): Promise<void> {
    if (!this.workerAPI) throw new Error('Worker not available');
    await this.workerAPI.resetDatabase();
  }

  // Enqueue an operation for processing
  async enqueueOperation(namespace: string, operation: Omit<Operation, 'clientId'>): Promise<void> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    await this.workerAPI.enqueueOperation(namespace, operation);
  }

  // Trigger immediate sync for namespace
  async syncNow(namespace?: string): Promise<void> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    await this.workerAPI.syncNow(namespace);
  }

  // Subscribe to data changes for a namespace
  async subscribe(namespace: string): Promise<void> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    await this.workerAPI.subscribe(namespace);
  }

  // Get current status
  async getStatus(namespace?: string): Promise<unknown> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    return await this.workerAPI.getStatus(namespace);
  }

  // Database operations
  async getNamespaceItems(namespace: string): Promise<unknown[]> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    return await this.workerAPI.getNamespaceItems(namespace);
  }

  async getItemById(namespace: string, id: string | number): Promise<unknown> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    return await this.workerAPI.getItemById(namespace, id);
  }

  async applyOperationOptimistically(operation: Operation): Promise<void> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    await this.workerAPI.applyOperationOptimistically(operation);
  }

  async reconcileWithServer(namespace: string, serverItems: unknown[]): Promise<void> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    // Cast to any since we need to match the interface but want type safety on our side
    await this.workerAPI.reconcileWithServer(namespace, serverItems as Parameters<WorkerAPI['reconcileWithServer']>[1]);
  }

  async fetchInitialData(namespace: string): Promise<void> {
    if (!this.workerAPI) throw new Error('Worker not initialized');
    await this.workerAPI.fetchInitialData(namespace);
  }

  // Convenience methods for creating operations
  createBookmarkOperation(namespace: string, payload: {
    name: string;
    url: string;
    parentId?: number;
    isFavorite?: boolean;
  }): Operation {
    return {
      id: crypto.randomUUID(),
      clientId: this.clientId,
      namespace,
      type: OperationType.CREATE_BOOKMARK,
      payload: {
        id: generateTempId(),
        name: payload.name,
        url: payload.url,
        parentId: payload.parentId,
        isFavorite: payload.isFavorite
      },
      clientCreatedAt: Date.now(),
      status: 'pending'
    };
  }

  createFolderOperation(namespace: string, payload: {
    name: string;
    parentId?: number;
  }): Operation {
    return {
      id: crypto.randomUUID(),
      clientId: this.clientId,
      namespace,
      type: OperationType.CREATE_FOLDER,
      payload: {
        id: generateTempId(),
        name: payload.name,
        parentId: payload.parentId
      },
      clientCreatedAt: Date.now(),
      status: 'pending'
    };
  }

  updateBookmarkOperation(namespace: string, payload: {
    id: number | string;
    name?: string;
    url?: string;
    isFavorite?: boolean;
  }): Operation {
    return {
      id: crypto.randomUUID(),
      clientId: this.clientId,
      namespace,
      type: OperationType.UPDATE_BOOKMARK,
      payload,
      clientCreatedAt: Date.now(),
      status: 'pending'
    };
  }

  updateFolderOperation(namespace: string, payload: {
    id: number | string;
    name?: string;
    isOpen?: boolean;
  }): Operation {
    return {
      id: crypto.randomUUID(),
      clientId: this.clientId,
      namespace,
      type: OperationType.UPDATE_FOLDER,
      payload,
      clientCreatedAt: Date.now(),
      status: 'pending'
    };
  }

  deleteItemOperation(namespace: string, id: number | string): Operation {
    return {
      id: crypto.randomUUID(),
      clientId: this.clientId,
      namespace,
      type: OperationType.DELETE_ITEM,
      payload: { id },
      clientCreatedAt: Date.now(),
      status: 'pending'
    };
  }

  moveItemOperation(namespace: string, payload: {
    id: number | string;
    newParentId?: number;
    afterId?: number;
  }): Operation {
    return {
      id: crypto.randomUUID(),
      clientId: this.clientId,
      namespace,
      type: OperationType.MOVE_ITEM,
      payload,
      clientCreatedAt: Date.now(),
      status: 'pending'
    };
  }

  getClientId(): string {
    return this.clientId;
  }
}

// Singleton instance
export const offlineWorkerService = new OfflineWorkerService();
