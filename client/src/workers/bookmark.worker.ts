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
import { SSEManager } from '../lib/sse/SSEManager';
import type { ServerEvent, SSEConnectionState } from '../types/sse';
import { convertServerEventToEnvelope, validateServerEventData } from '../lib/sseEventConverter';

class BookmarkSharedWorker implements SharedWorkerAPI {
  private builder: TreeBuilder;
  private connections = new Map<string, TabConnection>();
  private broadcastChannel = new BroadcastChannel('bookmarks-sync');
  private sseBroadcastChannel = new BroadcastChannel('bookmarks-sse');
  private sseManager: SSEManager | null = null;
  private sseState: SSEConnectionState = { connected: false, connecting: false };
  private namespace = 'root'; // Use tree root ID as namespace

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
    
    // Initialize SSE connection when first tab connects
    if (this.connections.size === 1 && !this.sseManager) {
      await this.initializeSSE();
    }
  }

  async disconnect(tabId: string): Promise<void> {
    this.connections.delete(tabId);
    console.log(`[SharedWorker] Tab ${tabId} disconnected. Active connections: ${this.connections.size}`);
    
    // Disconnect SSE when last tab disconnects
    if (this.connections.size === 0 && this.sseManager) {
      this.disconnectSSE();
    }
  }

  // SSE Management
  private async initializeSSE(): Promise<void> {
    if (this.sseManager) {
      console.log('[SharedWorker] SSE already initialized');
      return;
    }

    console.log('[SharedWorker] Initializing SSE connection');
    
    this.sseManager = new SSEManager(
      '/api/events',
      this.namespace,
      this.handleServerEvent.bind(this),
      this.handleSSEStateChange.bind(this)
    );

    this.sseManager.connect();
  }

  private disconnectSSE(): void {
    if (this.sseManager) {
      console.log('[SharedWorker] Disconnecting SSE');
      this.sseManager.disconnect();
      this.sseManager = null;
    }
  }

  private handleServerEvent(event: ServerEvent): void {
    console.log('[SharedWorker] Received SSE event:', event);
    
    // Broadcast server event to all connected tabs via SSE channel
    this.broadcastSSE({
      type: 'server_event',
      event
    });

    // Handle specific server events
    switch (event.type) {
      case 'bookmark_created':
      case 'folder_created':
      case 'bookmark_updated':
      case 'folder_updated':
      case 'bookmark_deleted':
      case 'folder_deleted':
      case 'item_moved':
      case 'folder_toggled':
        this.handleServerDataEvent(event);
        break;
      default:
        console.log(`[SharedWorker] Unhandled server event type: ${event.type}`);
    }
  }

  private async handleServerDataEvent(event: ServerEvent): Promise<void> {
    console.log('[SharedWorker] Handling server data event:', event.type);
    
    // Validate event data before processing
    if (!validateServerEventData(event)) {
      console.error('[SharedWorker] Invalid server event data:', event);
      return;
    }

    try {
      // Convert server event to operation envelope
      const envelope = convertServerEventToEnvelope(event);
      if (!envelope) {
        console.warn('[SharedWorker] Could not convert server event to operation:', event.type);
        return;
      }

      console.log('[SharedWorker] Applying remote operation:', envelope);
      
      // Apply the operation to the TreeBuilder
      // Note: record=true ensures the remote operation is persisted locally
      await this.builder.apply(envelope, { record: true });
      
      console.log('[SharedWorker] Remote operation applied successfully');

      // Broadcast the applied operation to all tabs via regular channel
      // This allows tabs to update their UI to reflect the server change
      this.broadcast({
        type: 'operation_processed',
        operation: envelope
      });

      // Also broadcast via SSE channel for any SSE-specific handling
      this.broadcastSSE({
        type: 'server_data_update',
        operation: {
          type: event.type,
          data: event.data,
          timestamp: event.timestamp,
          envelope // Include the full envelope for debugging
        }
      });

    } catch (error) {
      console.error('[SharedWorker] Failed to apply remote operation:', error, event);
      
      // Broadcast error so tabs can handle it appropriately
      this.broadcastSSE({
        type: 'server_event_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        event
      });
    }
  }

  private handleSSEStateChange(state: SSEConnectionState): void {
    this.sseState = state;
    console.log('[SharedWorker] SSE state changed:', state);
    
    // Broadcast SSE state to all connected tabs via SSE channel
    this.broadcastSSE({
      type: 'sse_state_changed',
      state
    });
  }

  // Get SSE connection state
  async getSSEState(): Promise<SSEConnectionState> {
    return { ...this.sseState };
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
    
    console.log('[SharedWorker] Created folder:', params.title, 'with nodeId:', nodeId);
    
    // Broadcast operation_processed so clients can apply the operation
    this.broadcast({
      type: 'operation_processed',
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
    
    console.log('[SharedWorker] Created bookmark:', params.title, 'with nodeId:', nodeId);
    
    // Broadcast operation_processed so clients can apply the operation
    this.broadcast({
      type: 'operation_processed',
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
      type: 'operation_processed',
      operation
    });
  }

  async moveNode(params: { nodeId: NodeId; toFolderId: NodeId; index?: number }): Promise<void> {
    await this.ensureInitialized();
    
    const operation = await this.builder.dispatch({
      type: 'move_node',
      ...params
    });
    
    this.broadcast({
      type: 'operation_processed',
      operation
    });
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
    
    this.broadcast({
      type: 'operation_processed',
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
      console.log('[SharedWorker] Broadcasting message:', message.type, message);
      this.broadcastChannel.postMessage(message);
      console.log('[SharedWorker] Message broadcast successfully');
    } catch (error) {
      console.error('[SharedWorker] Failed to broadcast message:', error);
    }
  }

  private broadcastSSE(message: BroadcastMessage): void {
    try {
      console.log('[SharedWorker] Broadcasting SSE message:', message.type, message);
      this.sseBroadcastChannel.postMessage(message);
      console.log('[SharedWorker] SSE message broadcast successfully');
    } catch (error) {
      console.error('[SharedWorker] Failed to broadcast SSE message:', error);
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
