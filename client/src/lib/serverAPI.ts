/**
 * Server API interface for fetching bookmark data
 * This is a dummy implementation that will be replaced with actual server communication
 */

import type { BookmarkTreeNode, NodeId } from './tree';

interface NodeWithChildren {
  node: Partial<BookmarkTreeNode>; // Server returns partial data to update existing node
  children: BookmarkTreeNode[];
}

/**
 * Dummy implementation of server API for fetching node data
 * This simulates server communication and should be replaced with actual HTTP/fetch calls
 */
export class ServerAPI {
  /**
   * Fetch a node and its children from the server
   * @param nodeId - The ID of the node to fetch
   * @returns Promise containing the node data and its children
   */
  static async fetchNodeWithChildren(nodeId: NodeId): Promise<NodeWithChildren> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));
    
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
   * Real implementation would make an HTTP request like this:
   * 
   * static async fetchNodeWithChildren(nodeId: NodeId): Promise<NodeWithChildren> {
   *   const response = await fetch(`/api/bookmarks/${nodeId}/children`);
   *   if (!response.ok) {
   *     throw new Error(`Failed to fetch node data: ${response.statusText}`);
   *   }
   *   return response.json();
   * }
   */
}
