/**
 * Factory functions for creating tree instances with different storage backends
 */

import { BookmarkTree, type BookmarkTreeConfig, type BookmarkTreeNode } from './BookmarkTree';
import { MemoryTreeStorage, IndexedDBTreeStorage } from './storage';

/**
 * Legacy tree data format for migration
 */
interface LegacyTreeData {
  rootId: string;
  nodes: Record<string, BookmarkTreeNode>;
}

/**
 * Create a BookmarkTree with in-memory storage
 */
export function createMemoryBookmarkTree(config: BookmarkTreeConfig = {}): BookmarkTree {
  const storage = new MemoryTreeStorage<BookmarkTreeNode>();
  return new BookmarkTree(storage, config);
}

/**
 * Create a BookmarkTree with IndexedDB storage
 */
export function createIndexedDBBookmarkTree(
  dbName: string = 'BookmarkTreeDB',
  version: number = 1,
  config: BookmarkTreeConfig = {}
): BookmarkTree {
  const storage = new IndexedDBTreeStorage<BookmarkTreeNode>(dbName, version);
  return new BookmarkTree(storage, config);
}

/**
 * Migrate data from old BookmarkTree format to new tree structure
 */
export async function migrateFromLegacyTree(
  legacyData: LegacyTreeData,
  targetTree: BookmarkTree
): Promise<void> {
  if (!legacyData || !legacyData.nodes || !legacyData.rootId) {
    throw new Error('Invalid legacy tree data');
  }

  // Initialize the new tree first
  await targetTree.initializeBookmarkTree();

  // Convert and migrate all nodes
  const nodesToMigrate: BookmarkTreeNode[] = [];
  
  for (const [id, node] of Object.entries(legacyData.nodes)) {
    // Skip the root node since it's already created
    if (id === legacyData.rootId) continue;
    
    nodesToMigrate.push(node);
  }

  // Sort nodes by dependency (parents before children)
  const sortedNodes = topologicalSort(nodesToMigrate);
  
  // Add nodes in dependency order
  for (const node of sortedNodes) {
    if (node.kind === 'folder') {
      await targetTree.createFolder({
        id: node.id,
        parentId: node.parentId || undefined,
        title: node.title,
        isOpen: node.isOpen
      });
    } else {
      await targetTree.createBookmark({
        id: node.id,
        parentId: node.parentId || undefined,
        title: node.title,
        url: node.url
      });
    }
  }
}

/**
 * Topological sort to ensure parents are processed before children
 */
function topologicalSort(nodes: BookmarkTreeNode[]): BookmarkTreeNode[] {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set<string>();
  const result: BookmarkTreeNode[] = [];
  
  function visit(nodeId: string) {
    if (visited.has(nodeId)) return;
    
    const node = nodeMap.get(nodeId);
    if (!node) return;
    
    // Visit parent first
    if (node.parentId && nodeMap.has(node.parentId)) {
      visit(node.parentId);
    }
    
    visited.add(nodeId);
    result.push(node);
  }
  
  for (const node of nodes) {
    visit(node.id);
  }
  
  return result;
}

/**
 * Create a tree with data from serialized format
 */
export async function createTreeFromSerialized(
  data: LegacyTreeData | null,
  useIndexedDB: boolean = false,
  dbName?: string
): Promise<BookmarkTree> {
  const tree = useIndexedDB 
    ? createIndexedDBBookmarkTree(dbName)
    : createMemoryBookmarkTree();
    
  if (data) {
    await migrateFromLegacyTree(data, tree);
  } else {
    await tree.initializeBookmarkTree();
  }
  
  return tree;
}
