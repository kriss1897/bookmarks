import { db } from './index.js';
import { sql } from 'drizzle-orm';

async function runCustomMigration() {
  try {
    console.log('Running custom namespace migration...');
    
    // Create new tables with namespace support
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS nodes_new (
        id text PRIMARY KEY NOT NULL,
        namespace text NOT NULL,
        parent_id text,
        kind text NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        order_key text
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS operations_new (
        id text PRIMARY KEY NOT NULL,
        namespace text NOT NULL,
        type text NOT NULL,
        node_id text NOT NULL,
        data text,
        timestamp integer NOT NULL,
        device_id text,
        session_id text
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS sync_metadata_new (
        id text PRIMARY KEY NOT NULL,
        namespace text NOT NULL,
        last_sync_timestamp integer,
        last_operation_id text,
        device_id text NOT NULL,
        version integer NOT NULL DEFAULT 1
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS tree_snapshots_new (
        id text PRIMARY KEY NOT NULL,
        namespace text NOT NULL,
        root_id text NOT NULL,
        data text NOT NULL,
        timestamp integer NOT NULL,
        version integer NOT NULL
      )
    `);

    // Copy data from old tables with default namespace 'default'
    await db.run(sql`
      INSERT INTO nodes_new (id, namespace, parent_id, kind, created_at, updated_at, order_key)
      SELECT id, 'default', parent_id, kind, created_at, updated_at, order_key FROM nodes
    `);

    await db.run(sql`
      INSERT INTO operations_new (id, namespace, type, node_id, data, timestamp, device_id, session_id)
      SELECT id, 'default', type, node_id, data, timestamp, device_id, session_id FROM operations
    `);

    await db.run(sql`
      INSERT INTO sync_metadata_new (id, namespace, last_sync_timestamp, last_operation_id, device_id, version)
      SELECT id, 'default', last_sync_timestamp, last_operation_id, device_id, version FROM sync_metadata
    `);

    await db.run(sql`
      INSERT INTO tree_snapshots_new (id, namespace, root_id, data, timestamp, version)
      SELECT id, 'default', root_id, data, timestamp, version FROM tree_snapshots
    `);

    // Drop old tables
    await db.run(sql`DROP TABLE nodes`);
    await db.run(sql`DROP TABLE operations`);
    await db.run(sql`DROP TABLE sync_metadata`);
    await db.run(sql`DROP TABLE tree_snapshots`);

    // Rename new tables to original names
    await db.run(sql`ALTER TABLE nodes_new RENAME TO nodes`);
    await db.run(sql`ALTER TABLE operations_new RENAME TO operations`);
    await db.run(sql`ALTER TABLE sync_metadata_new RENAME TO sync_metadata`);
    await db.run(sql`ALTER TABLE tree_snapshots_new RENAME TO tree_snapshots`);

    console.log('Custom namespace migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

runCustomMigration().catch(console.error);
