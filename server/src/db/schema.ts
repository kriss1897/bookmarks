import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Base nodes table - stores common properties for all nodes
export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(),
  namespace: text('namespace').notNull(), // Namespace for the node
  parentId: text('parent_id'),
  kind: text('kind', { enum: ['bookmark', 'folder'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  orderKey: text('order_key'), // For fractional indexing
});

// Folders table - stores folder-specific properties
export const folders = sqliteTable('folders', {
  nodeId: text('node_id')
    .primaryKey()
    .references(() => nodes.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  isOpen: integer('is_open', { mode: 'boolean' }).notNull().default(true),
});

// Bookmarks table - stores bookmark-specific properties
export const bookmarks = sqliteTable('bookmarks', {
  nodeId: text('node_id')
    .primaryKey()
    .references(() => nodes.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  description: text('description'), // Optional description
  favicon: text('favicon'), // Optional favicon URL
});

// Operations table - stores all operations performed on the tree for syncing/undo
export const operations = sqliteTable('operations', {
  id: text('id').primaryKey(),
  namespace: text('namespace').notNull(), // Namespace for the operation
  type: text('type', {
    enum: ['create', 'update', 'delete', 'move'],
  }).notNull(),
  nodeId: text('node_id').notNull(),
  data: text('data'), // JSON string of the operation data
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  deviceId: text('device_id'), // To track which device made the change
  sessionId: text('session_id'), // To group related operations
});

// Tree snapshots table - for maintaining tree state at different points
export const treeSnapshots = sqliteTable('tree_snapshots', {
  id: text('id').primaryKey(),
  namespace: text('namespace').notNull(), // Namespace for the snapshot
  rootId: text('root_id').notNull(),
  data: text('data').notNull(), // JSON string of serialized tree
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  version: integer('version').notNull(),
});

// Sync metadata table - for tracking synchronization state
export const syncMetadata = sqliteTable('sync_metadata', {
  id: text('id').primaryKey(),
  namespace: text('namespace').notNull(), // Namespace for the sync metadata
  lastSyncTimestamp: integer('last_sync_timestamp', { mode: 'timestamp' }),
  lastOperationId: text('last_operation_id'),
  deviceId: text('device_id').notNull(),
  version: integer('version').notNull().default(1),
});

// Type definitions
export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;

export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;

export type Operation = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;

export type TreeSnapshot = typeof treeSnapshots.$inferSelect;
export type NewTreeSnapshot = typeof treeSnapshots.$inferInsert;

export type SyncMetadata = typeof syncMetadata.$inferSelect;
export type NewSyncMetadata = typeof syncMetadata.$inferInsert;

// Combined types for easier usage
export interface FolderWithNode extends Node {
  kind: 'folder';
  title: string;
  isOpen: boolean;
}

export interface BookmarkWithNode extends Node {
  kind: 'bookmark';
  title: string;
  url: string;
  description?: string;
  favicon?: string;
}

export type TreeNode = FolderWithNode | BookmarkWithNode;
