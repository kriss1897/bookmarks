/**
 * SharedWorker API interface for bookmark synchronization
 * This defines the contract between the main thread and the SharedWorker
 */

import type { OperationEnvelope } from "@/lib/builder/treeBuilder";
import type {
  BookmarkTreeNode as TreeNode,
  NodeId,
  SerializedTree,
} from "@/lib/tree";
import type { ServerEvent, SSEConnectionState } from "../types/sse";

// API Interface that the SharedWorker exposes to tabs
export interface SharedWorkerAPI {
  // Tree Operations
  createFolder(params: {
    parentId?: NodeId;
    title: string;
    id?: NodeId;
    isOpen?: boolean;
    isLoaded?: boolean;
    index?: number;
  }): Promise<NodeId>;
  createBookmark(params: {
    parentId?: NodeId;
    title: string;
    url: string;
    id?: NodeId;
    index?: number;
  }): Promise<NodeId>;
  removeNode(nodeId: NodeId): Promise<void>;
  updateNode(params: {
    nodeId: NodeId;
    parentId?: NodeId | null;
    orderKey?: string;
  }): Promise<void>;
  toggleFolder(folderId: NodeId, open?: boolean): Promise<void>;
  loadFolderData(folderId: NodeId): Promise<void>;

  // Edge case methods (for error recovery, cache invalidation, etc.)
  markFolderAsLoaded(folderId: NodeId): Promise<void>;

  // Tree State
  getTree(): Promise<SerializedTree>;
  getNode(nodeId: NodeId): Promise<TreeNode | null>;
  getChildren(folderId: NodeId): Promise<TreeNode[]>;

  // Operation Log
  getOperationLog(): Promise<OperationEnvelope[]>;
  appendOperation(operation: OperationEnvelope): Promise<void>;

  // Connection Management
  connect(tabId: string): Promise<void>;
  disconnect(tabId: string): Promise<void>;
  ping(): Promise<string>;

  // SSE Management
  getSSEState(): Promise<SSEConnectionState>;

  // Server Sync Management
  getSyncStatus(): Promise<{
    isSyncing: boolean;
    pendingCount?: number;
    failedCount?: number;
  }>;
  forceSyncOperation(operationId: string): Promise<boolean>;
  syncOperationImmediately(operationId: string): Promise<boolean>;

  // Worker Management
  cleanup(): Promise<void>;
}

// Message types for broadcast communication between tabs
export type BroadcastMessage =
  | { type: "node_created"; node: TreeNode; operation: OperationEnvelope }
  | { type: "node_updated"; node: TreeNode; operation: OperationEnvelope }
  | { type: "node_removed"; nodeId: NodeId; operation: OperationEnvelope }
  | {
      type: "node_moved";
      nodeId: NodeId;
      oldParentId: NodeId;
      newParentId: NodeId;
      operation: OperationEnvelope;
    }
  | { type: "tree_reloaded"; tree: SerializedTree }
  | { type: "operation_processed"; operation: OperationEnvelope }
  | { type: "server_event"; event: ServerEvent }
  | {
      type: "server_data_update";
      operation: {
        type: string;
        data: unknown;
        timestamp?: string;
        envelope?: OperationEnvelope;
      };
    }
  | { type: "server_event_error"; error: string; event: ServerEvent }
  | { type: "sse_state_changed"; state: SSEConnectionState }
  | {
      type: "hydrate_node";
      nodeId: NodeId;
      nodeData: TreeNode;
      children: TreeNode[];
    }
  | { type: "root_hydrated"; nodeId: NodeId; timestamp: number }
  | { type: "root_hydration_failed"; error: string; timestamp: number }
  | {
      type: "sync_status_changed";
      isSyncing: boolean;
      pendingCount?: number;
      failedCount?: number;
    }
  | {
      type: "operation_sync_completed";
      operationId: string;
      success: boolean;
      error?: string;
    };

// Connection info for tab management
export interface TabConnection {
  id: string;
  connectedAt: number;
  lastPing: number;
}
