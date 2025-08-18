/**
 * Tree system - general tree implementation with pluggable storage
 */

// Core types
export type {
  BaseTreeNode,
  NodeId,
  SerializedTree,
  TreeConfig,
  TreeChangeEvent,
  TreeChangeListener,
} from "./types";

// Storage interfaces and implementations
export {
  TreeNodeStorage,
  MemoryTreeStorage,
  IndexedDBTreeStorage,
  type StorageStats,
} from "./storage";

// General tree class
export { Tree, generateId } from "./Tree";

// Bookmark-specific tree
export {
  BookmarkTree,
  isFolder,
  isBookmark,
  type BookmarkTreeNode,
  type BookmarkNode,
  type FolderNode,
  type BookmarkTreeConfig,
} from "./BookmarkTree";

// Factory functions
export { createMemoryBookmarkTree } from "./factory";
