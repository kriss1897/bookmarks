/**
 * SharedWorker implementation for bookmark synchronization
 * Manages bookmark tree state and operations across multiple tabs
 */

import * as Comlink from 'comlink';
import { createPersistentTreeBuilder } from '../lib/builder/treeBuilderFactory';
import type { TreeBuilder, OperationEnvelope } from '../lib/builder/treeBuilderFactory';
import type { CreateFolderOp, CreateBookmarkOp } from '../lib/builder/treeBuilder';
import type { SharedWorkerAPI, BroadcastMessage, TabConnection } from './sharedWorkerAPI';
import type { NodeId, BookmarkTreeNode as TreeNode } from '@/lib/tree';
import { SSEManager } from '../lib/sse/SSEManager';
import type { ServerEvent, SSEConnectionState } from '../types/sse';
import { convertServerEventToEnvelope, validateServerEventData } from '../lib/sseEventConverter';
import { ServerAPI } from '../lib/serverAPI';
import { ServerSyncService } from '../lib/ServerSyncService';
import { databaseService } from './database';

class BookmarkSharedWorker implements SharedWorkerAPI {
  private builder: TreeBuilder;
  private connections = new Map<string, TabConnection>();
  private broadcastChannel = new BroadcastChannel('bookmarks-sync');
  private sseBroadcastChannel = new BroadcastChannel('bookmarks-sse');
  private sseManager: SSEManager | null = null;
  private sseState: SSEConnectionState = { connected: false, connecting: false };
  private namespace = 'default'; // Use tree root ID as namespace
  private serverSyncService: ServerSyncService;
  private lastHydrationTime = 0; // Track last hydration to prevent duplicates

  // Hydration state management
  private serverBaselineTimestamp = 0; // Last known server state timestamp
  // private pendingLocalOperations: OperationEnvelope[] = []; // Operations not yet synced to server

  constructor() {
    console.log('[SharedWorker] BookmarkSharedWorker initialized');

    // Configure ServerAPI with correct settings
    ServerAPI.configure({
      baseURL: 'http://localhost:5000',
      namespace: this.namespace,
      timeout: 5000
    });

    // Create TreeBuilder with persistent storage
    // Initialization happens automatically with autoLoad: true (default)
    this.builder = createPersistentTreeBuilder({
      rootNode: { title: 'Bookmarks', id: 'root', isOpen: true }
    });

    // Initialize server sync service with callbacks
    this.serverSyncService = new ServerSyncService(databaseService, {}, {
      onStatusChange: (status) => {
        this.broadcast({
          type: 'sync_status_changed',
          isSyncing: status.isSyncing,
          pendingCount: status.pendingCount,
          failedCount: status.failedCount
        });
      },
      onOperationSynced: (operationId, success, error) => {
        // Mark operation as synced if successful
        if (success) {
          this.markOperationSynced(operationId);
        }

        this.broadcast({
          type: 'operation_sync_completed',
          operationId,
          success,
          error
        });
      }
    });
  }

  // Ensure initialization is complete before operations
  private async ensureInitialized(): Promise<void> {
    // await this.waitForInitialization();
    return;
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

    // Start/stop server sync based on connection state
    if (state.connected) {
      // console.log('[SharedWorker] SSE connected, starting server sync');
      // this.serverSyncService.startSync().catch(error => {
      //   console.error('[SharedWorker] Failed to start server sync:', error);
      // });

      // Trigger root node hydration on connection/reconnection
      this.hydrateRootNode().catch((error: Error) => {
        console.error('[SharedWorker] Failed to hydrate root node on SSE connection:', error);
      });
    } else {
      console.log('[SharedWorker] SSE disconnected, stopping server sync');
      // this.serverSyncService.stopSync();
    }

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

  // Server Sync Management
  async getSyncStatus(): Promise<{ isSyncing: boolean; pendingCount?: number; failedCount?: number }> {
    const syncStatus = this.serverSyncService.getSyncStatus();

    if (syncStatus.isSyncing) {
      // Get additional stats when syncing
      const pendingOps = await databaseService.getPendingOperations();
      const failedOps = await databaseService.getFailedOperations();

      return {
        isSyncing: true,
        pendingCount: pendingOps.length,
        failedCount: failedOps.length
      };
    }

    return { isSyncing: false };
  }

  async forceSyncOperation(operationId: string): Promise<boolean> {
    console.log(`[SharedWorker] Force syncing operation: ${operationId}`);
    return await this.serverSyncService.forceSyncOperation(operationId);
  }

  async syncOperationImmediately(operationId: string): Promise<boolean> {
    console.log(`[SharedWorker] Immediately syncing operation: ${operationId}`);
    return await this.serverSyncService.syncOperationImmediately(operationId);
  }

  // Private helper method to attempt immediate sync without throwing errors
  private trySyncOperationImmediately(operationId: string): void {
    // Only attempt sync if we have connections and SSE is connected
    if (this.connections.size === 0 || !this.sseState.connected) {
      return;
    }

    this.serverSyncService.syncOperationImmediately(operationId).catch(error => {
      console.warn(`[SharedWorker] Failed to immediately sync operation ${operationId}:`, error);
      // Don't throw - this is a best-effort sync
      // The operation will be synced later during batch sync
    });
  }

  // Cleanup method - can be called by the application when needed
  public async cleanup(): Promise<void> {
    console.log('[SharedWorker] Cleaning up SharedWorker resources');

    this.serverSyncService.destroy();
    this.disconnectSSE();

    this.broadcastChannel.close();
    this.sseBroadcastChannel.close();

    this.connections.clear();
  }

  // Namespace Management
  public async setNamespace(namespace: string): Promise<void> {
    await this.ensureInitialized();

    if (!namespace || namespace === this.namespace) {
      console.log('[SharedWorker] Namespace unchanged, skipping setNamespace');
      return;
    }

    console.log(`[SharedWorker] Switching namespace from ${this.namespace} to ${namespace}`);

    // 1) Disconnect SSE to stop incoming events for old namespace
    this.disconnectSSE();

    // 2) Clear local persisted data (nodes/oplog)
    try {
      await databaseService.clear();
    } catch (err) {
      console.warn('[SharedWorker] Failed to clear local DB during namespace switch:', err);
    }

    // 3) Update namespace and reconfigure ServerAPI
    this.namespace = namespace;
    ServerAPI.configure({ namespace: this.namespace });

    // 4) Rebuild builder state with a fresh baseline for the new namespace
    try {
      // Try to resolve the correct root for this namespace
      const initial = await ServerAPI.fetchInitialTree();
      const fallbackRootId = this.builder.bookmarkTree.rootId;
      const rootId = initial?.rootId || fallbackRootId;
      const nodeData = initial?.node ?? (await ServerAPI.fetchNodeWithChildren(rootId)).node;
      const children = initial?.children ?? (await ServerAPI.fetchNodeWithChildren(rootId)).children;

      const baselineOperation: OperationEnvelope = {
        id: this.generateId(),
        ts: Date.now(),
        op: {
          type: 'hydrate_node',
          nodeId: rootId,
          nodeData: nodeData as unknown as Record<string, unknown>,
          children: children as unknown as Record<string, unknown>[]
        },
        processed: true,
        remote: true
      };

  await this.builder.initialize([baselineOperation], true);

      // Inform clients that the tree has been reloaded
      this.broadcast({ type: 'tree_reloaded', tree: await this.getTree() });
    } catch (error) {
      console.error('[SharedWorker] Failed to rebuild baseline on namespace switch:', error);
      // Still proceed to reconnect SSE
    }

    // 5) Reconnect SSE for the new namespace if tabs are connected
    if (this.connections.size > 0) {
      await this.initializeSSE();
    }
  }

  async ping(): Promise<string> {
    return `SharedWorker active. Connected tabs: ${this.connections.size}`;
  }

  // Tree Operations
  async createFolder(params: { parentId?: NodeId; title: string; isOpen?: boolean; isLoaded?: boolean; id?: NodeId; index?: number }): Promise<NodeId> {
    await this.ensureInitialized();

    // Generate ID here if not provided to ensure we can track it
    const nodeId = params.id || this.generateId();

    // Create operation with explicit properties to ensure nodeId is included
    const createFolderOp: CreateFolderOp = {
      type: 'create_folder',
      id: nodeId,
      parentId: params.parentId,
      title: params.title,
      isOpen: params.isOpen ?? false, // New folders are closed by default
      isLoaded: params.isLoaded ?? false, // New folders need to be loaded from server
      index: params.index
    };

    const operation = await this.builder.dispatch(createFolderOp);

    console.log('[SharedWorker] Created folder:', params.title, 'with nodeId:', nodeId);

    // Broadcast operation_processed so clients can apply the operation
    this.broadcast({
      type: 'operation_processed',
      operation
    });

    // Try to sync immediately if connected
    this.trySyncOperationImmediately(operation.id);

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

    // Try to sync immediately if connected
    this.trySyncOperationImmediately(operation.id);

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

    // Try to sync immediately if connected
    this.trySyncOperationImmediately(operation.id);
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

    // Try to sync immediately if connected
    this.trySyncOperationImmediately(operation.id);
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

    // Try to sync immediately if connected
    this.trySyncOperationImmediately(operation.id);
  }

  async toggleFolder(folderId: NodeId, open?: boolean): Promise<void> {
    await this.ensureInitialized();

    // First, toggle the folder open/closed
    const operation = await this.builder.dispatch({
      type: 'toggle_folder',
      folderId,
      open
    });

    this.broadcast({
      type: 'operation_processed',
      operation
    });

    // Try to sync immediately if connected
    this.trySyncOperationImmediately(operation.id);

    // Check if the folder needs to be loaded when opening
    if (open !== false) { // If opening or toggling to open
      const folder = await this.builder.bookmarkTree.getNode(folderId);
      if (folder?.kind === 'folder' && !folder.isLoaded) {
        // Trigger async loading (don't await to prevent blocking)
        this.loadFolderData(folderId).catch(error => {
          console.error('[SharedWorker] Failed to load folder data:', error);
        });
      }
    }
  }

  async markFolderAsLoaded(folderId: NodeId): Promise<void> {
    await this.ensureInitialized();

    const operation = await this.builder.dispatch({
      type: 'mark_folder_loaded',
      folderId
    });

    this.broadcast({
      type: 'operation_processed',
      operation
    });

    // Try to sync immediately if connected
    this.trySyncOperationImmediately(operation.id);
  }

  async loadFolderData(folderId: NodeId): Promise<void> {
    await this.ensureInitialized();

    try {
      console.log(`[SharedWorker] Loading folder data for: ${folderId}`);

      // Check if folder is already loaded
      const existingFolder = await this.builder.bookmarkTree.getNode(folderId);
      if (existingFolder && existingFolder.kind === 'folder' && existingFolder.isLoaded) {
        console.log(`[SharedWorker] Folder ${folderId} is already loaded, skipping fetch`);
        return;
      }

      // Fetch data from server using the real API
      const { node: nodeData, children } = await ServerAPI.fetchNodeWithChildren(folderId);

      console.log(`[SharedWorker] Received data for folder ${folderId}:`, { nodeData, children });

      // Apply hydrate operation to update the tree
      const operation = await this.builder.dispatch({
        type: 'hydrate_node',
        nodeId: folderId,
        nodeData: nodeData as unknown as Record<string, unknown>,
        children: children as unknown as Record<string, unknown>[]
      });

      // Broadcast the hydrate_node event for immediate UI updates
      this.broadcast({
        type: 'hydrate_node',
        nodeId: folderId,
        nodeData: nodeData as TreeNode, // Cast since we know this is safe from ServerAPI
        children
      });

      // Also broadcast the operation_processed for consistency
      this.broadcast({
        type: 'operation_processed',
        operation
      });

      console.log(`[SharedWorker] Successfully loaded and hydrated folder: ${folderId}`);

    } catch (error) {
      console.error(`[SharedWorker] Failed to load folder data for ${folderId}:`, error);

      throw error;
    }
  }

  /**
   * Hydrate the root node with safe baseline + delta approach
   * This creates a clean server baseline without destroying the tree structure
   */
  private async hydrateRootNode(): Promise<void> {
    await this.ensureInitialized();

    console.log('Called hydrate root node');

    // Prevent duplicate hydration within 1 second
    const now = Date.now();
    if (now - this.lastHydrationTime < 1000) {
      console.log(`[SharedWorker] Skipping hydration, too recent (${now - this.lastHydrationTime}ms ago)`);
      return;
    }
    this.lastHydrationTime = now;

    try {
      const rootId = this.builder.bookmarkTree.rootId;
      console.log(`[SharedWorker] Starting safe baseline+delta hydration for root: ${rootId}`);

      // Step 2: Fetch server state to establish new baseline
      const { node: nodeData, children } = await ServerAPI.fetchNodeWithChildren(rootId);

      console.log(`[SharedWorker] Fetched server baseline with ${children.length} total nodes`);

      // Step 3: Clear the operation log and rebuild from server baseline + pending operations
      await this.rebuildTreeFromBaseline(rootId, nodeData, children);

      // Step 4: Broadcast the completed hydration
      this.broadcast({
        type: 'hydrate_node',
        nodeId: rootId,
        nodeData: nodeData as TreeNode,
        children
      });

      this.broadcast({
        type: 'root_hydrated',
        nodeId: rootId,
        timestamp: Date.now()
      });

      console.log(`[SharedWorker] Successfully completed safe baseline+delta hydration for: ${rootId}`);

    } catch (error) {
      console.error(`[SharedWorker] Failed to hydrate root node:`, error);

      this.broadcast({
        type: 'root_hydration_failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });

      throw error;
    }
  }

  /**
   * Rebuild tree by creating new operation log with server baseline + pending operations
   * This preserves operation ordering without destroying tree structure
   */
  private async rebuildTreeFromBaseline(
    rootId: NodeId,
    rootNodeData: Partial<TreeNode>,
    allNodes: TreeNode[]
  ): Promise<void> {
    console.log(`[SharedWorker] Rebuilding tree from server baseline + pending operations`);

    // Step 1: Create a baseline hydration operation (but don't apply it yet)
    const baselineTimestamp = Date.now();
    const baselineOperation: OperationEnvelope = {
      id: this.generateId(),
      ts: baselineTimestamp,
      op: {
        type: 'hydrate_node',
        nodeId: rootId,
        nodeData: rootNodeData as Record<string, unknown>,
        children: allNodes as unknown as Record<string, unknown>[]
      },
      processed: true, // Mark as processed since it represents server state
      remote: true
    };

    await this.builder.initialize([baselineOperation], true);

    return;
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
        if (!node) continue;

        if (node.kind === 'folder') {
          // Get children in sorted order and update the folder's children array for serialization
          const children = await this.builder.bookmarkTree.listChildren(currentId);
          const serializedFolder = {
            ...node,
            children: children.map((c) => c.id)
          } as TreeNode; // preserves FolderNode shape with updated children

          nodes[currentId] = serializedFolder;

          // Enqueue children for traversal
          for (const child of children) {
            if (!visited.has(child.id)) {
              queue.push(child.id);
            }
          }
        } else {
          nodes[currentId] = node;
        }
      }

      console.log(rootId, nodes);

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

  /**
   * Mark an operation as successfully synced to server
   * This helps track which operations are pending during hydration
   */
  private markOperationSynced(operationId: string): void {
    const operation = this.builder.log.find(op => op.id === operationId);
    if (operation) {
      operation.processed = true;
      console.log(`[SharedWorker] Marked operation ${operationId} as synced`);

      // Update server baseline timestamp to latest synced operation
      this.serverBaselineTimestamp = Math.max(this.serverBaselineTimestamp, operation.ts);
    }
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
