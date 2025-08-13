import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { nodes } from './nodes.js';

export const folderState = sqliteTable('folder_state', {
  namespace: text('namespace').notNull(),
  nodeId: text('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  open: integer('open', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (table) => ({
  pk: primaryKey({ columns: [table.namespace, table.nodeId] })
}));

export type FolderState = typeof folderState.$inferSelect;
export type NewFolderState = typeof folderState.$inferInsert;
