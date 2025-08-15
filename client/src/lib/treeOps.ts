import { BookmarkTree, type NodeId } from "./bookmarksTree";

// Operation type definitions
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
}

/**
 * TreeOpsBuilder applies operations to a BookmarkTree and records them in a log.
 * It can also replay an existing log to rebuild a tree.
 * 
 * This base class handles operations in-memory only. Extend this class to add
 * persistence capabilities (IndexedDB, localStorage, server-side, etc.).
 */
export class TreeOpsBuilder {
  readonly tree: BookmarkTree;
  readonly log: OperationEnvelope[] = [];

  constructor(init?: { tree?: ReturnType<BookmarkTree["serialize"]>; log?: OperationEnvelope[]; rootNode?: { id?: string; title?: string; isOpen?: boolean } }) {
    if (init?.tree) {
      this.tree = BookmarkTree.fromJSON(init.tree);
    } else {
      this.tree = new BookmarkTree();
      // Initialize tree with root node if rootNode is provided
      if (init?.rootNode !== undefined) {
        const rootParams = init.rootNode || {};
        this.tree.init(rootParams);
      }
    }
    
    if (init?.log?.length) {
      this.replay(init.log, { record: false });
    }
  }

  /** Append an operation to the log and apply it to the in-memory tree. */
  dispatch(op: TreeOperation): OperationEnvelope {
    const env: OperationEnvelope = { id: this.generateOpId(), ts: Date.now(), op };
    this.apply(env);
    this.log.push(env);
    // Hook for persistence - override in derived classes
    this.persistOperation(env);
    return env;
  }

  /** 
   * Persist an operation to storage. Override in derived classes for persistence.
   * Base implementation does nothing (in-memory only).
   */
  protected async persistOperation(env: OperationEnvelope): Promise<void> {
    // Base implementation: no persistence
    void env; // Suppress unused parameter warning
  }

  /**
   * Load operations from storage. Override in derived classes for persistence.
   * Base implementation returns empty array (in-memory only).
   */
  protected async loadOperations(): Promise<OperationEnvelope[]> {
    // Base implementation: no persistence
    return [];
  }

  /** Apply an operation envelope without re-recording it (unless record=true). */
  apply(env: OperationEnvelope, opts?: { record?: boolean }): void {
    this.applyOperation(env.op);
    if (opts?.record) this.log.push(env);
  }

  /** Apply a list of operations in order. Useful for rebuilding a tree from a log. */
  replay(envelopes: OperationEnvelope[], opts?: { record?: boolean }): void {
    for (const env of envelopes) this.apply(env, opts);
  }

  // Convenience helpers that create specific operations
  createFolder(op: Omit<CreateFolderOp, "type">): OperationEnvelope {
    return this.dispatch({ type: "create_folder", ...op });
  }
  createBookmark(op: Omit<CreateBookmarkOp, "type">): OperationEnvelope {
    return this.dispatch({ type: "create_bookmark", ...op });
  }
  moveNode(op: Omit<MoveNodeOp, "type">): OperationEnvelope {
    return this.dispatch({ type: "move_node", ...op });
  }
  moveItemToFolder(op: Omit<MoveNodeOp, "type">): OperationEnvelope {
    return this.dispatch({ type: "move_item_to_folder", ...op });
  }
  reorder(op: Omit<ReorderOp, "type">): OperationEnvelope {
    return this.dispatch({ type: "reorder", ...op });
  }
  openFolder(op: Omit<OpenFolderOp, "type">): OperationEnvelope {
    return this.dispatch({ type: "open_folder", ...op });
  }
  closeFolder(op: Omit<CloseFolderOp, "type">): OperationEnvelope {
    return this.dispatch({ type: "close_folder", ...op });
  }
  toggleFolder(op: Omit<ToggleFolderOp, "type">): OperationEnvelope {
    return this.dispatch({ type: "toggle_folder", ...op });
  }
  removeNode(op: Omit<RemoveNodeOp, "type">): OperationEnvelope {
    return this.dispatch({ type: "remove_node", ...op });
  }

  /** Apply a single operation to the underlying tree. */
  private applyOperation(op: TreeOperation): void {
    switch (op.type) {
      case "create_folder": {
        this.tree.createFolder({
          id: op.id,
          parentId: op.parentId,
          title: op.title,
          isOpen: op.isOpen,
          index: op.index,
        });
        return;
      }
      case "create_bookmark": {
        this.tree.createBookmark({ id: op.id, parentId: op.parentId, title: op.title, url: op.url, index: op.index });
        return;
      }
      case "move_node":
      case "move_item_to_folder": {
        this.tree.move({ nodeId: op.nodeId, toFolderId: op.toFolderId, index: op.index });
        return;
      }
      case "reorder": {
        this.tree.reorder({ folderId: op.folderId, fromIndex: op.fromIndex, toIndex: op.toIndex });
        return;
      }
      case "open_folder": {
        this.tree.openFolder(op.folderId);
        return;
      }
      case "close_folder": {
        this.tree.closeFolder(op.folderId);
        return;
      }
      case "toggle_folder": {
        this.tree.toggleFolder(op.folderId, op.open);
        return;
      }
      case "remove_node": {
        this.tree.remove(op.nodeId);
        return;
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
export const buildTreeFromOperations = (ops: OperationEnvelope[] | TreeOperation[], rootNode?: { id?: NodeId; title?: string; isOpen?: boolean }) => {
  const builder = new TreeOpsBuilder({ rootNode });
  // Support bare operations by wrapping them into envelopes
  const envelopes: OperationEnvelope[] = ops.map((o) =>
    "op" in (o as OperationEnvelope)
      ? (o as OperationEnvelope)
      : { id: builder["generateOpId"](), ts: Date.now(), op: o as TreeOperation }
  );
  builder.replay(envelopes, { record: true });

  return { tree: builder.tree, log: builder.log };
};
