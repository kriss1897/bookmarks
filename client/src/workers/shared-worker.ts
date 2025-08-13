import * as Comlink from 'comlink';
import type { Operation } from '../types/operations';
import type { WorkerAPI, WorkerEventType, WorkerStatus, StoredBookmark, StoredFolder, ServerItem } from './worker-types';

import { DatabaseManager } from './database-manager';
import { ConnectionManager } from './connection-manager';
import { EventManager } from './event-manager';
import { SyncManager } from './sync-manager';
import { OperationProcessor } from './operation-processor';

class SSESharedWorkerImpl implements WorkerAPI {
  private databaseManager: DatabaseManager;
  private connectionManager: ConnectionManager;
  private eventManager: EventManager;
  private syncManager: SyncManager;
  private operationProcessor: OperationProcessor;
  private clientId: string;

  constructor() {
    this.clientId = this.generateClientId();
    
    // Initialize managers
    this.databaseManager = new DatabaseManager();
    this.connectionManager = new ConnectionManager(this.emit.bind(this));
    this.eventManager = new EventManager(this.databaseManager);
    this.syncManager = new SyncManager(
      this.clientId,
      () => this.connectionManager.onlineStatus,
      this.emit.bind(this),
      this.databaseManager
    );
    this.operationProcessor = new OperationProcessor(
      this.clientId,
      this.emit.bind(this),
      this.databaseManager
    );

    this.initialize();
    console.log('SSE Shared Worker (Comlink) initialized with offline-first capabilities');
  }

  private async initialize(): Promise<void> {
    await this.databaseManager.initialize();
    await this.syncManager.resumePendingSyncs();
  }

  private emit(event: WorkerEventType, data: unknown): void {
    this.eventManager.emit(event, data);
  }

  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Event handling for clients
  async addEventListener(event: WorkerEventType, handler: (data: unknown) => void): Promise<void> {
    return this.eventManager.addEventListener(event, handler);
  }

  async removeEventListener(event: WorkerEventType, handler: (data: unknown) => void): Promise<void> {
    return this.eventManager.removeEventListener(event, handler);
  }

  // Connection management
  async connect(namespace: string): Promise<void> {
    // Set up event handling for server state updates
    const originalEmit = this.emit.bind(this);
    this.emit = (event: WorkerEventType, data: unknown) => {
      if (event === 'event' && data && typeof data === 'object') {
        const eventData = data as { namespace: string; data: { type?: string } & Record<string, unknown> };
        if (eventData.namespace && eventData.data?.type) {
          this.eventManager.handleServerStateUpdate(
            eventData.namespace, 
            eventData.data.type, 
            eventData.data
          );
        }
      }
      originalEmit(event, data);
    };

    return this.connectionManager.connect(namespace);
  }

  async disconnect(namespace: string): Promise<void> {
    return this.connectionManager.disconnect(namespace);
  }

  async cleanup(namespace?: string): Promise<void> {
    return this.connectionManager.cleanup(namespace);
  }

  // Operation queue management
  async enqueueOperation(namespace: string, operation: Omit<Operation, 'clientId'>): Promise<void> {
    await this.operationProcessor.enqueueOperation(namespace, operation);
    this.syncManager.scheduleBatchSync(namespace);
  }

  async syncNow(namespace?: string): Promise<void> {
    return this.syncManager.syncNow(namespace);
  }

  async subscribe(namespace: string): Promise<void> {
    const pendingCount = await this.databaseManager.getPendingOperationsCount(namespace);
    this.emit('pendingCount', { namespace, count: pendingCount });
  }

  async getStatus(namespace?: string): Promise<WorkerStatus> {
    if (namespace) {
      const pendingCount = await this.databaseManager.getPendingOperationsCount(namespace);
      const syncStatus = this.syncManager.getSyncStatus(namespace);
      
      return {
        namespace,
        isOnline: this.connectionManager.onlineStatus,
        pendingCount,
        syncStatus
      };
    } else {
      return {
        isOnline: this.connectionManager.onlineStatus,
        clientId: this.clientId
      };
    }
  }

  // Database operations
  async getNamespaceItems(namespace: string): Promise<(StoredBookmark | StoredFolder)[]> {
    return this.databaseManager.getNamespaceItems(namespace);
  }

  async applyOperationOptimistically(operation: Operation): Promise<void> {
    return this.operationProcessor.applyOperationOptimistically(operation);
  }

  async getItemById(namespace: string, id: string | number): Promise<ServerItem | null> {
    return this.databaseManager.getItemById(namespace, id);
  }

  async reconcileWithServer(namespace: string, serverItems: ServerItem[]): Promise<void> {
    return this.databaseManager.reconcileWithServer(namespace, serverItems);
  }

  async fetchInitialData(namespace: string): Promise<void> {
    return this.operationProcessor.fetchInitialData(namespace, this.connectionManager.onlineStatus);
  }

  // Utility operations
  async getPendingOperationsCount(namespace: string): Promise<number> {
    return this.databaseManager.getPendingOperationsCount(namespace);
  }

  async resetDatabase(): Promise<void> {
    return this.databaseManager.resetDatabase();
  }
}

// SharedWorker connection handler
interface SharedWorkerEvent extends MessageEvent {
  ports: MessagePort[];
}

// Singleton worker instance shared across all tabs
let sharedWorkerInstance: SSESharedWorkerImpl | null = null;

function getSharedWorkerInstance(): SSESharedWorkerImpl {
  if (!sharedWorkerInstance) {
    sharedWorkerInstance = new SSESharedWorkerImpl();
    console.log('Created new shared SSE worker instance');
  }
  return sharedWorkerInstance;
}

self.addEventListener('connect', (event: Event) => {
  const connectEvent = event as SharedWorkerEvent;
  const port = connectEvent.ports[0];
  
  // Get the singleton worker instance
  const worker = getSharedWorkerInstance();
  
  // Expose the worker API via Comlink on this port
  Comlink.expose(worker, port);
  
  console.log('New SharedWorker connection established with Comlink - reusing existing instance');
});
