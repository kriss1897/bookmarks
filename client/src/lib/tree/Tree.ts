/**
 * General Tree class that provides core tree operations with pluggable storage.
 * This class handles the fundamental tree structure and operations,
 * while storage implementations handle persistence.
 */

import { generateKeyBetween } from "fractional-indexing";
import type {
  BaseTreeNode,
  NodeId,
  SerializedTree,
  TreeConfig,
  TreeChangeEvent,
  TreeChangeListener,
} from "./types";
import type { TreeNodeStorage } from "./storage";

/**
 * Utility: ID generation (crypto.randomUUID if available)
 */
export const generateId = (): NodeId => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback
  return (
    "id-" +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
};

/**
 * General Tree class that manages tree structure with pluggable storage
 */
export class Tree<T extends BaseTreeNode = BaseTreeNode> {
  protected storage: TreeNodeStorage<T>;
  protected cache = new Map<NodeId, T>();
  protected _rootId: NodeId | null = null;
  protected initialized = false;
  protected listeners: TreeChangeListener<T>[] = [];
  protected enableEvents: boolean;

  private static INITIAL_KEY = "a0"; // from fractional-indexing defaults

  constructor(storage: TreeNodeStorage<T>, config: TreeConfig<T> = {}) {
    this.storage = storage;
    this.enableEvents = config.enableEvents ?? false;

    // Initialize from existing data if provided
    if (config.initialData) {
      this.loadFromSerialized(config.initialData);
    }
  }

  /**
   * Initialize the tree (loads from storage or creates root)
   */
  async initialize(rootNodeData?: Partial<T>): Promise<NodeId> {
    if (this.initialized) {
      throw new Error("Tree is already initialized");
    }

    // Check if storage has a root ID
    const existingRootId = await this.storage.getRootId();

    if (existingRootId) {
      // Load existing tree from storage
      this._rootId = existingRootId;
      await this.loadFromStorage();
    } else {
      // Create new tree with root node
      const rootId = await this.createRoot(rootNodeData);
      this._rootId = rootId;
      await this.storage.setRootId(rootId);
    }

    this.initialized = true;
    return this._rootId;
  }

  /**
   * Create a root node
   */
  protected async createRoot(rootNodeData?: Partial<T>): Promise<NodeId> {
    const now = Date.now();
    const rootId = rootNodeData?.id || generateId();

    const rootNode = {
      id: rootId,
      parentId: null,
      createdAt: now,
      updatedAt: now,
      ...rootNodeData,
    } as T;

    await this.storage.setNode(rootNode);
    this.cache.set(rootId, rootNode);

    this.emitChange({
      type: "nodeAdded",
      nodeId: rootId,
      node: rootNode,
    });

    return rootId;
  }

  /**
   * Load tree from storage into cache
   */
  protected async loadFromStorage(): Promise<void> {
    const allNodes = await this.storage.getAllNodes();
    this.cache.clear();

    for (const [id, node] of allNodes) {
      this.cache.set(id, node);
    }
  }

  /**
   * Load tree from serialized data
   */
  protected loadFromSerialized(data: SerializedTree<T>): void {
    this._rootId = data.rootId;
    this.cache.clear();

    for (const [id, node] of Object.entries(data.nodes)) {
      this.cache.set(id, node);
    }

    this.initialized = true;
  }

  /**
   * Get root node ID
   */
  get rootId(): NodeId {
    if (!this.initialized || this._rootId === null) {
      throw new Error("Tree is not initialized");
    }
    return this._rootId;
  }

  /**
   * Get root node
   */
  async getRoot(): Promise<T> {
    const rootNode = await this.getNode(this.rootId);
    if (!rootNode) {
      throw new Error("Root node not found");
    }
    return rootNode;
  }

  /**
   * Get a node by ID
   */
  async getNode(id: NodeId): Promise<T | null> {
    // Check cache first
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    // Load from storage
    const node = await this.storage.getNode(id);
    if (node) {
      this.cache.set(id, node);
    }

    return node;
  }

  /**
   * Get multiple nodes by IDs
   */
  async getNodes(ids: NodeId[]): Promise<Map<NodeId, T>> {
    const result = new Map<NodeId, T>();
    const uncachedIds: NodeId[] = [];

    // Check cache first
    for (const id of ids) {
      if (this.cache.has(id)) {
        result.set(id, this.cache.get(id)!);
      } else {
        uncachedIds.push(id);
      }
    }

    // Load uncached nodes from storage
    if (uncachedIds.length > 0) {
      const storageNodes = await this.storage.getNodes(uncachedIds);
      for (const [id, node] of storageNodes) {
        this.cache.set(id, node);
        result.set(id, node);
      }
    }

    return result;
  }

  /**
   * Add or update a node
   */
  async setNode(node: T): Promise<void> {
    const previousNode = this.cache.get(node.id);
    const isUpdate = previousNode !== undefined;

    // Update timestamps
    const now = Date.now();
    if (!isUpdate) {
      node.createdAt = node.createdAt || now;
    }
    node.updatedAt = now;

    // Persist to storage
    await this.storage.setNode(node);

    // Update cache
    this.cache.set(node.id, node);

    this.emitChange({
      type: isUpdate ? "nodeUpdated" : "nodeAdded",
      nodeId: node.id,
      node,
      previousNode,
    });
  }

  /**
   * Remove a node and all its descendants
   */
  async removeNode(id: NodeId): Promise<void> {
    if (id === this._rootId) {
      throw new Error("Cannot remove root node");
    }

    const node = await this.getNode(id);
    if (!node) {
      return; // Node doesn't exist
    }

    // Get all descendant IDs
    const descendantIds = await this.getDescendantIds(id);
    const allIdsToRemove = [id, ...descendantIds];

    // Remove from storage
    await this.storage.removeNodes(allIdsToRemove);

    // Remove from cache
    for (const nodeId of allIdsToRemove) {
      this.cache.delete(nodeId);
    }

    this.emitChange({
      type: "nodeRemoved",
      nodeId: id,
      node,
    });
  }

  /**
   * Get children of a node
   */
  async getChildren(parentId: NodeId): Promise<T[]> {
    const childrenIds = await this.storage.getChildrenIds(parentId);
    const childrenMap = await this.getNodes(childrenIds);

    // Convert to array and sort by orderKey
    const children = Array.from(childrenMap.values());
    return this.sortByOrderKey(children);
  }

  /**
   * Get direct children IDs
   */
  async getChildrenIds(parentId: NodeId): Promise<NodeId[]> {
    return this.storage.getChildrenIds(parentId);
  }

  /**
   * Get all descendant IDs of a node
   */
  async getDescendantIds(nodeId: NodeId): Promise<NodeId[]> {
    const descendants: NodeId[] = [];
    const childrenIds = await this.getChildrenIds(nodeId);

    for (const childId of childrenIds) {
      descendants.push(childId);
      const grandChildrenIds = await this.getDescendantIds(childId);
      descendants.push(...grandChildrenIds);
    }

    return descendants;
  }

  /**
   * Move a node to a new parent
   */
  async moveNode(
    nodeId: NodeId,
    newParentId: NodeId,
    index?: number,
  ): Promise<void> {
    if (nodeId === this._rootId) {
      throw new Error("Cannot move root node");
    }

    const node = await this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const newParent = await this.getNode(newParentId);
    if (!newParent) {
      throw new Error(`Parent node ${newParentId} not found`);
    }

    // Prevent moving into descendants
    const descendantIds = await this.getDescendantIds(nodeId);
    if (descendantIds.includes(newParentId) || nodeId === newParentId) {
      throw new Error("Cannot move node into itself or its descendants");
    }

    // Update parent reference
    const updatedNode = { ...node, parentId: newParentId };

    // Assign new order key based on target position
    const siblings = await this.getChildren(newParentId);
    const [leftId, rightId] = this.getNeighborIdsAtIndex(
      siblings,
      index,
      nodeId,
    );
    updatedNode.orderKey = this.generateOrderKey(leftId, rightId);

    await this.setNode(updatedNode);
  }

  /**
   * Reorder children within a parent
   */
  async reorderChildren(
    parentId: NodeId,
    fromIndex: number,
    toIndex: number,
  ): Promise<void> {
    const children = await this.getChildren(parentId);

    if (
      fromIndex < 0 ||
      fromIndex >= children.length ||
      toIndex < 0 ||
      toIndex >= children.length
    ) {
      throw new Error("Invalid reorder indices");
    }

    if (fromIndex === toIndex) {
      return; // No change needed
    }

    const nodeToMove = children[fromIndex];
    const [leftId, rightId] = this.getNeighborIdsAtIndex(
      children,
      toIndex,
      nodeToMove.id,
    );
    const newOrderKey = this.generateOrderKey(leftId, rightId);

    const updatedNode = { ...nodeToMove, orderKey: newOrderKey };
    await this.setNode(updatedNode);
  }

  /**
   * Get the path from root to a node
   */
  async getPathToNode(nodeId: NodeId): Promise<T[]> {
    const path: T[] = [];
    let currentNode = await this.getNode(nodeId);

    while (currentNode) {
      path.unshift(currentNode);
      if (currentNode.parentId === null) {
        break;
      }
      currentNode = await this.getNode(currentNode.parentId);
    }

    return path;
  }

  /**
   * Serialize the tree
   */
  serialize(): SerializedTree<T> {
    if (!this.initialized || this._rootId === null) {
      throw new Error("Tree is not initialized");
    }

    const nodes: Record<NodeId, T> = {};
    for (const [id, node] of this.cache) {
      nodes[id] = { ...node };
    }

    return {
      rootId: this._rootId,
      nodes,
    };
  }

  /**
   * Clear the entire tree
   */
  async clear(): Promise<void> {
    await this.storage.clear();
    this.cache.clear();
    this._rootId = null;
    this.initialized = false;

    this.emitChange({ type: "treeClear" });
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    return this.storage.getStats();
  }

  /**
   * Add change listener
   */
  addChangeListener(listener: TreeChangeListener<T>): void {
    this.listeners.push(listener);
  }

  /**
   * Remove change listener
   */
  removeChangeListener(listener: TreeChangeListener<T>): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Emit change event
   */
  protected emitChange(event: TreeChangeEvent<T>): void {
    if (!this.enableEvents) return;

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in tree change listener:", error);
      }
    }
  }

  /**
   * Sort nodes by order key
   */
  protected sortByOrderKey(nodes: T[]): T[] {
    return nodes.sort((a, b) => {
      const keyA = a.orderKey || Tree.INITIAL_KEY;
      const keyB = b.orderKey || Tree.INITIAL_KEY;
      if (keyA < keyB) return -1;
      if (keyA > keyB) return 1;
      return a.id.localeCompare(b.id); // Fallback to ID for stable sort
    });
  }

  /**
   * Get neighbor IDs at a specific index for order key generation
   */
  protected getNeighborIdsAtIndex(
    siblings: T[],
    targetIndex: number | undefined,
    movingId?: NodeId,
  ): [NodeId | null, NodeId | null] {
    // Filter out the moving node if specified
    const filteredSiblings = movingId
      ? siblings.filter((node) => node.id !== movingId)
      : siblings;

    const index =
      targetIndex === undefined
        ? filteredSiblings.length
        : Math.max(0, Math.min(targetIndex, filteredSiblings.length));

    const leftNode = index > 0 ? filteredSiblings[index - 1] : null;
    const rightNode =
      index < filteredSiblings.length ? filteredSiblings[index] : null;

    return [leftNode?.id || null, rightNode?.id || null];
  }

  /**
   * Generate order key between two nodes
   */
  protected generateOrderKey(
    leftId: NodeId | null,
    rightId: NodeId | null,
  ): string {
    const leftKey = leftId ? this.cache.get(leftId)?.orderKey : null;
    const rightKey = rightId ? this.cache.get(rightId)?.orderKey : null;
    return generateKeyBetween(leftKey || null, rightKey || null);
  }
}
