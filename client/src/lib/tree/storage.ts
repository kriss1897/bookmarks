/**
 * Abstract storage interface for tree nodes.
 * Supports granular get/set operations for individual nodes.
 */

import type { BaseTreeNode, NodeId } from './types';

export interface StorageStats {
  nodeCount: number;
  lastModified: number;
}

/**
 * Abstract storage interface for tree nodes
 */
export abstract class TreeNodeStorage<T extends BaseTreeNode = BaseTreeNode> {
  /**
   * Get a single node by ID
   */
  abstract getNode(id: NodeId): Promise<T | null>;
  
  /**
   * Get multiple nodes by IDs
   */
  abstract getNodes(ids: NodeId[]): Promise<Map<NodeId, T>>;
  
  /**
   * Set/update a single node
   */
  abstract setNode(node: T): Promise<void>;
  
  /**
   * Set/update multiple nodes
   */
  abstract setNodes(nodes: T[]): Promise<void>;
  
  /**
   * Remove a single node
   */
  abstract removeNode(id: NodeId): Promise<void>;
  
  /**
   * Remove multiple nodes
   */
  abstract removeNodes(ids: NodeId[]): Promise<void>;
  
  /**
   * Get all nodes (for full tree loading)
   */
  abstract getAllNodes(): Promise<Map<NodeId, T>>;
  
  /**
   * Clear all nodes
   */
  abstract clear(): Promise<void>;
  
  /**
   * Get storage statistics
   */
  abstract getStats(): Promise<StorageStats>;
  
  /**
   * Check if storage is ready
   */
  abstract isReady(): Promise<boolean>;
  
  /**
   * Get the root node ID
   */
  abstract getRootId(): Promise<NodeId | null>;
  
  /**
   * Set the root node ID
   */
  abstract setRootId(rootId: NodeId): Promise<void>;
  
  /**
   * Get children IDs for a parent node
   */
  abstract getChildrenIds(parentId: NodeId): Promise<NodeId[]>;
}

/**
 * In-memory storage implementation
 */
export class MemoryTreeStorage<T extends BaseTreeNode = BaseTreeNode> extends TreeNodeStorage<T> {
  private nodes = new Map<NodeId, T>();
  private rootId: NodeId | null = null;
  
  async getNode(id: NodeId): Promise<T | null> {
    return this.nodes.get(id) || null;
  }
  
  async getNodes(ids: NodeId[]): Promise<Map<NodeId, T>> {
    const result = new Map<NodeId, T>();
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node) {
        result.set(id, node);
      }
    }
    return result;
  }
  
  async setNode(node: T): Promise<void> {
    this.nodes.set(node.id, { ...node });
  }
  
  async setNodes(nodes: T[]): Promise<void> {
    for (const node of nodes) {
      this.nodes.set(node.id, { ...node });
    }
  }
  
  async removeNode(id: NodeId): Promise<void> {
    this.nodes.delete(id);
  }
  
  async removeNodes(ids: NodeId[]): Promise<void> {
    for (const id of ids) {
      this.nodes.delete(id);
    }
  }
  
  async getAllNodes(): Promise<Map<NodeId, T>> {
    return new Map(this.nodes);
  }
  
  async clear(): Promise<void> {
    this.nodes.clear();
    this.rootId = null;
  }
  
  async getStats(): Promise<StorageStats> {
    let lastModified = 0;
    for (const node of this.nodes.values()) {
      if (node.updatedAt > lastModified) {
        lastModified = node.updatedAt;
      }
    }
    
    return {
      nodeCount: this.nodes.size,
      lastModified
    };
  }
  
  async isReady(): Promise<boolean> {
    return true;
  }
  
  async getRootId(): Promise<NodeId | null> {
    return this.rootId;
  }
  
  async setRootId(rootId: NodeId): Promise<void> {
    this.rootId = rootId;
  }
  
  async getChildrenIds(parentId: NodeId): Promise<NodeId[]> {
    const children: NodeId[] = [];
    for (const node of this.nodes.values()) {
      if (node.parentId === parentId) {
        children.push(node.id);
      }
    }
    return children;
  }
}

/**
 * IndexedDB storage implementation
 */
export class IndexedDBTreeStorage<T extends BaseTreeNode = BaseTreeNode> extends TreeNodeStorage<T> {
  private dbName: string;
  private version: number;
  private db: IDBDatabase | null = null;
  
  constructor(dbName: string = 'TreeStorage', version: number = 1) {
    super();
    this.dbName = dbName;
    this.version = version;
  }
  
  private async ensureDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create nodes object store
        if (!db.objectStoreNames.contains('nodes')) {
          const nodeStore = db.createObjectStore('nodes', { keyPath: 'id' });
          nodeStore.createIndex('parentId', 'parentId', { unique: false });
        }
        
        // Create metadata object store for root ID and other metadata
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }
  
  async getNode(id: NodeId): Promise<T | null> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes'], 'readonly');
      const store = transaction.objectStore('nodes');
      const request = store.get(id);
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  
  async getNodes(ids: NodeId[]): Promise<Map<NodeId, T>> {
    const db = await this.ensureDB();
    const result = new Map<NodeId, T>();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes'], 'readonly');
      const store = transaction.objectStore('nodes');
      let completed = 0;
      
      if (ids.length === 0) {
        resolve(result);
        return;
      }
      
      for (const id of ids) {
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result) {
            result.set(id, request.result);
          }
          completed++;
          if (completed === ids.length) {
            resolve(result);
          }
        };
        request.onerror = () => reject(request.error);
      }
    });
  }
  
  async setNode(node: T): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes'], 'readwrite');
      const store = transaction.objectStore('nodes');
      const request = store.put(node);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async setNodes(nodes: T[]): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes'], 'readwrite');
      const store = transaction.objectStore('nodes');
      let completed = 0;
      
      if (nodes.length === 0) {
        resolve();
        return;
      }
      
      for (const node of nodes) {
        const request = store.put(node);
        request.onsuccess = () => {
          completed++;
          if (completed === nodes.length) {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      }
    });
  }
  
  async removeNode(id: NodeId): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes'], 'readwrite');
      const store = transaction.objectStore('nodes');
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async removeNodes(ids: NodeId[]): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes'], 'readwrite');
      const store = transaction.objectStore('nodes');
      let completed = 0;
      
      if (ids.length === 0) {
        resolve();
        return;
      }
      
      for (const id of ids) {
        const request = store.delete(id);
        request.onsuccess = () => {
          completed++;
          if (completed === ids.length) {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      }
    });
  }
  
  async getAllNodes(): Promise<Map<NodeId, T>> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes'], 'readonly');
      const store = transaction.objectStore('nodes');
      const request = store.getAll();
      
      request.onsuccess = () => {
        const result = new Map<NodeId, T>();
        for (const node of request.result) {
          result.set(node.id, node);
        }
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  async clear(): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes', 'metadata'], 'readwrite');
      
      const nodeStore = transaction.objectStore('nodes');
      const metadataStore = transaction.objectStore('metadata');
      
      nodeStore.clear();
      metadataStore.clear();
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
  
  async getStats(): Promise<StorageStats> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes'], 'readonly');
      const store = transaction.objectStore('nodes');
      const countRequest = store.count();
      const getAllRequest = store.getAll();
      
      let count = 0;
      let lastModified = 0;
      
      countRequest.onsuccess = () => {
        count = countRequest.result;
      };
      
      getAllRequest.onsuccess = () => {
        for (const node of getAllRequest.result) {
          if (node.updatedAt > lastModified) {
            lastModified = node.updatedAt;
          }
        }
        
        resolve({
          nodeCount: count,
          lastModified
        });
      };
      
      transaction.onerror = () => reject(transaction.error);
    });
  }
  
  async isReady(): Promise<boolean> {
    try {
      await this.ensureDB();
      return true;
    } catch (error) {
      console.error('IndexedDB not ready:', error);
      return false;
    }
  }
  
  async getRootId(): Promise<NodeId | null> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['metadata'], 'readonly');
      const store = transaction.objectStore('metadata');
      const request = store.get('rootId');
      
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : null);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  async setRootId(rootId: NodeId): Promise<void> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['metadata'], 'readwrite');
      const store = transaction.objectStore('metadata');
      const request = store.put({ key: 'rootId', value: rootId });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getChildrenIds(parentId: NodeId): Promise<NodeId[]> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nodes'], 'readonly');
      const store = transaction.objectStore('nodes');
      const index = store.index('parentId');
      const request = index.getAll(parentId);
      
      request.onsuccess = () => {
        const children = request.result.map((node: T) => node.id);
        resolve(children);
      };
      request.onerror = () => reject(request.error);
    });
  }
}
