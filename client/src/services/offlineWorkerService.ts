import type { 
  Operation, 
  WorkerMessage, 
  EnqueueOperationMessage,
  SyncNowMessage,
  SubscribeMessage,
  GetStatusMessage
} from '../types/operations';
import { 
  generateClientId,
  generateTempId,
  OperationType
} from '../types/operations';

export class OfflineWorkerService {
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private messageHandlers = new Map<string, (data: unknown) => void>();
  private clientId: string;
  private eventListeners: Map<string, Set<(event: MessageEvent) => void>> = new Map();

  constructor() {
    this.clientId = generateClientId();
    this.initializeWorker();
  }

  private initializeWorker() {
    try {
      this.worker = new SharedWorker('/sse-shared-worker.js', 'sse-worker');
      this.port = this.worker.port;
      
      this.port.onmessage = (event: MessageEvent<WorkerMessage>) => {
        this.handleWorkerMessage(event.data);
        // Also dispatch as generic event for OfflineIndicator
        this.dispatchEvent('message', event);
      };
      
      this.port.start();
      console.log('OfflineWorkerService initialized');
    } catch (error) {
      console.error('Failed to initialize SharedWorker:', error);
      // Fallback to local operation queue could be implemented here
    }
  }

  // Event handling for OfflineIndicator
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(type);
      }
    }
  }

  private dispatchEvent(type: string, event: MessageEvent): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => listener(event));
    }
  }

  // Request pending operations count
  async getPendingOperationsCount(namespace: string): Promise<void> {
    if (!this.port) return;
    
    this.port.postMessage({
      type: 'GET_PENDING_OPERATIONS_COUNT',
      namespace
    });
  }

  // Development utility: reset database to resolve version conflicts
  async resetDatabase(): Promise<void> {
    if (!this.port) return;
    
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error('Worker not available'));
        return;
      }

      const handleResponse = (event: MessageEvent) => {
        const message = event.data;
        if (message.type === 'DATABASE_RESET_SUCCESS') {
          this.port!.removeEventListener('message', handleResponse);
          resolve();
        } else if (message.type === 'DATABASE_RESET_ERROR') {
          this.port!.removeEventListener('message', handleResponse);
          reject(new Error(message.error));
        }
      };

      this.port.addEventListener('message', handleResponse);
      
      this.port.postMessage({
        type: 'RESET_DATABASE'
      });
    });
  }

  private handleWorkerMessage(message: WorkerMessage) {
    const handler = this.messageHandlers.get(message.type);
    if (handler && message.data) {
      handler(message.data);
    } else {
      console.log('Unhandled worker message:', message);
    }
  }

  // Subscribe to worker events
  onDataChanged(handler: (data: { namespace: string }) => void) {
    this.messageHandlers.set('dataChanged', handler as (data: unknown) => void);
  }

  onPendingCount(handler: (data: { namespace: string; count: number }) => void) {
    this.messageHandlers.set('pendingCount', handler as (data: unknown) => void);
  }

  onSyncStatus(handler: (data: { namespace: string; status: string; error?: string }) => void) {
    this.messageHandlers.set('syncStatus', handler as (data: unknown) => void);
  }

  onConnectivityChanged(handler: (data: { isOnline: boolean }) => void) {
    this.messageHandlers.set('connectivityChanged', handler as (data: unknown) => void);
  }

  onError(handler: (data: { reason: string; operationId?: string }) => void) {
    this.messageHandlers.set('error', handler as (data: unknown) => void);
  }

  // Enqueue an operation for processing
  async enqueueOperation(namespace: string, operation: Omit<Operation, 'clientId'>): Promise<void> {
    if (!this.port) {
      throw new Error('Worker not initialized');
    }

    const fullOperation: Operation = {
      ...operation,
      clientId: this.clientId
    };

    const message: EnqueueOperationMessage = {
      type: 'enqueueOperation',
      data: {
        namespace,
        operation: fullOperation
      }
    };

    this.port.postMessage(message);
  }

  // Trigger immediate sync for namespace
  async syncNow(namespace?: string): Promise<void> {
    if (!this.port) {
      throw new Error('Worker not initialized');
    }

    const message: SyncNowMessage = {
      type: 'syncNow',
      data: { namespace }
    };

    this.port.postMessage(message);
  }

  // Subscribe to data changes for a namespace
  async subscribe(namespace: string): Promise<void> {
    if (!this.port) {
      throw new Error('Worker not initialized');
    }

    const message: SubscribeMessage = {
      type: 'subscribe',
      data: { namespace }
    };

    this.port.postMessage(message);
  }

  // Get current status
  async getStatus(namespace?: string): Promise<void> {
    if (!this.port) {
      throw new Error('Worker not initialized');
    }

    const message: GetStatusMessage = {
      type: 'getStatus',
      data: { namespace }
    };

    this.port.postMessage(message);
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
