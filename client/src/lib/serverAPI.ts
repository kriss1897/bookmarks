/**
 * Server API interface for fetching bookmark data
 * This is a dummy implementation that will be replaced with actual server communication
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
  failureRate: number; // 0-1, chance of simulated failures
  minDelay: number; // Minimum network delay in ms
  maxDelay: number; // Maximum network delay in ms
  timeout: number; // Request timeout in ms
}

const DEFAULT_CONFIG: ServerAPIConfig = {
  failureRate: 0.1, // 10% failure rate
  minDelay: 50,
  maxDelay: 200,
  timeout: 5000
};

/**
 * Dummy implementation of server API for fetching node data and applying operations
 * This simulates server communication and should be replaced with actual HTTP/fetch calls
 */
export class ServerAPI {
  private static config: ServerAPIConfig = DEFAULT_CONFIG;

  /**
   * Configure the mock server API behavior
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
    // Simulate network delay
    await this.simulateNetworkDelay(options?.signal);
    
    // For now, return dummy data
    // In real implementation, this would make an HTTP request to the server
    console.log(`[ServerAPI] Fetching node data for: ${nodeId}`);
    
    // Simulate some dummy children data
    const dummyChildren: BookmarkTreeNode[] = [
      {
        id: `${nodeId}_child_1`,
        kind: 'bookmark',
        title: `Bookmark in ${nodeId}`,
        url: 'https://example.com',
        parentId: nodeId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: `${nodeId}_child_2`,
        kind: 'folder',
        title: `Subfolder in ${nodeId}`,
        isOpen: false,
        isLoaded: false, // This subfolder hasn't been loaded yet
        children: [],
        parentId: nodeId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];
    
    // Return dummy node data (updated with any server-side changes)
    // NOTE: We should preserve the existing parentId and other critical properties
    const nodeData: Partial<BookmarkTreeNode> = {
      id: nodeId,
      kind: 'folder',
      title: `Updated ${nodeId}`, // Server might update the title
      isOpen: true,
      isLoaded: true, // Now it's loaded
      children: dummyChildren.map(child => child.id),
      // Do NOT set parentId here - let it be preserved from existing node
      // parentId: null, // This was causing the issue!
      updatedAt: Date.now()
    };
    
    return {
      node: nodeData,
      children: dummyChildren
    };
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

    // Simulate network delay
    await this.simulateNetworkDelay(options?.signal);
    
    console.log(`[ServerAPI] Applying operation to server:`, operation.id, operation.op.type);
    
    // Simulate occasional failures
    const shouldFail = Math.random() < this.config.failureRate;
    
    if (shouldFail) {
      console.warn(`[ServerAPI] Operation failed:`, operation.id);
      return {
        success: false,
        operationId: operation.id,
        error: 'Simulated server error'
      };
    }
    
    console.log(`[ServerAPI] Operation applied successfully:`, operation.id);
    return {
      success: true,
      operationId: operation.id,
      message: 'Operation applied successfully'
    };
  }

  /**
   * Simulate network delay with abort support
   */
  private static async simulateNetworkDelay(signal?: AbortSignal): Promise<void> {
    const delay = this.config.minDelay + Math.random() * (this.config.maxDelay - this.config.minDelay);
    
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(resolve, delay);
      
      // Handle abort signal
      const abortHandler = () => {
        clearTimeout(timeoutId);
        reject(new Error('Request aborted'));
      };
      
      if (signal?.aborted) {
        clearTimeout(timeoutId);
        reject(new Error('Request aborted'));
        return;
      }
      
      signal?.addEventListener('abort', abortHandler, { once: true });
      
      // Cleanup listener when promise resolves
      setTimeout(() => {
        signal?.removeEventListener('abort', abortHandler);
      }, delay);
    });
  }
  
  /**
   * Real implementation would make HTTP requests like this:
   * 
   * static async fetchNodeWithChildren(nodeId: NodeId, options?: { signal?: AbortSignal }): Promise<NodeWithChildren> {
   *   const response = await fetch(`/api/bookmarks/${nodeId}/children`, { signal: options?.signal });
   *   if (!response.ok) {
   *     throw new Error(`Failed to fetch node data: ${response.statusText}`);
   *   }
   *   return response.json();
   * }
   * 
   * static async applyOperation(operation: OperationEnvelope, options?: { signal?: AbortSignal }): Promise<OperationResult> {
   *   const response = await fetch('/api/operations', {
   *     method: 'POST',
   *     headers: { 'Content-Type': 'application/json' },
   *     body: JSON.stringify(operation),
   *     signal: options?.signal
   *   });
   *   if (!response.ok) {
   *     throw new Error(`Failed to apply operation: ${response.statusText}`);
   *   }
   *   return response.json();
   * }
   */
}
