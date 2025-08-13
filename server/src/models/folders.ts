import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nodes } from './nodes.js';

export const folders = sqliteTable('folder', {
  nodeId: text('node_id').primaryKey().references(() => nodes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
});

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
