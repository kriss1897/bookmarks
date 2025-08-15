/**
 * Factory functions for creating tree instances with different storage backends
 */

import { BookmarkTree, type BookmarkTreeConfig, type BookmarkTreeNode } from './BookmarkTree';
import { MemoryTreeStorage } from './storage';

/**
 * Create a BookmarkTree with in-memory storage
 */
export function createMemoryBookmarkTree(config: BookmarkTreeConfig = {}): BookmarkTree {
  const storage = new MemoryTreeStorage<BookmarkTreeNode>();
  return new BookmarkTree(storage, config);
}
