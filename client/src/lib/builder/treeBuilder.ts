/**
 * Unified TreeBuilder class that combines the functionality of TreeOpsBuilder and PersistentTreeOpsBuilder.
 * Uses an abstract storage interface to support both in-memory and persistent storage.
 */

import { BookmarkTree, createMemoryBookmarkTree, type NodeId } from "../tree";
import type { OperationStorage } from "./storage";
import { MemoryOperationStorage } from "./storage";

// Operation type definitions (re-exported from original treeOps.ts)
export type CreateFolderOp = {
  type: "create_folder";
  id?: NodeId; // allow client-supplied id for determinism
  parentId?: NodeId; // defaults to root
  title: string;
  isOpen?: boolean;
  index?: number; // insertion index among siblings
};

export type CreateBookmarkOp = {
  type: "create_bookmark";
  id?: NodeId;
  parentId?: NodeId;
  title: string;
  url: string;
  index?: number;
};

export type MoveNodeOp = {
  type: "move_node" | "move_item_to_folder"; // alias supported
  nodeId: NodeId;
  toFolderId: NodeId;
  index?: number; // target insertion index
};

export type ReorderOp = {
  type: "reorder";
  folderId: NodeId;
  fromIndex: number;
  toIndex: number;
};

export type OpenFolderOp = { type: "open_folder"; folderId: NodeId };
export type CloseFolderOp = { type: "close_folder"; folderId: NodeId };
export type ToggleFolderOp = { type: "toggle_folder"; folderId: NodeId; open?: boolean };
export type RemoveNodeOp = { type: "remove_node"; nodeId: NodeId };

export type TreeOperation =
  | CreateFolderOp
  | CreateBookmarkOp
  | MoveNodeOp
  | ReorderOp
  | OpenFolderOp
  | CloseFolderOp
  | ToggleFolderOp
  | RemoveNodeOp;

// Envelope adds metadata useful for persistence/sync
export interface OperationEnvelope {
  id: string; // op id (uuid)
  ts: number; // epoch ms
  op: TreeOperation;
  remote?: boolean; // indicates this operation came from server/remote source
  processed?: boolean; // indicates this operation was already processed by server
}

export interface TreeBuilderConfig {
  /** Existing tree data to initialize from */
  tree?: Record<string, unknown>; // Legacy tree data for migration
  /** Existing operation log to replay */
  log?: OperationEnvelope[];
  /** Root node configuration */
  rootNode?: { id?: string; title?: string; isOpen?: boolean };
  /** Storage implementation to use. Defaults to in-memory storage */
  storage?: OperationStorage;
  /** Whether to auto-load from storage on initialization. Defaults to true */
  autoLoad?: boolean;
}

/**
 * TreeBuilder applies operations to a BookmarkTree and records them in a log.
 * It can replay existing logs to rebuild trees and supports pluggable storage backends.
 */
export class TreeBuilder {
  readonly bookmarkTree: BookmarkTree;
  readonly log: OperationEnvelope[] = [];
  private readonly storage: OperationStorage;
  private isInitialized = false;
  private rootNodeConfig: { id?: string; title?: string; isOpen?: boolean };
  private treeInitialized = false;

  constructor(config: TreeBuilderConfig = {}) {
    // Initialize storage
    this.storage = config.storage || new MemoryOperationStorage();
    
    // Store root node configuration for later use
    this.rootNodeConfig = config.rootNode || { title: 'Bookmarks', id: 'root', isOpen: true };
    
    // When auto-loading, don't create root node in constructor - handle it in initialize
    const shouldAutoLoad = config.autoLoad !== false;

    // Create the new BookmarkTree instance
    this.bookmarkTree = createMemoryBookmarkTree({
      rootTitle: this.rootNodeConfig.title,
      enableEvents: false
    });

    console.log('>> Bookmark Tree', this.bookmarkTree)

    // Handle legacy tree data migration if provided
    if (config.tree && !shouldAutoLoad) {
      console.log('[TreeBuilder] Legacy tree data provided, will initialize after setup');
      // We'll handle this in initializeTree method
    }

    // Replay existing log if provided (only for non-auto-load scenarios)
    if (config.log?.length && !shouldAutoLoad) {
      console.log('[TreeBuilder] Replaying provided log with', config.log.length, 'operations');
      // Handle async replay after tree initialization
      this.initializeTree().then(() => {
        this.replay(config.log!, { record: false });
      });
    }

    // Auto-load from storage if requested (default: true)
    if (shouldAutoLoad) {
      console.log('[TreeBuilder] Auto-loading from storage');
      this.initialize();
    } else {
      // Initialize tree immediately for non-auto-load scenarios
      this.initializeTree();
    }
  }

  /**
   * Initialize the BookmarkTree with root node
   */
  private async initializeTree(): Promise<void> {
    if (this.treeInitialized) return;
    
    try {
      await this.bookmarkTree.initializeBookmarkTree({
        rootTitle: this.rootNodeConfig.title || 'Bookmarks',
        rootId: this.rootNodeConfig.id || 'root'
      });
      
      this.treeInitialized = true;
      
      if (!this.isInitialized) {
        this.isInitialized = true;
      }
      
      console.log('[TreeBuilder] Tree initialized with root:', this.bookmarkTree.rootId);
    } catch (error) {
      console.error('[TreeBuilder] Failed to initialize tree:', error);
      throw error;
    }
  }

  /**
   * Initialize tree from persisted operations in storage
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('TreeBuilder is already initialized');
    }

    try {
      console.log('[TreeBuilder] Initializing from storage...');
      
      // First initialize the tree
      await this.initializeTree();
      
      // Wait for storage to be ready
      const isReady = await this.storage.isReady();
      if (!isReady) {
        throw new Error('Storage is not ready');
      }
      
      const storedOperations = await this.storage.loadOperations();
      console.log(`[TreeBuilder] Loaded ${storedOperations.length} operations from storage`);
      
      if (storedOperations.length > 0) {
        // Clear current log and replay stored operations
        this.log.length = 0;
        this.replay(storedOperations, { record: true });
        console.log('[TreeBuilder] Tree reconstructed from operation log');
      } else {
        console.log('[TreeBuilder] No stored operations found, creating and persisting root operation...');
        
        // Create root folder operation and persist it to storage
        // This ensures the root node creation is stored as the first operation
        // const rootOperation: OperationEnvelope = {
        //   id: this.generateOpId(),
        //   ts: Date.now(),
        //   op: {
        //     type: 'create_folder' as const,
        //     id: this.rootNodeConfig.id || 'root',
        //     title: this.rootNodeConfig.title || 'Bookmarks',
        //     isOpen: this.rootNodeConfig.isOpen ?? true,
        //     parentId: undefined,
        //     index: undefined
        //   }
        // };
        
        // Manually persist this operation and add to log
        // await this.storage.persistOperation(rootOperation);
        // this.log.push(rootOperation);
        // console.log('[TreeBuilder] Root operation created and persisted:', rootOperation.id);
      }
      
      this.isInitialized = true;
      console.log('[TreeBuilder] Initialization complete. Root node ID:', this.bookmarkTree.rootId);
      
    } catch (error) {
      console.error('[TreeBuilder] Failed to initialize from storage:', error);
      this.isInitialized = true; // Mark as initialized even on error to prevent retries
      throw error;
    }
  }

  /**
   * Wait for initialization to complete
   */
  async waitForInitialization(): Promise<void> {
    while (!this.isInitialized) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /** Append an operation to the log and apply it to the in-memory tree. */
  async dispatch(op: TreeOperation): Promise<OperationEnvelope> {
    const env: OperationEnvelope = { id: this.generateOpId(), ts: Date.now(), op };
    await this.apply(env);
    this.log.push(env);
    // Persist to storage
    await this.storage.persistOperation(env);
    return env;
  }

  /** Apply an operation envelope without re-recording it (unless record=true). */
  async apply(env: OperationEnvelope, opts?: { record?: boolean }): Promise<void> {
    await this.applyOperation(env.op);
    if (opts?.record) this.log.push(env);
  }

  /** Apply an operation envelope and persist it to storage. Used for external operations that need to be integrated. */
  async applyAndPersist(env: OperationEnvelope): Promise<void> {
    await this.applyOperation(env.op);
    this.log.push(env);
    await this.storage.persistOperation(env);
  }

  /** Apply a list of operations in order. Useful for rebuilding a tree from a log. */
  async replay(envelopes: OperationEnvelope[], opts?: { record?: boolean }): Promise<void> {
    for (const env of envelopes) {
      await this.apply(env, opts);
    }
  }

  // Convenience helpers that create specific operations
  createFolder(op: Omit<CreateFolderOp, "type">): Promise<OperationEnvelope> {
    return this.dispatch({ type: "create_folder", ...op });
  }
  createBookmark(op: Omit<CreateBookmarkOp, "type">): Promise<OperationEnvelope> {
    return this.dispatch({ type: "create_bookmark", ...op });
  }
  moveNode(op: Omit<MoveNodeOp, "type">): Promise<OperationEnvelope> {
    return this.dispatch({ type: "move_node", ...op });
  }
  moveItemToFolder(op: Omit<MoveNodeOp, "type">): Promise<OperationEnvelope> {
    return this.dispatch({ type: "move_item_to_folder", ...op });
  }
  reorder(op: Omit<ReorderOp, "type">): Promise<OperationEnvelope> {
    return this.dispatch({ type: "reorder", ...op });
  }
  openFolder(op: Omit<OpenFolderOp, "type">): Promise<OperationEnvelope> {
    return this.dispatch({ type: "open_folder", ...op });
  }
  closeFolder(op: Omit<CloseFolderOp, "type">): Promise<OperationEnvelope> {
    return this.dispatch({ type: "close_folder", ...op });
  }
  toggleFolder(op: Omit<ToggleFolderOp, "type">): Promise<OperationEnvelope> {
    return this.dispatch({ type: "toggle_folder", ...op });
  }
  removeNode(op: Omit<RemoveNodeOp, "type">): Promise<OperationEnvelope> {
    return this.dispatch({ type: "remove_node", ...op });
  }

  /**
   * Clear all persisted operations (useful for testing)
   */
  async clearPersistedOperations(): Promise<void> {
    await this.storage.clearOperations();
  }

  /**
   * Get the current storage implementation
   */
  getStorage(): OperationStorage {
    return this.storage;
  }

  /** Apply a single operation to the underlying tree. */
  private async applyOperation(op: TreeOperation): Promise<void> {
    switch (op.type) {
      case "create_folder": {
        await this.bookmarkTree.createFolder({
          id: op.id,
          parentId: op.parentId,
          title: op.title,
          isOpen: op.isOpen,
          index: op.index,
        });
        break;
      }
      case "create_bookmark": {
        await this.bookmarkTree.createBookmark({ 
          id: op.id, 
          parentId: op.parentId, 
          title: op.title, 
          url: op.url, 
          index: op.index 
        });
        break;
      }
      case "move_node":
      case "move_item_to_folder": {
        await this.bookmarkTree.move({ nodeId: op.nodeId, toFolderId: op.toFolderId, index: op.index });
        break;
      }
      case "reorder": {
        await this.bookmarkTree.reorder({ folderId: op.folderId, fromIndex: op.fromIndex, toIndex: op.toIndex });
        break;
      }
      case "open_folder": {
        await this.bookmarkTree.openFolder(op.folderId);
        break;
      }
      case "close_folder": {
        await this.bookmarkTree.closeFolder(op.folderId);
        break;
      }
      case "toggle_folder": {
        await this.bookmarkTree.toggleFolder(op.folderId, op.open);
        break;
      }
      case "remove_node": {
        await this.bookmarkTree.remove(op.nodeId);
        break;
      }
      default: {
        const _exhaustive: never = op as never;
        throw new Error("Unknown operation: " + JSON.stringify(_exhaustive));
      }
    }
  }

  private generateOpId(): string {
    // Try native crypto.randomUUID if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis as any;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
    return "op-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
}

// Utility: Build a tree from a log, returning both tree and a normalized log copy.
export const buildTreeFromOperations = async (
  ops: OperationEnvelope[] | TreeOperation[], 
  rootNode?: { id?: NodeId; title?: string; isOpen?: boolean },
  storage?: OperationStorage
) => {
  const builder = new TreeBuilder({ 
    rootNode, 
    storage: storage || new MemoryOperationStorage(),
    autoLoad: false 
  });
  
  // Wait for tree initialization
  await builder.waitForInitialization();
  
  // Support bare operations by wrapping them into envelopes
  const envelopes: OperationEnvelope[] = ops.map((o) =>
    "op" in (o as OperationEnvelope)
      ? (o as OperationEnvelope)
      : { id: builder["generateOpId"](), ts: Date.now(), op: o as TreeOperation }
  );
  
  await builder.replay(envelopes, { record: true });

  return { tree: builder.bookmarkTree, log: builder.log };
};
