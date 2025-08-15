/**
 * BookmarkTree - extends the general Tree with bookmark-specific functionality
 */

import { Tree, generateId } from './Tree';
import type { BaseTreeNode, NodeId, TreeConfig } from './types';
import type { TreeNodeStorage } from './storage';

export type NodeKind = "bookmark" | "folder";

export interface BookmarkBaseNode extends BaseTreeNode {
  kind: NodeKind;
  title: string;
}

export interface BookmarkNode extends BookmarkBaseNode {
  kind: "bookmark";
  url: string;
}

export interface FolderNode extends BookmarkBaseNode {
  kind: "folder";
  isOpen: boolean;
  children: NodeId[]; // Maintained for compatibility, but tree structure is managed by storage
}

export type BookmarkTreeNode = BookmarkNode | FolderNode;

export interface BookmarkTreeConfig extends TreeConfig<BookmarkTreeNode> {
  rootTitle?: string;
}

/** Type guards */
export const isFolder = (n: BookmarkTreeNode | undefined | null): n is FolderNode => n?.kind === "folder";
export const isBookmark = (n: BookmarkTreeNode | undefined | null): n is BookmarkNode => n?.kind === "bookmark";

/**
 * BookmarkTree extends the general Tree with bookmark-specific operations
 */
export class BookmarkTree extends Tree<BookmarkTreeNode> {
  
  constructor(storage: TreeNodeStorage<BookmarkTreeNode>, config: BookmarkTreeConfig = {}) {
    super(storage, config);
  }

  /**
   * Initialize with a root folder
   */
  async initializeBookmarkTree(config: BookmarkTreeConfig = {}): Promise<NodeId> {
    const rootNodeData: Partial<FolderNode> = {
      kind: "folder",
      title: config.rootTitle || "Bookmarks",
      isOpen: true,
      children: []
    };
    
    return super.initialize(rootNodeData);
  }

  /**
   * Get root as a folder node
   */
  async getRootFolder(): Promise<FolderNode> {
    const root = await this.getRoot();
    if (!isFolder(root)) {
      throw new Error('Root node is not a folder');
    }
    return root;
  }

  /**
   * Require a node to exist
   */
  async requireNode(id: NodeId): Promise<BookmarkTreeNode> {
    const node = await this.getNode(id);
    if (!node) {
      throw new Error(`Node not found: ${id}`);
    }
    return node;
  }

  /**
   * Require a folder node
   */
  async requireFolder(id: NodeId): Promise<FolderNode> {
    const node = await this.requireNode(id);
    if (!isFolder(node)) {
      throw new Error(`Node ${id} is not a folder`);
    }
    return node;
  }

  /**
   * Require a bookmark node
   */
  async requireBookmark(id: NodeId): Promise<BookmarkNode> {
    const node = await this.requireNode(id);
    if (!isBookmark(node)) {
      throw new Error(`Node ${id} is not a bookmark`);
    }
    return node;
  }

  /**
   * Create a folder
   */
  async createFolder(params: {
    parentId?: NodeId;
    title: string;
    id?: NodeId;
    isOpen?: boolean;
    index?: number;
  }): Promise<NodeId> {
    const parentId = params.parentId || this.rootId;
    const id = params.id || generateId();
    const now = Date.now();
    
    // Verify parent exists and is a folder
    await this.requireFolder(parentId);
    
    const folder: FolderNode = {
      id,
      kind: "folder",
      title: params.title,
      parentId,
      isOpen: params.isOpen ?? true,
      children: [],
      createdAt: now,
      updatedAt: now,
    };

    // Set order key based on position
    if (params.index !== undefined) {
      const siblings = await this.getChildren(parentId);
      const [leftId, rightId] = this.getNeighborIdsAtIndex(siblings, params.index);
      folder.orderKey = this.generateOrderKey(leftId, rightId);
    }

    await this.setNode(folder);
    await this.updateParentChildren(parentId);
    
    return id;
  }

  /**
   * Create a bookmark
   */
  async createBookmark(params: {
    parentId?: NodeId;
    title: string;
    url: string;
    id?: NodeId;
    index?: number;
  }): Promise<NodeId> {
    const parentId = params.parentId || this.rootId;
    const id = params.id || generateId();
    const now = Date.now();
    
    // Verify parent exists and is a folder
    await this.requireFolder(parentId);
    
    const bookmark: BookmarkNode = {
      id,
      kind: "bookmark",
      title: params.title,
      url: params.url,
      parentId,
      createdAt: now,
      updatedAt: now,
    };

    // Set order key based on position
    if (params.index !== undefined) {
      const siblings = await this.getChildren(parentId);
      const [leftId, rightId] = this.getNeighborIdsAtIndex(siblings, params.index);
      bookmark.orderKey = this.generateOrderKey(leftId, rightId);
    }

    await this.setNode(bookmark);
    await this.updateParentChildren(parentId);
    
    return id;
  }

  /**
   * Remove a node (folder or bookmark)
   */
  async remove(id: NodeId): Promise<void> {
    const node = await this.getNode(id);
    if (!node) return;
    
    // Update parent's children array before removing
    if (node.parentId) {
      await this.updateParentChildren(node.parentId, [id]);
    }
    
    await this.removeNode(id);
  }

  /**
   * Move a node to a target folder
   */
  async move(params: { nodeId: NodeId; toFolderId: NodeId; index?: number }): Promise<void> {
    const { nodeId, toFolderId, index } = params;
    const node = await this.requireNode(nodeId);
    const oldParentId = node.parentId;
    
    await this.moveNode(nodeId, toFolderId, index);
    
    // Update both old and new parent children arrays
    if (oldParentId && oldParentId !== toFolderId) {
      await this.updateParentChildren(oldParentId, [nodeId]);
    }
    await this.updateParentChildren(toFolderId);
  }

  /**
   * Reorder items inside a folder
   */
  async reorder(params: { folderId: NodeId; fromIndex: number; toIndex: number }): Promise<void> {
    await this.reorderChildren(params.folderId, params.fromIndex, params.toIndex);
    await this.updateParentChildren(params.folderId);
  }

  /**
   * Toggle a folder's open state
   */
  async toggleFolder(folderId: NodeId, open?: boolean): Promise<void> {
    const folder = await this.requireFolder(folderId);
    const updatedFolder = {
      ...folder,
      isOpen: typeof open === "boolean" ? open : !folder.isOpen
    };
    await this.setNode(updatedFolder);
  }

  /**
   * Open a folder
   */
  async openFolder(folderId: NodeId): Promise<void> {
    await this.toggleFolder(folderId, true);
  }

  /**
   * Close a folder
   */
  async closeFolder(folderId: NodeId): Promise<void> {
    await this.toggleFolder(folderId, false);
  }

  /**
   * List children of a folder as node objects
   */
  async listChildren(folderId: NodeId): Promise<BookmarkTreeNode[]> {
    await this.requireFolder(folderId);
    return this.getChildren(folderId);
  }

  /**
   * Get the path from root to a node (ids)
   */
  async getPathIds(id: NodeId): Promise<NodeId[]> {
    const path = await this.getPathToNode(id);
    return path.map(node => node.id);
  }

  /**
   * Update a folder's children array to match current tree structure
   * This maintains compatibility with existing code that expects the children array
   */
  private async updateParentChildren(parentId: NodeId, excludeIds: NodeId[] = []): Promise<void> {
    const parent = await this.getNode(parentId);
    if (!parent || !isFolder(parent)) return;
    
    const childrenIds = await this.getChildrenIds(parentId);
    const filteredChildrenIds = childrenIds.filter(id => !excludeIds.includes(id));
    
    const updatedParent = {
      ...parent,
      children: filteredChildrenIds
    };
    
    await this.setNode(updatedParent);
  }

  /**
   * Synchronous methods for compatibility with existing code
   * These load from cache and should be used after the tree is loaded
   */

  /**
   * Get node from cache (synchronous)
   */
  getNodeSync(id: NodeId): BookmarkTreeNode | undefined {
    return this.cache.get(id);
  }

  /**
   * Get root folder from cache (synchronous)
   */
  get root(): FolderNode {
    const root = this.cache.get(this.rootId);
    if (!root || !isFolder(root)) {
      throw new Error('Root folder not found in cache');
    }
    return root;
  }

  /**
   * List children from cache (synchronous)
   */
  listChildrenSync(folderId: NodeId): BookmarkTreeNode[] {
    const folder = this.cache.get(folderId);
    if (!folder || !isFolder(folder)) {
      throw new Error(`Folder ${folderId} not found in cache`);
    }
    
    const children = folder.children
      .map(id => this.cache.get(id))
      .filter((node): node is BookmarkTreeNode => node !== undefined);
    
    return this.sortByOrderKey(children);
  }

  /**
   * Load entire tree into cache for synchronous operations
   */
  async loadFullTree(): Promise<void> {
    await this.loadFromStorage();
    
    // Update all folder children arrays to reflect current structure
    for (const [id, node] of this.cache) {
      if (isFolder(node)) {
        await this.updateParentChildren(id);
      }
    }
  }
}
