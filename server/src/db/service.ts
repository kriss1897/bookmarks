import { BookmarkRepository } from './repository.js';
import type { TreeNode, NewNode, NewFolder, NewBookmark, Operation, NewOperation } from './schema.js';
import { v4 as uuidv4 } from 'uuid';

export class BookmarkService {
  private repository: BookmarkRepository;

  constructor() {
    this.repository = new BookmarkRepository();
  }

  // Node service methods
  async createFolder(
    namespace: string,
    nodeData: Partial<Pick<NewNode, 'id'>> & Omit<NewNode, 'id' | 'kind' | 'createdAt' | 'updatedAt' | 'namespace'>,
    folderData: Omit<NewFolder, 'nodeId'>
  ): Promise<TreeNode> {
    const now = new Date();
    const id = nodeData.id || `folder-${uuidv4()}`;

    const node = await this.repository.createFolder(
      {
        ...nodeData,
        id,
        namespace,
        createdAt: now,
        updatedAt: now,
      },
      {
        ...folderData,
        nodeId: id,
      }
    );

    // Record the operation
    await this.recordOperation({
      id: `op-create-${node.id}-${now.getTime()}`,
      namespace,
      type: 'create',
      nodeId: node.id,
      data: JSON.stringify(node),
      timestamp: now,
      deviceId: 'server',
      sessionId: `session-${Date.now()}`,
    });

    return node;
  }

  async createBookmark(
    namespace: string,
    nodeData: Partial<Pick<NewNode, 'id'>> & Omit<NewNode, 'id' | 'kind' | 'createdAt' | 'updatedAt' | 'namespace'>,
    bookmarkData: Omit<NewBookmark, 'nodeId'>
  ): Promise<TreeNode> {
    const now = new Date();
    const id = nodeData.id || `bookmark-${uuidv4()}`;

    const node = await this.repository.createBookmark(
      {
        ...nodeData,
        id,
        namespace,
        createdAt: now,
        updatedAt: now,
      },
      {
        ...bookmarkData,
        nodeId: id,
      }
    );

    // Record the operation
    await this.recordOperation({
      id: `op-create-${node.id}-${now.getTime()}`,
      namespace,
      type: 'create',
      nodeId: node.id,
      data: JSON.stringify(node),
      timestamp: now,
      deviceId: 'server',
      sessionId: `session-${Date.now()}`,
    });

    return node;
  }

  async updateNode(
    namespace: string,
    id: string,
    nodeUpdates: Partial<Omit<NewNode, 'id' | 'createdAt' | 'updatedAt'>>,
    specificUpdates: any = {}
  ): Promise<TreeNode | null> {
    const existingNode = await this.repository.getNode(id, namespace);
    if (!existingNode) {
      return null;
    }

    const now = new Date();
    let updatedNode: TreeNode | null = null;

    if (existingNode.kind === 'folder') {
      updatedNode = await this.repository.updateFolder(id, nodeUpdates, specificUpdates);
    } else {
      updatedNode = await this.repository.updateBookmark(id, nodeUpdates, specificUpdates);
    }

    if (updatedNode) {
      // Record the operation
      await this.recordOperation({
        id: `op-update-${id}-${now.getTime()}`,
        namespace,
        type: 'update',
        nodeId: id,
        data: JSON.stringify({ previous: existingNode, updated: updatedNode }),
        timestamp: now,
        deviceId: 'server',
        sessionId: `session-${Date.now()}`,
      });
    }

    return updatedNode;
  }

  async deleteNode(namespace: string, id: string): Promise<boolean> {
    const existingNode = await this.repository.getNode(id, namespace);
    if (!existingNode) {
      return false;
    }

    // Get all child nodes first
    const children = await this.getNodeChildren(namespace, id);

    // Delete all children recursively
    for (const child of children) {
      await this.deleteNode(namespace, child.id);
    }

    const deleted = await this.repository.deleteNode(id);

    if (deleted) {
      const now = new Date();
      // Record the operation
      await this.recordOperation({
        id: `op-delete-${id}-${now.getTime()}`,
        namespace,
        type: 'delete',
        nodeId: id,
        data: JSON.stringify(existingNode),
        timestamp: now,
        deviceId: 'server',
        sessionId: `session-${Date.now()}`,
      });
    }

    return deleted;
  }

  async getNode(namespace: string, id: string): Promise<TreeNode | null> {
    return await this.repository.getNode(id, namespace);
  }

  async getNodeChildren(namespace: string, parentId: string): Promise<TreeNode[]> {
    return await this.repository.getNodesByParent(parentId, namespace);
  }

  async getRootNode(namespace: string): Promise<TreeNode | null> {
    const rootNodes = await this.repository.getNodesByParent(null, namespace);
    return rootNodes.length > 0 ? rootNodes[0] : null;
  }

  async moveNode(namespace: string, nodeId: string, newParentId: string | null, orderKey?: string): Promise<TreeNode | null> {
    const node = await this.repository.getNode(nodeId, namespace);
    if (!node) {
      return null;
    }

    const previousParentId = node.parentId;
    const now = new Date();

    const updatedNode = await this.repository.updateFolder(nodeId, {
      parentId: newParentId,
      orderKey: orderKey || node.orderKey,
    }, {}) || await this.repository.updateBookmark(nodeId, {
      parentId: newParentId,
      orderKey: orderKey || node.orderKey,
    }, {});

    if (updatedNode) {
      // Record the move operation
      await this.recordOperation({
        id: `op-move-${nodeId}-${now.getTime()}`,
        namespace,
        type: 'move',
        nodeId: nodeId,
        data: JSON.stringify({
          from: previousParentId,
          to: newParentId,
          orderKey,
        }),
        timestamp: now,
        deviceId: 'server',
        sessionId: `session-${Date.now()}`,
      });
    }

    return updatedNode;
  }

  // Tree operations
  async getSerializedTree(namespace: string): Promise<{ rootId: string; nodes: Record<string, any> } | null> {
    return await this.repository.buildSerializedTree(namespace);
  }

  async getNodeWithChildren(namespace: string, nodeId: string): Promise<{ rootId: string; nodes: Record<string, any> } | null> {
    const rootNode = await this.repository.getNode(nodeId, namespace);
    if (!rootNode) {
      return null;
    }

    const nodes: Record<string, any> = {};

    // Recursive function to load children for open folders
    const loadNodeAndChildren = async (node: TreeNode): Promise<void> => {
      // Get direct children first
      const children = await this.repository.getNodesByParent(node.id, namespace);
      const childrenIds = children.map(child => child.id);

      // Add current node to the result with children array
      nodes[node.id] = {
        id: node.id,
        parentId: node.parentId,
        kind: node.kind,
        title: node.title,
        children: childrenIds, // Array of ALL child node IDs
        ...(node.kind === 'bookmark' && {
          url: node.url,
          description: node.description,
          favicon: node.favicon
        }),
        ...(node.kind === 'folder' && { isOpen: node.isOpen }),
        createdAt: node.createdAt.getTime(),
        updatedAt: node.updatedAt.getTime(),
        orderKey: node.orderKey,
      };

      // Only load children recursively if:
      // 1. This is not a folder (bookmarks don't have children anyway), OR
      // 2. This is a folder and it's open, OR  
      // 3. This is the root node we're starting from
      const shouldLoadChildren =
        node.kind !== 'folder' ||
        (node.kind === 'folder' && node.isOpen === true) ||
        node.id === nodeId;

      if (shouldLoadChildren) {
        // Process each child recursively (this will add them to nodes object)
        for (const child of children) {
          await loadNodeAndChildren(child);
        }
      }
    };

    await loadNodeAndChildren(rootNode);

    return {
      rootId: nodeId,
      nodes,
    };
  }

  async initializeWithSampleData(): Promise<void> {
    await this.repository.initializeWithSampleData();
  }

  // Operation methods
  private async recordOperation(operationData: NewOperation): Promise<Operation> {
    return await this.repository.createOperation(operationData);
  }

  async getOperations(limit: number = 100): Promise<Operation[]> {
    return await this.repository.getOperations(limit);
  }

  async getOperationsAfter(timestamp: Date): Promise<Operation[]> {
    return await this.repository.getOperationsAfter(timestamp);
  }

  async getNodeOperations(nodeId: string): Promise<Operation[]> {
    return await this.repository.getOperationsByNode(nodeId);
  }

  // Sync operations
  async createSnapshot(namespace: string): Promise<void> {
    const tree = await this.getSerializedTree(namespace);
    if (!tree) {
      throw new Error('No tree data to snapshot');
    }

    await this.repository.createSnapshot({
      id: `snapshot-${Date.now()}`,
      namespace,
      rootId: tree.rootId,
      data: JSON.stringify(tree),
      timestamp: new Date(),
      version: 1,
    });
  }

  async getLatestSnapshot(namespace: string) {
    return await this.repository.getLatestSnapshot(namespace);
  }

  // Utility methods
  async getTreeStats(): Promise<{
    totalNodes: number;
    totalBookmarks: number;
    totalFolders: number;
    totalOperations: number;
  }> {
    const allNodes = await this.repository.getAllNodes();
    const operations = await this.repository.getOperations(1000);

    return {
      totalNodes: allNodes.length,
      totalBookmarks: allNodes.filter(n => n.kind === 'bookmark').length,
      totalFolders: allNodes.filter(n => n.kind === 'folder').length,
      totalOperations: operations.length,
    };
  }

  async getAllNamespaces(): Promise<Array<{ namespace: string; rootNodeId: string; rootNodeTitle: string }>> {
    return await this.repository.getAllNamespaces();
  }

  // Apply operation envelope coming from client
  async applyOperationEnvelope(namespace: string, envelope: {
    id: string;
    ts: number;
    op: { type: string;[k: string]: any };
  }): Promise<{ success: boolean; operationId: string; message?: string; error?: string; data?: any }> {
    // Idempotency: if operation already exists, return success
    const existing = await this.repository.getOperationById(envelope.id);
    if (existing) {
      return {
        success: true,
        operationId: envelope.id,
        message: 'Operation already applied'
      };
    }

    const type = envelope.op.type;
    try {
      let data: any = null;
      switch (type) {
        case 'create_folder': {
          const { id, parentId = null, title, isOpen = true, index, orderKey } = envelope.op;
          data = await this.createFolder(namespace, {
            id,
            parentId,
            orderKey: orderKey || undefined,
          }, {
            title,
            isOpen
          });
          break;
        }
        case 'create_bookmark': {
          const { id, parentId = null, title, url, index, orderKey, description, favicon } = envelope.op;
          data = await this.createBookmark(namespace, {
            id,
            parentId,
            orderKey: orderKey || undefined,
          }, {
            title,
            url,
            description,
            favicon
          });
          break;
        }
        case 'move_node':
        case 'move_item_to_folder': {
          const { nodeId, toFolderId, index, orderKey } = envelope.op;
          data = await this.moveNode(namespace, nodeId, toFolderId || null, orderKey);
          break;
        }
        case 'update_node': {
          const { nodeId, parentId, orderKey } = envelope.op as any;
          if (!nodeId) throw new Error('update_node: nodeId is required');
          const existing = await this.repository.getNode(nodeId, namespace);
          if (!existing) throw new Error(`Node not found: ${nodeId}`);
          const nodeUpdates: Partial<any> = {};
          if (parentId !== undefined) nodeUpdates.parentId = parentId;
          if (orderKey !== undefined) nodeUpdates.orderKey = orderKey;
          const updated = existing.kind === 'folder'
            ? await this.repository.updateFolder(nodeId, nodeUpdates, {})
            : await this.repository.updateBookmark(nodeId, nodeUpdates, {});
          data = { nodeId, parentId: updated?.parentId, orderKey: updated?.orderKey };
          break;
        }
        case 'open_folder':
        case 'close_folder': {
          const folderId = (type === 'open_folder' || type === 'close_folder') ? envelope.op.folderId : undefined;

          if (!folderId) {
            throw new Error('folderId is required for folder open/close operations');
          }

          const isOpen = type === 'open_folder';
          data = await this.updateNode(namespace, folderId, {}, { isOpen });
          break;
        }
        case 'remove_node': {
          const { nodeId } = envelope.op;
          const ok = await this.deleteNode(namespace, nodeId);
          data = { deleted: ok };
          break;
        }
        case 'mark_folder_loaded':
        case 'hydrate_node':
        case 'mark_folder_not_loaded': {
          // Client-only state ops; ignore on server
          data = { skipped: true };
          break;
        }
        default:
          return { success: false, operationId: envelope.id, error: `Unsupported operation type: ${type}` };
      }

      // Record client-provided operation id with namespace
      await this.repository.createOperation({
        id: envelope.id,
        namespace,
        type: this.mapOpTypeToDbType(type),
        nodeId: this.extractNodeIdFromOp(envelope.op),
        data: JSON.stringify(envelope.op),
        timestamp: new Date(envelope.ts),
        deviceId: 'client',
        sessionId: 'client-sync'
      });

      return { success: true, operationId: envelope.id, message: 'Operation applied', data };
    } catch (err: any) {
      return { success: false, operationId: envelope.id, error: err?.message || 'Unknown error' };
    }
  }

  private mapOpTypeToDbType(type: string): 'create' | 'update' | 'delete' | 'move' {
    switch (type) {
      case 'create_folder':
      case 'create_bookmark':
        return 'create';
      case 'move_node':
      case 'move_item_to_folder':
      case 'reorder':
        return 'move';
      case 'update_node':
      case 'remove_node':
        return 'delete';
      case 'open_folder':
      case 'close_folder':
        return 'update';
      default:
        return 'update';
    }
  }

  private extractNodeIdFromOp(op: { type: string;[k: string]: any }): string {
    switch (op.type) {
      case 'create_folder':
      case 'create_bookmark':
        return op.id;
      case 'move_node':
      case 'move_item_to_folder':
        return op.nodeId;
      case 'reorder':
        return (op as any).nodeId || (op as any).folderId;
      case 'update_node':
        return (op as any).nodeId;
      case 'open_folder':
      case 'close_folder':
        return op.folderId;
      case 'remove_node':
        return op.nodeId;
      default:
        return op.id || op.nodeId || 'unknown';
    }
  }
}
