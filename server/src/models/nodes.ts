import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(),
  namespace: text('namespace').notNull(),
  type: text('type', { enum: ['folder', 'bookmark'] }).notNull(),
  parentId: text('parent_id'),
  orderIndex: text('order_index').notNull().default('a0'),
  createdAt: integer('created_at').notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;
