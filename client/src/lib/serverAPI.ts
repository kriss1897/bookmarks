/**
 * Server API interface for fetching bookmark data and applying operations
 */

import type { BookmarkTreeNode, NodeId } from './tree';
import type { OperationEnvelope } from './builder/treeBuilder';

interface NodeWithChildren {
  node: Partial<BookmarkTreeNode>; // Server returns partial data to update existing node
  children: BookmarkTreeNode[];
}

interface OperationResult {
  success: boolean;
  operationId: string;
  message?: string;
  error?: string;
}

interface ServerAPIConfig {
  baseURL: string;
  namespace: string;
  timeout: number;
}

const DEFAULT_CONFIG: ServerAPIConfig = {
  baseURL: 'http://localhost:5000',
  namespace: 'default',
  timeout: 5000
};

/**
 * Server API implementation using real HTTP calls
 */
export class ServerAPI {
  private static config: ServerAPIConfig = DEFAULT_CONFIG;

  /**
   * Configure the server API
   */
  static configure(config: Partial<ServerAPIConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fetch a node and its children from the server
   * @param nodeId - The ID of the node to fetch
   * @param options - Request options including abort signal
   * @returns Promise containing the node data and its children
   */
  static async fetchNodeWithChildren(
    nodeId: NodeId, 
    options?: { signal?: AbortSignal }
  ): Promise<NodeWithChildren> {
    const url = `${this.config.baseURL}/api/${this.config.namespace}/tree/node/${nodeId}`;
    
    console.log(`[ServerAPI] Fetching node data from: ${url}`);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: options?.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'Server returned error');
      }

      // Transform server response to expected format
      const serverData = result.data;
      const rootNodeId = serverData.rootId;
      const nodes = serverData.nodes;
      
      // Extract the main node
      const mainNode = nodes[rootNodeId];
      if (!mainNode) {
        throw new Error(`Root node ${rootNodeId} not found in response`);
      }

      // Extract ALL children from the server response (not just direct children)
      const children: BookmarkTreeNode[] = [];
      
      // Process all nodes except the main node
      for (const node of Object.values(nodes) as Record<string, unknown>[]) {
        if (node.id !== rootNodeId) {
          children.push(this.transformServerNode(node as Record<string, unknown>));
        }
      }

      // Transform main node to partial format for hydration
      // The children array for the main node should be only its direct children
      const directChildren = children.filter(child => child.parentId === rootNodeId);
      
      const nodeData: Partial<BookmarkTreeNode> = {
        id: mainNode.id,
        title: mainNode.title,
        updatedAt: mainNode.updatedAt,
        ...(mainNode.kind === 'folder' && { 
          isOpen: mainNode.isOpen,
          isLoaded: true,
          children: directChildren.map(child => child.id)
        }),
        ...(mainNode.kind === 'bookmark' && { 
          url: mainNode.url,
          description: mainNode.description,
          favicon: mainNode.favicon
        })
      };

      console.log(`[ServerAPI] Successfully fetched node ${nodeId} with ${children.length} total children (${directChildren.length} direct)`);

      return {
        node: nodeData,
        children // Return ALL children, not just direct children
      };

    } catch (error) {
      console.error(`[ServerAPI] Failed to fetch node ${nodeId}:`, error);
      throw error;
    }
  }

  /**
   * Transform server node format to client format
   */
  private static transformServerNode(serverNode: Record<string, unknown>): BookmarkTreeNode {
    const baseNode = {
      id: serverNode.id as string,
      parentId: serverNode.parentId as string | null,
      kind: serverNode.kind as 'bookmark' | 'folder',
      title: serverNode.title as string,
      createdAt: serverNode.createdAt as number,
      updatedAt: serverNode.updatedAt as number,
      orderKey: serverNode.orderKey as string
    };

    if (serverNode.kind === 'folder') {
      return {
        ...baseNode,
        kind: 'folder',
  isOpen: (serverNode.isOpen as boolean) || false,
  // Important: non-root folders included in another node's payload should NOT be marked loaded,
  // otherwise opening them won't trigger hydration. We'll mark only the main fetched node as loaded
  // via nodeData in fetchNodeWithChildren().
  isLoaded: false,
  // Children for non-root nodes will be populated on dedicated hydration for that node
  children: []
      };
    } else {
      return {
        ...baseNode,
        kind: 'bookmark',
        url: (serverNode.url as string) || ''
      };
    }
  }

  /**
   * Apply an operation to the server
   * @param operation - The operation envelope to apply
   * @param options - Request options including abort signal
   * @returns Promise containing the operation result
   */
  static async applyOperation(
    operation: OperationEnvelope,
    options?: { signal?: AbortSignal }
  ): Promise<OperationResult> {
    // Validate operation
    if (!operation?.id || !operation?.op?.type) {
      throw new Error('Invalid operation: missing id or operation type');
    }

    const url = `${this.config.baseURL}/api/${this.config.namespace}/operations/apply`;
    
    console.log(`[ServerAPI] Applying operation to server:`, operation.id, operation.op.type);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(operation),
        signal: options?.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        console.warn(`[ServerAPI] Server rejected operation ${operation.id}:`, result.error);
        return {
          success: false,
          operationId: operation.id,
          error: result.error || 'Server rejected operation'
        };
      }

      console.log(`[ServerAPI] Operation applied successfully:`, operation.id);
      return {
        success: true,
        operationId: operation.id,
        message: result.message || 'Operation applied successfully'
      };
      
    } catch (error) {
      console.error(`[ServerAPI] Failed to apply operation ${operation.id}:`, error);
      throw error;
    }
  }
}
