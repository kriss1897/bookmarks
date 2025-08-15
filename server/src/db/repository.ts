import { eq, desc, and, isNull } from 'drizzle-orm';
import { db } from './index.js';
import { nodes, folders, bookmarks, operations, treeSnapshots, syncMetadata } from './schema.js';
import type { 
  Node, 
  NewNode, 
  Folder,
  NewFolder,
  Bookmark,
  NewBookmark,
  TreeNode,
  FolderWithNode,
  BookmarkWithNode,
  Operation, 
  NewOperation, 
  TreeSnapshot, 
  NewTreeSnapshot,
  SyncMetadata,
  NewSyncMetadata 
} from './schema.js';

export class BookmarkRepository {
  // Node operations
  async createFolder(nodeData: Omit<NewNode, 'kind'>, folderData: NewFolder): Promise<FolderWithNode> {
    return await db.transaction((tx) => {
      // Create the base node
      const nodeResult = tx.insert(nodes).values({
        ...nodeData,
        kind: 'folder'
      }).returning().get();

      // Create the folder-specific data
      const folderResult = tx.insert(folders).values({
        ...folderData,
        nodeId: nodeResult.id
      }).returning().get();

      return {
        ...nodeResult,
        kind: 'folder' as const,
        title: folderResult.title,
        isOpen: folderResult.isOpen
      };
    });
  }

  async createBookmark(nodeData: Omit<NewNode, 'kind'>, bookmarkData: NewBookmark): Promise<BookmarkWithNode> {
    return await db.transaction((tx) => {
      // Create the base node
      const nodeResult = tx.insert(nodes).values({
        ...nodeData,
        kind: 'bookmark'
      }).returning().get();

      // Create the bookmark-specific data
      const bookmarkResult = tx.insert(bookmarks).values({
        ...bookmarkData,
        nodeId: nodeResult.id
      }).returning().get();

      return {
        ...nodeResult,
        kind: 'bookmark' as const,
        title: bookmarkResult.title,
        url: bookmarkResult.url,
        description: bookmarkResult.description || undefined,
        favicon: bookmarkResult.favicon || undefined
      };
    });
  }

  async getNode(id: string, namespace?: string): Promise<TreeNode | null> {
    const whereCondition = namespace 
      ? and(eq(nodes.id, id), eq(nodes.namespace, namespace))
      : eq(nodes.id, id);
      
    const [node] = await db.select().from(nodes).where(whereCondition);
    if (!node) return null;

    if (node.kind === 'folder') {
      const [folder] = await db.select().from(folders).where(eq(folders.nodeId, id));
      if (!folder) return null;
      
      return {
        ...node,
        kind: 'folder' as const,
        title: folder.title,
        isOpen: folder.isOpen
      };
    } else {
      const [bookmark] = await db.select().from(bookmarks).where(eq(bookmarks.nodeId, id));
      if (!bookmark) return null;
      
      return {
        ...node,
        kind: 'bookmark' as const,
        title: bookmark.title,
        url: bookmark.url,
        description: bookmark.description || undefined,
        favicon: bookmark.favicon || undefined
      };
    }
  }

  async updateFolder(id: string, nodeUpdates: Partial<NewNode>, folderUpdates: Partial<NewFolder>): Promise<FolderWithNode | null> {
    return await db.transaction((tx) => {
      // Update the base node if there are updates
      if (Object.keys(nodeUpdates).length > 0) {
        tx.update(nodes)
          .set({ ...nodeUpdates, updatedAt: new Date() })
          .where(eq(nodes.id, id))
          .run();
      }

      // Update the folder-specific data if there are updates
      if (Object.keys(folderUpdates).length > 0) {
        tx.update(folders)
          .set(folderUpdates)
          .where(eq(folders.nodeId, id))
          .run();
      }

      // Return the updated node - need to fetch it manually
      const nodeResult = tx.select().from(nodes).where(eq(nodes.id, id)).get();
      if (!nodeResult) return null;

      const folderResult = tx.select().from(folders).where(eq(folders.nodeId, id)).get();
      if (!folderResult) return null;

      return {
        ...nodeResult,
        kind: 'folder' as const,
        title: folderResult.title,
        isOpen: folderResult.isOpen
      };
    });
  }

  async updateBookmark(id: string, nodeUpdates: Partial<NewNode>, bookmarkUpdates: Partial<NewBookmark>): Promise<BookmarkWithNode | null> {
    return await db.transaction((tx) => {
      // Update the base node if there are updates
      if (Object.keys(nodeUpdates).length > 0) {
        tx.update(nodes)
          .set({ ...nodeUpdates, updatedAt: new Date() })
          .where(eq(nodes.id, id))
          .run();
      }

      // Update the bookmark-specific data if there are updates
      if (Object.keys(bookmarkUpdates).length > 0) {
        tx.update(bookmarks)
          .set(bookmarkUpdates)
          .where(eq(bookmarks.nodeId, id))
          .run();
      }

      // Return the updated node - need to fetch it manually
      const nodeResult = tx.select().from(nodes).where(eq(nodes.id, id)).get();
      if (!nodeResult) return null;

      const bookmarkResult = tx.select().from(bookmarks).where(eq(bookmarks.nodeId, id)).get();
      if (!bookmarkResult) return null;

      return {
        ...nodeResult,
        kind: 'bookmark' as const,
        title: bookmarkResult.title,
        url: bookmarkResult.url,
        description: bookmarkResult.description || undefined,
        favicon: bookmarkResult.favicon || undefined
      };
    });
  }

  async deleteNode(id: string): Promise<boolean> {
    return await db.transaction((tx) => {
      const result = tx.delete(nodes).where(eq(nodes.id, id)).run();
      return result.changes > 0;
    });
  }

  async getNodesByParent(parentId: string | null, namespace?: string): Promise<TreeNode[]> {
    let whereCondition;
    
    if (parentId === null) {
      whereCondition = namespace 
        ? and(isNull(nodes.parentId), eq(nodes.namespace, namespace))
        : isNull(nodes.parentId);
    } else {
      whereCondition = namespace
        ? and(eq(nodes.parentId, parentId), eq(nodes.namespace, namespace))
        : eq(nodes.parentId, parentId);
    }
    
    const nodeQuery = await db.select().from(nodes).where(whereCondition);

    const result: TreeNode[] = [];
    
    for (const node of nodeQuery) {
      const fullNode = await this.getNode(node.id, namespace);
      if (fullNode) {
        result.push(fullNode);
      }
    }

    return result;
  }

  async getAllNodes(): Promise<TreeNode[]> {
    const allNodes = await db.select().from(nodes);
    const result: TreeNode[] = [];
    
    for (const node of allNodes) {
      const fullNode = await this.getNode(node.id);
      if (fullNode) {
        result.push(fullNode);
      }
    }

    return result;
  }

  async getRootNode(): Promise<TreeNode | null> {
    const [node] = await db.select().from(nodes).where(isNull(nodes.parentId));
    if (!node) return null;
    
    return await this.getNode(node.id);
  }

  // Operation operations
  async createOperation(operationData: NewOperation): Promise<Operation> {
    const [operation] = await db.insert(operations).values(operationData).returning();
    return operation;
  }

  async getOperations(limit: number = 100): Promise<Operation[]> {
    return await db
      .select()
      .from(operations)
      .orderBy(desc(operations.timestamp))
      .limit(limit);
  }

  async getOperationsAfter(timestamp: Date): Promise<Operation[]> {
    return await db
      .select()
      .from(operations)
      .where(eq(operations.timestamp, timestamp))
      .orderBy(operations.timestamp);
  }

  async getOperationsByNode(nodeId: string): Promise<Operation[]> {
    return await db
      .select()
      .from(operations)
      .where(eq(operations.nodeId, nodeId))
      .orderBy(desc(operations.timestamp));
  }

  // Tree snapshot operations
  async createSnapshot(snapshotData: NewTreeSnapshot): Promise<TreeSnapshot> {
    const [snapshot] = await db.insert(treeSnapshots).values(snapshotData).returning();
    return snapshot;
  }

  async getLatestSnapshot(): Promise<TreeSnapshot | null> {
    const [snapshot] = await db
      .select()
      .from(treeSnapshots)
      .orderBy(desc(treeSnapshots.timestamp))
      .limit(1);
    return snapshot || null;
  }

  async getSnapshots(limit: number = 10): Promise<TreeSnapshot[]> {
    return await db
      .select()
      .from(treeSnapshots)
      .orderBy(desc(treeSnapshots.timestamp))
      .limit(limit);
  }

  // Sync metadata operations
  async getSyncMetadata(deviceId: string): Promise<SyncMetadata | null> {
    const [metadata] = await db
      .select()
      .from(syncMetadata)
      .where(eq(syncMetadata.deviceId, deviceId));
    return metadata || null;
  }

  async updateSyncMetadata(deviceId: string, data: Partial<NewSyncMetadata>): Promise<SyncMetadata> {
    const existing = await this.getSyncMetadata(deviceId);
    
    if (existing) {
      const [updated] = await db
        .update(syncMetadata)
        .set(data)
        .where(eq(syncMetadata.deviceId, deviceId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(syncMetadata)
        .values({ 
          id: `sync-${deviceId}-${Date.now()}`,
          deviceId, 
          ...data 
        })
        .returning();
      return created;
    }
  }

  // Utility methods
  async buildSerializedTree(): Promise<{ rootId: string; nodes: Record<string, any> } | null> {
    const allNodes = await this.getAllNodes();
    const rootNode = await this.getRootNode();
    
    if (!rootNode || allNodes.length === 0) {
      return null;
    }

    const nodeMap: Record<string, any> = {};
    
    for (const node of allNodes) {
      nodeMap[node.id] = {
        id: node.id,
        parentId: node.parentId,
        kind: node.kind,
        title: node.title,
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
    }

    return {
      rootId: rootNode.id,
      nodes: nodeMap,
    };
  }

  async initializeWithSampleData(): Promise<void> {
    // Check if we already have data
    const existingNodes = await this.getAllNodes();
    if (existingNodes.length > 0) {
      return; // Data already exists
    }

    const now = new Date();
    
    // Create root folder
    const rootFolder = await this.createFolder(
      {
        id: 'root',
        parentId: null,
        createdAt: now,
        updatedAt: now,
        orderKey: '0',
      },
      {
        nodeId: 'root',
        title: 'Bookmarks',
        isOpen: true,
      }
    );

    // Create Development folder
    const devFolder = await this.createFolder(
      {
        id: 'folder-1',
        parentId: 'root',
        createdAt: now,
        updatedAt: now,
        orderKey: '1',
      },
      {
        nodeId: 'folder-1',
        title: 'Development',
        isOpen: true,
      }
    );

    // Create Design folder (closed)
    const designFolder = await this.createFolder(
      {
        id: 'folder-2',
        parentId: 'root',
        createdAt: now,
        updatedAt: now,
        orderKey: '2',
      },
      {
        nodeId: 'folder-2',
        title: 'Design',
        isOpen: false,
      }
    );

    // Create bookmarks
    const githubBookmark = await this.createBookmark(
      {
        id: 'bookmark-1',
        parentId: 'root',
        createdAt: now,
        updatedAt: now,
        orderKey: '3',
      },
      {
        nodeId: 'bookmark-1',
        title: 'GitHub',
        url: 'https://github.com',
      }
    );

    const mdnBookmark = await this.createBookmark(
      {
        id: 'bookmark-2',
        parentId: 'folder-1',
        createdAt: now,
        updatedAt: now,
        orderKey: '1',
      },
      {
        nodeId: 'bookmark-2',
        title: 'MDN Web Docs',
        url: 'https://developer.mozilla.org',
      }
    );

    const stackoverflowBookmark = await this.createBookmark(
      {
        id: 'bookmark-3',
        parentId: 'folder-1',
        createdAt: now,
        updatedAt: now,
        orderKey: '2',
      },
      {
        nodeId: 'bookmark-3',
        title: 'Stack Overflow',
        url: 'https://stackoverflow.com',
      }
    );

    const figmaBookmark = await this.createBookmark(
      {
        id: 'bookmark-4',
        parentId: 'folder-2',
        createdAt: now,
        updatedAt: now,
        orderKey: '1',
      },
      {
        nodeId: 'bookmark-4',
        title: 'Figma',
        url: 'https://figma.com',
      }
    );

    // Create initial operations for each node creation
    const sampleNodes = [rootFolder, devFolder, designFolder, githubBookmark, mdnBookmark, stackoverflowBookmark, figmaBookmark];
    const createOperations: NewOperation[] = sampleNodes.map(node => ({
      id: `op-create-${node.id}`,
      type: 'create',
      nodeId: node.id,
      data: JSON.stringify(node),
      timestamp: now,
      deviceId: 'server-init',
      sessionId: 'initial-setup',
    }));

    await db.insert(operations).values(createOperations);
  }
}
