/**
 * SharedWorker implementation for bookmark synchronization
 * Manages bookmark tree state and operations across multiple tabs
 */

import * as Comlink from 'comlink';
import { createPersistentTreeBuilder } from '../lib/builder/treeBuilderFactory';
import type { TreeBuilder } from '../lib/builder/treeBuilderFactory';
import type { CreateFolderOp, CreateBookmarkOp } from '../lib/builder/treeBuilder';
import type { SharedWorkerAPI, BroadcastMessage, TabConnection } from './sharedWorkerAPI';
import type { NodeId, BookmarkTreeNode as TreeNode } from '@/lib/tree';

class BookmarkSharedWorker implements SharedWorkerAPI {
  private builder: TreeBuilder;
  private connections = new Map<string, TabConnection>();
  private broadcastChannel = new BroadcastChannel('bookmarks-sync');

  constructor() {
    console.log('[SharedWorker] BookmarkSharedWorker initialized');
    // Create TreeBuilder with persistent storage
    this.builder = createPersistentTreeBuilder({ 
      rootNode: { title: 'Bookmarks', id: 'root', isOpen: true }
    });
    // Initialization happens automatically with autoLoad: true (default)
  }

  // Wait for initialization to complete
  async waitForInitialization(): Promise<void> {
    await this.builder.waitForInitialization();
  }

  // Ensure initialization is complete before operations
  private async ensureInitialized(): Promise<void> {
    await this.waitForInitialization();
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
  async createFolder(params: { parentId?: NodeId; title: string; isOpen?: boolean; id?: NodeId; index?: number }): Promise<NodeId> {
    await this.ensureInitialized();
    
    // Generate ID here if not provided to ensure we can track it
    const nodeId = params.id || this.generateId();
    
    // Create operation with explicit properties to ensure nodeId is included
    const createFolderOp: CreateFolderOp = {
      type: 'create_folder',
      id: nodeId,
      parentId: params.parentId,
      title: params.title,
      isOpen: params.isOpen,
      index: params.index
    };
    
    const operation = await this.builder.dispatch(createFolderOp);
    const node = await this.builder.bookmarkTree.requireNode(nodeId);
    
    console.log('[SharedWorker] Created folder:', params.title, 'with nodeId:', nodeId);
    
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
    
    // Create operation with explicit properties to ensure nodeId is included
    const createBookmarkOp: CreateBookmarkOp = {
      type: 'create_bookmark',
      id: nodeId,
      parentId: params.parentId,
      title: params.title,
      url: params.url,
      index: params.index
    };
    
    const operation = await this.builder.dispatch(createBookmarkOp);
    const node = await this.builder.bookmarkTree.requireNode(nodeId);
    
    console.log('[SharedWorker] Created bookmark:', params.title, 'with nodeId:', nodeId);
    
    this.broadcast({
      type: 'node_created',
      node,
      operation
    });

    return nodeId;
  }

  async removeNode(nodeId: NodeId): Promise<void> {
    await this.ensureInitialized();
    
    const operation = await this.builder.dispatch({
      type: 'remove_node',
      nodeId
    });
    
    this.broadcast({
      type: 'node_removed',
      nodeId,
      operation
    });
  }

  async moveNode(params: { nodeId: NodeId; toFolderId: NodeId; index?: number }): Promise<void> {
    await this.ensureInitialized();
    
    const node = await this.builder.bookmarkTree.getNode(params.nodeId);
    const oldParentId = node?.parentId;
    
    const operation = await this.builder.dispatch({
      type: 'move_node',
      ...params
    });
    
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
    await this.ensureInitialized();
    
    const operation = await this.builder.dispatch({
      type: 'reorder',
      ...params
    });
    
    this.broadcast({
      type: 'operation_processed',
      operation
    });
  }

  async toggleFolder(folderId: NodeId, open?: boolean): Promise<void> {
    await this.ensureInitialized();
    
    const operation = await this.builder.dispatch({
      type: 'toggle_folder',
      folderId,
      open
    });
    const node = await this.builder.bookmarkTree.requireNode(folderId);
    
    this.broadcast({
      type: 'node_updated',
      node,
      operation
    });
  }

  // Tree State
  async getTree() {
    await this.ensureInitialized();
    // Create a SerializedTree format by collecting all nodes
    try {
      const nodes: Record<NodeId, TreeNode> = {};
      
      // We need to iterate through all cached nodes
      // Since we can't access cache directly, let's build it by traversing from root
      const rootId = this.builder.bookmarkTree.rootId;
      const visited = new Set<NodeId>();
      const queue: NodeId[] = [rootId];
      
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        
        const node = await this.builder.bookmarkTree.getNode(currentId);
        if (node) {
          nodes[currentId] = node;
          
          // If it's a folder, add children to queue
          if (node.kind === 'folder') {
            const children = await this.builder.bookmarkTree.listChildren(currentId);
            for (const child of children) {
              if (!visited.has(child.id)) {
                queue.push(child.id);
              }
            }
          }
        }
      }
      
      return { rootId, nodes };
    } catch (error) {
      console.error('Failed to serialize tree:', error);
      // Fallback: return just the root
      const root = await this.builder.bookmarkTree.getRoot();
      return { rootId: this.builder.bookmarkTree.rootId, nodes: { [root.id]: root } };
    }
  }

  async getNode(nodeId: NodeId): Promise<TreeNode | null> {
    await this.ensureInitialized();
    return await this.builder.bookmarkTree.getNode(nodeId) || null;
  }

  async getChildren(folderId: NodeId) {
    await this.ensureInitialized();
    return await this.builder.bookmarkTree.listChildren(folderId);
  }

  // Operation Log
  async getOperationLog() {
    try {
      // PersistentTreeOpsBuilder handles loading, but we can access via the builder
      console.log(`[SharedWorker] Returning ${this.builder.log.length} operations from builder`);
      return [...this.builder.log];
    } catch (error) {
      console.error('[SharedWorker] Failed to get operation log:', error);
      return [];
    }
  }

  async appendOperation(operation: Parameters<SharedWorkerAPI['appendOperation']>[0]) {
    console.log('[SharedWorker] Appending operation (system/sync use only):', operation.id, operation.op);
    
    try {
      // Ensure we're initialized
      await this.ensureInitialized();
      
      // NOTE: This method should only be used for system operations (sync, replay, etc.)
      // User-initiated operations should use the specific methods (createFolder, createBookmark, etc.)
      // which ensure proper node ID generation and validation
      
      // Use the builder's applyAndPersist method - let the builder handle persistence
      await this.builder.applyAndPersist(operation);
      console.log('[SharedWorker] Operation applied and persisted by builder');
      
      // Broadcast to all tabs (including the originating tab)
      this.broadcast({
        type: 'operation_processed',
        operation
      });
      
      console.log('[SharedWorker] Operation processed and broadcasted:', operation.id);
    } catch (error) {
      console.error('[SharedWorker] Failed to append operation:', error);
      throw error;
    }
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
