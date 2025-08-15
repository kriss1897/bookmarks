/**
 * Bookmark + Folder hierarchy with operations to create, remove, move, reorder, and toggle open/close.
 * Designed for client-side state management in React apps.
 */
import { generateKeyBetween } from "fractional-indexing";

export type NodeKind = "bookmark" | "folder";

export type NodeId = string;

export interface BaseNode {
  id: NodeId;
  kind: NodeKind;
  title: string;
  parentId: NodeId | null;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  // Order key used to sort siblings (fractional-indexing key). Optional for root.
  orderKey?: string;
}

export interface BookmarkNode extends BaseNode {
  kind: "bookmark";
  url: string;
}

export interface FolderNode extends BaseNode {
  kind: "folder";
  isOpen: boolean;
  children: NodeId[]; // ordered by orderKey of children
}

export type TreeNode = BookmarkNode | FolderNode;

export interface SerializedTree {
  rootId: NodeId;
  nodes: Record<NodeId, TreeNode>;
}

// (arrayMove removed; ordering uses fractional keys)

/** Utility: ID generation (crypto.randomUUID if available) */
const generateId = (): NodeId => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback
  return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
};

/** Type guards */
export const isFolder = (n: TreeNode | undefined | null): n is FolderNode => n?.kind === "folder";
export const isBookmark = (n: TreeNode | undefined | null): n is BookmarkNode => n?.kind === "bookmark";

/**
 * BookmarkTree manages a forest represented as a normalized map for quick lookup and safe operations.
 */
export class BookmarkTree {
  private nodes: Map<NodeId, TreeNode> = new Map();
  private _rootId: NodeId | null = null;
  private static INITIAL_KEY = "a0"; // from fractional-indexing defaults

  constructor(init?: Partial<SerializedTree>) {
    if (init?.nodes && init.rootId) {
      this._rootId = init.rootId;
      Object.values(init.nodes).forEach((n) => this.nodes.set(n.id, { ...n }));
      this.validateIntegrity();
      return;
    }
    // Do not auto-create root node - must call init() explicitly
  }

  /** Initialize tree with a root node */
  init(params: { id?: NodeId; title?: string; isOpen?: boolean } = {}): NodeId {
    if (this._rootId !== null) {
      throw new Error("Tree is already initialized with a root node");
    }
    
    const now = Date.now();
    const rootId = params.id ?? generateId();
    const root: FolderNode = {
      id: rootId,
      kind: "folder",
      title: params.title ?? "Root",
      parentId: null,
      isOpen: params.isOpen ?? true,
      children: [],
      createdAt: now,
      updatedAt: now,
    };
    
    this.nodes.set(root.id, root);
    this._rootId = root.id;
    return rootId;
  }

  get rootId(): NodeId {
    if (this._rootId === null) {
      throw new Error("Tree is not initialized - call init() first");
    }
    return this._rootId;
  }

  get root(): FolderNode {
    if (this._rootId === null) {
      throw new Error("Tree is not initialized - call init() first");
    }
    return this.requireFolder(this._rootId);
  }

  /** Serialize into a plain object suitable for persistence */
  serialize(): SerializedTree {
    if (this._rootId === null) {
      throw new Error("Tree is not initialized - call init() first");
    }
    const nodes: Record<NodeId, TreeNode> = {};
    for (const [id, node] of this.nodes.entries()) nodes[id] = { ...node } as TreeNode;
    return { rootId: this._rootId, nodes };
  }

  static fromJSON(data: SerializedTree): BookmarkTree {
    return new BookmarkTree(data);
  }

  /** Get node by id, or undefined if missing */
  getNode(id: NodeId): TreeNode | undefined {
    return this.nodes.get(id);
  }

  /** Get node by id, throwing on missing */
  requireNode(id: NodeId): TreeNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Node not found: ${id}`);
    return n;
  }

  /** Ensure a folder node */
  requireFolder(id: NodeId): FolderNode {
    const n = this.requireNode(id);
    if (!isFolder(n)) throw new Error(`Node ${id} is not a folder`);
    return n;
  }

  /** Ensure a bookmark node */
  requireBookmark(id: NodeId): BookmarkNode {
    const n = this.requireNode(id);
    if (!isBookmark(n)) throw new Error(`Node ${id} is not a bookmark`);
    return n;
  }

  /** Create a folder inside parent folder (defaults to root). Returns new folder id. */
  createFolder(params: { parentId?: NodeId; title: string; id?: NodeId; isOpen?: boolean; index?: number }): NodeId {
    const parentId = params.parentId ?? this.rootId; // Use getter which throws if not initialized
    const { title, id = generateId(), isOpen = true, index } = params;

    console.log(this.nodes);

    const parent = this.requireFolder(parentId);
    const now = Date.now();
    if (this.nodes.has(id)) throw new Error(`Duplicate id: ${id}`);
    const folder: FolderNode = {
      id,
      kind: "folder",
      title,
      parentId,
      isOpen,
      children: [],
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(id, folder);
    this.insertIntoParent(parent, id, index);
    return id;
  }

  /** Create a bookmark inside parent folder (defaults to root). Returns new bookmark id. */
  createBookmark(params: { parentId?: NodeId; title: string; url: string; id?: NodeId; index?: number }): NodeId {
    const parentId = params.parentId ?? this.rootId; // Use getter which throws if not initialized
    const { title, url, id = generateId(), index } = params;
    const parent = this.requireFolder(parentId);
    const now = Date.now();
    if (this.nodes.has(id)) throw new Error(`Duplicate id: ${id}`);
    const bookmark: BookmarkNode = {
      id,
      kind: "bookmark",
      title,
      url,
      parentId,
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(id, bookmark);
    this.insertIntoParent(parent, id, index);
    return id;
  }

  /** Remove a node (folder or bookmark). Removing a folder removes its subtree. Root cannot be removed. */
  remove(id: NodeId): void {
    if (id === this.rootId) throw new Error("Cannot remove the root folder");
    const node = this.requireNode(id);
    // Remove from parent first
    const parent = node.parentId ? this.requireFolder(node.parentId) : null;
    if (parent) this.detachFromParent(parent, id);
    // If folder, recursively delete descendants
    if (isFolder(node)) {
      for (const childId of [...node.children]) this.remove(childId);
    }
    this.nodes.delete(id);
  }

  /** Move a node to a target folder at optional index. Prevents cycles. */
  move(params: { nodeId: NodeId; toFolderId: NodeId; index?: number }): void {
    const { nodeId, toFolderId, index } = params;
    if (nodeId === this.rootId) throw new Error("Cannot move the root folder");
    const node = this.requireNode(nodeId);
    const fromParent = node.parentId ? this.requireFolder(node.parentId) : null;
    const toFolder = this.requireFolder(toFolderId);

    if (isFolder(node)) {
      // Ensure target is not within this folder's subtree
      if (this.isDescendant(toFolderId, nodeId) || nodeId === toFolderId) {
        throw new Error("Cannot move a folder into itself or its descendant");
      }
    }

    if (fromParent && fromParent.id === toFolder.id) {
      // Reorder within same parent using fractional indexing keys
      const currentIndex = fromParent.children.indexOf(nodeId);
      const targetIndex = index ?? fromParent.children.length - 1;
      if (currentIndex === -1) throw new Error("Inconsistent state: node not in parent");
      if (currentIndex === targetIndex) return;
      // Compute new key based on neighbors at target position
      const [leftId, rightId] = this.getNeighborIdsAtIndex(toFolder, targetIndex, nodeId);
      const newKey = this.generateOrderKey(leftId, rightId);
      node.orderKey = newKey;
      // Update order by sorting children
      this.sortChildrenByOrderKey(toFolder);
      this.touch([toFolder.id, node.id]);
      return;
    }

    // Detach from old parent
    if (fromParent) this.detachFromParent(fromParent, nodeId);
    // Attach to new parent
    node.parentId = toFolderId;
    this.insertIntoParent(toFolder, nodeId, index);
    this.touch([toFolder.id, node.id]);
  }

  /** Reorder items inside a folder (from -> to). */
  reorder(params: { folderId: NodeId; fromIndex: number; toIndex: number }): void {
    const { folderId, fromIndex, toIndex } = params;
    const folder = this.requireFolder(folderId);
    if (folder.children.length === 0) return;
    // Assign new key to the moved child based on target neighbors, then sort
    const childId = folder.children[clampIndex(fromIndex, folder.children.length)];
    const [leftId, rightId] = this.getNeighborIdsAtIndex(folder, toIndex, childId);
    const newKey = this.generateOrderKey(leftId, rightId);
    const node = this.requireNode(childId);
    node.orderKey = newKey;
    this.sortChildrenByOrderKey(folder);
    this.touch([folder.id, childId]);
  }

  /** Toggle a folder's open state */
  toggleFolder(folderId: NodeId, open?: boolean): void {
    const folder = this.requireFolder(folderId);
    folder.isOpen = typeof open === "boolean" ? open : !folder.isOpen;
    this.touch([folder.id]);
  }

  /** Open a folder */
  openFolder(folderId: NodeId): void {
    this.toggleFolder(folderId, true);
  }

  /** Close a folder */
  closeFolder(folderId: NodeId): void {
    this.toggleFolder(folderId, false);
  }

  /** List children of a folder as node objects */
  listChildren(folderId: NodeId): TreeNode[] {
    const folder = this.requireFolder(folderId);
    this.sortChildrenByOrderKey(folder);
    return folder.children.map((id) => this.requireNode(id));
  }

  /** Get the path from root to a node (ids) */
  getPathIds(id: NodeId): NodeId[] {
    const path: NodeId[] = [];
    let current: TreeNode | undefined = this.getNode(id);
    while (current) {
      path.push(current.id);
      if (current.parentId === null) break;
      current = this.getNode(current.parentId);
    }
    return path.reverse();
  }

  /** Internal: insert child id into parent at index (or at end) */
  private insertIntoParent(parent: FolderNode, childId: NodeId, index?: number): void {
    // Determine neighbors in desired position and assign orderKey to child
    const [leftId, rightId] = this.getNeighborIdsAtIndex(parent, index ?? parent.children.length, undefined);
    const newKey = this.generateOrderKey(leftId, rightId);
    const child = this.requireNode(childId);
    child.orderKey = newKey;
    parent.children.push(childId);
    this.sortChildrenByOrderKey(parent);
    parent.updatedAt = Date.now();
  }

  /** Internal: detach child id from parent */
  private detachFromParent(parent: FolderNode, childId: NodeId): void {
    const i = parent.children.indexOf(childId);
    if (i >= 0) {
      parent.children.splice(i, 1);
      parent.updatedAt = Date.now();
    }
  }

  /** Internal: is target a descendant of source? */
  private isDescendant(targetId: NodeId, sourceId: NodeId): boolean {
    const target = this.getNode(targetId);
    if (!target) return false;
    let current: TreeNode | undefined = target;
    while (current) {
      if (current.parentId === sourceId) return true;
      if (current.parentId === null) return false;
      current = this.getNode(current.parentId);
    }
    return false;
  }

  /** Internal: touch nodes to update updatedAt */
  private touch(ids: NodeId[]): void {
    const now = Date.now();
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (n) n.updatedAt = now;
    }
  }

  // --- Ordering helpers using fractional-indexing ---
  private getNeighborIdsAtIndex(folder: FolderNode, targetIndex: number, movingId?: NodeId): [NodeId | null, NodeId | null] {
    // Sort first to reflect current order
    this.sortChildrenByOrderKey(folder);
    const items = folder.children.filter((id) => id !== movingId);
    const idx = clampInsertionIndex(targetIndex, items.length);
    const leftId = idx > 0 ? items[idx - 1] : null;
    const rightId = idx < items.length ? items[idx] : null;
    return [leftId, rightId];
  }

  private sortChildrenByOrderKey(folder: FolderNode): void {
    folder.children.sort((a, b) => {
      const ka = this.nodes.get(a)?.orderKey ?? BookmarkTree.INITIAL_KEY;
      const kb = this.nodes.get(b)?.orderKey ?? BookmarkTree.INITIAL_KEY;
      return ka < kb ? -1 : ka > kb ? 1 : a.localeCompare(b);
    });
  }

  private generateOrderKey(leftId: NodeId | null, rightId: NodeId | null): string {
    const leftKey = leftId ? this.nodes.get(leftId)?.orderKey : null;
    const rightKey = rightId ? this.nodes.get(rightId)?.orderKey : null;
    return generateKeyBetween(leftKey ?? null, rightKey ?? null);
  }

  /** Validate parent/child relationships integrity */
  private validateIntegrity(): void {
    if (this._rootId === null) {
      throw new Error("Tree is not initialized - call init() first");
    }
    
    // 1. Root exists and is a folder
    const root = this.nodes.get(this._rootId);
    if (!root || !isFolder(root) || root.parentId !== null) {
      throw new Error("Invalid root in serialized data");
    }
    // 2. Parent references and children arrays are consistent
    const seen = new Set<NodeId>();
    for (const node of this.nodes.values()) {
      if (seen.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
      seen.add(node.id);
      if (node.id !== this._rootId && node.parentId == null) {
        throw new Error(`Node without parent: ${node.id}`);
      }
      if (isFolder(node)) {
        for (const childId of node.children) {
          const child = this.nodes.get(childId);
          if (!child) throw new Error(`Missing child ${childId} in folder ${node.id}`);
          if (child.parentId !== node.id) throw new Error(`Child ${childId} has wrong parent (expected ${node.id})`);
        }
      }
    }
  }
}

/** Clamp index to valid insertion bounds [0, maxExclusive) */
const clampIndex = (index: number, maxExclusive: number): number => {
  if (!Number.isFinite(index)) return 0;
  if (index < 0) return 0;
  if (index >= maxExclusive) return maxExclusive - 1;
  return index;
};

/** Clamp insertion index to [0, length] where length means append at end */
const clampInsertionIndex = (index: number, length: number): number => {
  if (!Number.isFinite(index)) return length;
  if (index < 0) return 0;
  if (index > length) return length;
  return index;
};

// Convenience factory helpers
export const createEmptyTree = (title: string = "Root"): BookmarkTree => {
  const tree = new BookmarkTree();
  tree.init({ title });
  return tree;
};
