import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Forward declare nodes for self-references
const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(), // Changed from integer with autoIncrement to text for UUIDs
  namespace: text('namespace').notNull(),
  type: text('type', { enum: ['folder', 'bookmark'] }).notNull(),
  parentId: text('parent_id'), // Changed from integer to text
  prevSiblingId: text('prev_sibling_id'), // Changed from integer to text
  nextSiblingId: text('next_sibling_id'), // Changed from integer to text
  createdAt: integer('created_at').notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export { nodes };

// Folder-specific data
export const folders = sqliteTable('folder', {
  nodeId: text('node_id').primaryKey().references(() => nodes.id, { onDelete: 'cascade' }), // Changed from integer to text
  name: text('name').notNull(),
});

// Bookmark-specific data
export const bookmarks = sqliteTable('bookmarks', {
  nodeId: text('node_id').primaryKey().references(() => nodes.id, { onDelete: 'cascade' }), // Changed from integer to text
  title: text('title').notNull(),
  url: text('url').notNull(),
  icon: text('icon'),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
});

// Folder UI state (open/closed) - separate from core entities
export const folderState = sqliteTable('folder_state', {
  namespace: text('namespace').notNull(),
  nodeId: text('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }), // Changed from integer to text
  open: integer('open', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (table) => ({
  pk: primaryKey({ columns: [table.namespace, table.nodeId] })
}));

// Relations
export const nodesRelations = relations(nodes, ({ one, many }) => ({
  parent: one(nodes, {
    fields: [nodes.parentId],
    references: [nodes.id],
    relationName: 'parent',
  }),
  children: many(nodes, {
    relationName: 'parent',
  }),
  prevSibling: one(nodes, {
    fields: [nodes.prevSiblingId],
    references: [nodes.id],
    relationName: 'prevSibling',
  }),
  nextSibling: one(nodes, {
    fields: [nodes.nextSiblingId],
    references: [nodes.id],
    relationName: 'nextSibling',
  }),
  folder: one(folders, {
    fields: [nodes.id],
    references: [folders.nodeId],
  }),
  bookmark: one(bookmarks, {
    fields: [nodes.id],
    references: [bookmarks.nodeId],
  }),
  folderState: one(folderState, {
    fields: [nodes.id],
    references: [folderState.nodeId],
  }),
}));

export const foldersRelations = relations(folders, ({ one }) => ({
  node: one(nodes, {
    fields: [folders.nodeId],
    references: [nodes.id],
  }),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  node: one(nodes, {
    fields: [bookmarks.nodeId],
    references: [nodes.id],
  }),
}));

export const folderStateRelations = relations(folderState, ({ one }) => ({
  node: one(nodes, {
    fields: [folderState.nodeId],
    references: [nodes.id],
  }),
}));

// Type exports
export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;
export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;
export type FolderState = typeof folderState.$inferSelect;
export type NewFolderState = typeof folderState.$inferInsert;
