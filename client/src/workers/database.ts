/**
 * Dexie database configuration for bookmark persistence
 * Handles IndexedDB operations in the SharedWorker
 */

import Dexie, { type Table } from 'dexie';
import type { TreeNode, NodeId } from '../lib/bookmarksTree';
import type { OperationEnvelope, TreeOperation } from '../lib/treeOps';

// Database interfaces
export interface StoredNode {
  id: NodeId;
  kind: 'bookmark' | 'folder';
  title: string;
  parentId: NodeId | null;
  orderKey?: string;
  url?: string; // for bookmarks
  isOpen?: boolean; // for folders
  updatedAt: number;
  createdAt: number;
}

export interface StoredOperation {
  dbId?: number; // auto-incrementing database ID
  id: string; // operation envelope ID
  ts: number; // operation timestamp
  op: TreeOperation; // the actual operation data
  processedAt: number;
  status: 'completed' | 'pending' | 'failed';
  retryCount?: number;
  errorMessage?: string;
}

// Database schema
export class BookmarkDatabase extends Dexie {
  // Node storage table
  nodes!: Table<StoredNode, NodeId>;
  
  // Operation log table  
  operationLog!: Table<StoredOperation, number>;

  constructor() {
    super('BookmarkDatabase');
    
    this.version(1).stores({
      // Nodes table with indexes for efficient querying
      nodes: 'id, parentId, updatedAt, createdAt, kind',
      
      // Operation log with auto-incrementing dbId
      operationLog: '++dbId, id, ts, processedAt, status'
    });
  }
}

// Create database instance
export const db = new BookmarkDatabase();

// Database service class
export class DatabaseService {
  private db: BookmarkDatabase;

  constructor(database: BookmarkDatabase = db) {
    this.db = database;
  }

  // Node operations
  async saveNode(node: TreeNode): Promise<void> {
    const storedNode: StoredNode = {
      id: node.id,
      kind: node.kind,
      title: node.title,
      parentId: node.parentId,
      orderKey: node.orderKey,
      url: node.kind === 'bookmark' ? node.url : undefined,
      isOpen: node.kind === 'folder' ? node.isOpen : undefined,
      updatedAt: Date.now(),
      createdAt: Date.now()
    };
    
    await this.db.nodes.put(storedNode);
  }

  async saveNodes(nodes: TreeNode[]): Promise<void> {
    const timestamp = Date.now();
    const storedNodes: StoredNode[] = nodes.map(node => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      parentId: node.parentId,
      orderKey: node.orderKey,
      url: node.kind === 'bookmark' ? node.url : undefined,
      isOpen: node.kind === 'folder' ? node.isOpen : undefined,
      updatedAt: timestamp,
      createdAt: timestamp
    }));

    await this.db.transaction('rw', this.db.nodes, async () => {
      for (const node of storedNodes) {
        await this.db.nodes.put(node);
      }
    });
  }

  async loadNodes(): Promise<StoredNode[]> {
    return await this.db.nodes.toArray();
  }

  async getNode(nodeId: NodeId): Promise<StoredNode | undefined> {
    return await this.db.nodes.get(nodeId);
  }

  async deleteNode(nodeId: NodeId): Promise<void> {
    await this.db.nodes.delete(nodeId);
  }

  async getChildren(parentId: NodeId): Promise<StoredNode[]> {
    return await this.db.nodes
      .where('parentId')
      .equals(parentId)
      .toArray();
  }

  // Operation log operations
  async appendOperation(operation: OperationEnvelope): Promise<number> {
    const storedOperation: StoredOperation = {
      id: operation.id,
      ts: operation.ts,
      op: operation.op,
      processedAt: Date.now(),
      status: 'completed'
    };

    return await this.db.operationLog.add(storedOperation);
  }

  async loadOperationLog(): Promise<StoredOperation[]> {
    return await this.db.operationLog
      .orderBy('ts')
      .toArray();
  }

  async getOperationsSince(timestamp: number): Promise<StoredOperation[]> {
    return await this.db.operationLog
      .where('processedAt')
      .above(timestamp)
      .toArray();
  }

  // Database management
  async clear(): Promise<void> {
    await this.db.transaction('rw', [this.db.nodes, this.db.operationLog], async () => {
      await this.db.nodes.clear();
      await this.db.operationLog.clear();
    });
  }

  async getStats(): Promise<{ nodeCount: number; operationCount: number }> {
    const [nodeCount, operationCount] = await Promise.all([
      this.db.nodes.count(),
      this.db.operationLog.count()
    ]);

    return { nodeCount, operationCount };
  }
}

// Export singleton instance
export const databaseService = new DatabaseService();
