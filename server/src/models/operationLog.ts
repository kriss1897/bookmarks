import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const operationLog = sqliteTable('operation_log', {
  id: text('id').primaryKey(),
  operationType: text('operation_type').notNull(),
  namespace: text('namespace').notNull(),
  clientId: text('client_id').notNull(),
  timestamp: integer('timestamp').notNull(),
  processed: integer('processed', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at').default(sql`(strftime('%s', 'now'))`).notNull(),
});

export type OperationLog = typeof operationLog.$inferSelect;
export type NewOperationLog = typeof operationLog.$inferInsert;
