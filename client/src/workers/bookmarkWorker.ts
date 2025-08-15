/**
 * SharedWorker implementation for bookmark synchronization
 * Manages bookmark tree state and operations across multiple tabs
 */

import * as Comlink from 'comlink';
import { TreeOpsBuilder } from '../lib/treeOps';
import { databaseService } from './database';
import type { SharedWorkerAPI, BroadcastMessage, TabConnection } from './sharedWorkerAPI';
import type { NodeId, TreeNode } from '../lib/bookmarksTree';

class BookmarkSharedWorker implements SharedWorkerAPI {
  private builder = new TreeOpsBuilder();
  private connections = new Map<string, TabConnection>();
  private broadcastChannel = new BroadcastChannel('bookmarks-sync');
  private isInitialized = false;

  constructor() {
    console.log('[SharedWorker] BookmarkSharedWorker initialized');
    this.initializeFromDatabase();
  }

  // Initialize tree from persisted data
  private async initializeFromDatabase(): Promise<void> {
    try {
      console.log('[SharedWorker] Loading tree from database...');
      
      // Load stored operations and replay them to reconstruct tree
      const storedOperations = await databaseService.loadOperationLog();
      console.log(`[SharedWorker] Loaded ${storedOperations.length} operations from database`);
      
      if (storedOperations.length > 0) {
        // Convert stored operations back to OperationEnvelope format
        const operationEnvelopes = storedOperations.map(stored => ({
          id: stored.id,
          ts: stored.ts,
          op: stored.op
        }));
        
        // Create builder and replay operations
        this.builder = new TreeOpsBuilder();
        this.builder.replay(operationEnvelopes, { record: true });
        console.log('[SharedWorker] Tree reconstructed from operation log');
      } else {
        console.log('[SharedWorker] No stored operations, starting with empty tree');
        this.builder = new TreeOpsBuilder();
      }
      
      this.isInitialized = true;
    } catch (error) {
      console.error('[SharedWorker] Failed to initialize from database:', error);
      this.builder = new TreeOpsBuilder(); // Fallback to empty tree
      this.isInitialized = true;
    }
  }

  // Wait for initialization to complete
  private async ensureInitialized(): Promise<void> {
    while (!this.isInitialized) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  // Connection Management
  async connect(tabId: string): Promise<void> {
    const now = Date.now();
    this.connections.set(tabId, {
      id: tabId,
      connectedAt: now,
      lastPing: now
    });
    console.log(`[SharedWorker] Tab ${tabId} connected. Active connections: ${this.connections.size}`);
  }

  async disconnect(tabId: string): Promise<void> {
    this.connections.delete(tabId);
    console.log(`[SharedWorker] Tab ${tabId} disconnected. Active connections: ${this.connections.size}`);
  }

  async ping(): Promise<string> {
    return `SharedWorker active. Connected tabs: ${this.connections.size}`;
  }

  // Tree Operations
  async createFolder(params: { parentId?: NodeId; title: string; id?: NodeId; isOpen?: boolean; index?: number }): Promise<NodeId> {
    await this.ensureInitialized();
    
    // Generate ID here if not provided to ensure we can track it
    const nodeId = params.id || this.generateId();
    const operation = this.builder.createFolder({ ...params, id: nodeId });
    const node = this.builder.tree.requireNode(nodeId);
    
    // Persist operation to database
    try {
      await databaseService.appendOperation(operation);
      console.log('[SharedWorker] Operation persisted:', operation.op.type);
    } catch (error) {
      console.error('[SharedWorker] Failed to persist operation:', error);
    }
    
    this.broadcast({
      type: 'node_created',
      node,
      operation
    });

    return nodeId;
  }

  async createBookmark(params: { parentId?: NodeId; title: string; url: string; id?: NodeId; index?: number }): Promise<NodeId> {
    await this.ensureInitialized();
    
    // Generate ID here if not provided to ensure we can track it
    const nodeId = params.id || this.generateId();
    const operation = this.builder.createBookmark({ ...params, id: nodeId });
    const node = this.builder.tree.requireNode(nodeId);
    
    // Persist operation to database
    try {
      await databaseService.appendOperation(operation);
      console.log('[SharedWorker] Operation persisted:', operation.op.type);
    } catch (error) {
      console.error('[SharedWorker] Failed to persist operation:', error);
    }
    
    this.broadcast({
      type: 'node_created',
      node,
      operation
    });

    return nodeId;
  }

  async removeNode(nodeId: NodeId): Promise<void> {
    const operation = this.builder.removeNode({ nodeId });
    
    this.broadcast({
      type: 'node_removed',
      nodeId,
      operation
    });
  }

  async moveNode(params: { nodeId: NodeId; toFolderId: NodeId; index?: number }): Promise<void> {
    const node = this.builder.tree.getNode(params.nodeId);
    const oldParentId = node?.parentId;
    
    const operation = this.builder.moveNode(params);
    
    if (oldParentId) {
      this.broadcast({
        type: 'node_moved',
        nodeId: params.nodeId,
        oldParentId,
        newParentId: params.toFolderId,
        operation
      });
    }
  }

  async reorderNodes(params: { folderId: NodeId; fromIndex: number; toIndex: number }): Promise<void> {
    const operation = this.builder.reorder(params);
    
    this.broadcast({
      type: 'operation_processed',
      operation
    });
  }

  async toggleFolder(folderId: NodeId, open?: boolean): Promise<void> {
    const operation = this.builder.toggleFolder({ folderId, open });
    const node = this.builder.tree.requireNode(folderId);
    
    this.broadcast({
      type: 'node_updated',
      node,
      operation
    });
  }

  // Tree State
  async getTree() {
    await this.ensureInitialized();
    return this.builder.tree.serialize();
  }

  async getNode(nodeId: NodeId): Promise<TreeNode | null> {
    return this.builder.tree.getNode(nodeId) || null;
  }

  async getChildren(folderId: NodeId) {
    return this.builder.tree.listChildren(folderId);
  }

  // Operation Log
  async getOperationLog() {
    return [...this.builder.log];
  }

  async appendOperation(operation: Parameters<SharedWorkerAPI['appendOperation']>[0]) {
    this.builder.apply(operation);
    
    this.broadcast({
      type: 'operation_processed',
      operation
    });
  }

  // Private Methods
  private broadcast(message: BroadcastMessage): void {
    try {
      this.broadcastChannel.postMessage(message);
    } catch (error) {
      console.error('[SharedWorker] Failed to broadcast message:', error);
    }
  }

  private generateId(): string {
    // Try native crypto.randomUUID if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis as any;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
    return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  // Cleanup inactive connections (call periodically)
  public cleanupConnections(): void {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    
    for (const [tabId, connection] of this.connections.entries()) {
      if (now - connection.lastPing > timeout) {
        this.connections.delete(tabId);
        console.log(`[SharedWorker] Cleaned up inactive connection: ${tabId}`);
      }
    }
  }
}

// Create the worker instance
const worker = new BookmarkSharedWorker();

// Handle SharedWorker connections
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;

self.addEventListener('connect', (event: { ports: MessagePort[] }) => {
  const port = event.ports[0];
  console.log('[SharedWorker] New port connection established');
  
  // Expose the API through Comlink
  Comlink.expose(worker, port);
  
  port.start();
});

// Periodic cleanup of inactive connections  
setInterval(() => {
  worker.cleanupConnections();
}, 60 * 1000); // Check every minute

export type { BookmarkSharedWorker };
