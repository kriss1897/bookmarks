import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { nodes } from './nodes.js';

export const bookmarks = sqliteTable('bookmarks', {
  nodeId: text('node_id').primaryKey().references(() => nodes.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  icon: text('icon'),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
});

export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;
