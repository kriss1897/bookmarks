import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Database Setup
 * 
 * This script creates a fresh database with UUID-based schema
 */

export async function setupDatabase(dbPath?: string): Promise<void> {
  const databasePath = dbPath || join(__dirname, '../../data/bookmarks.db');
  
  // Ensure data directory exists
  const dataDir = dirname(databasePath);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`📁 Created data directory: ${dataDir}`);
  }

  console.log('🚀 Starting database setup...');
  console.log(`📄 Database path: ${databasePath}`);

  // Create or recreate database
  await createDatabase(databasePath);

  console.log('🎉 Database setup completed successfully!');
}

async function createDatabase(dbPath: string): Promise<void> {
  console.log('🆕 Creating database');
  
  const sqlite = new Database(dbPath);
  
  // Enable foreign keys and WAL mode
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');

  // Create tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('folder', 'bookmark')),
      parent_id TEXT,
      order_index TEXT NOT NULL DEFAULT 'a0',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE,
      CHECK (length(order_index) > 0)
    );

    CREATE TABLE IF NOT EXISTS folder (
      node_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      node_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      icon TEXT,
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS folder_state (
      namespace TEXT NOT NULL,
      node_id TEXT NOT NULL,
      open INTEGER NOT NULL DEFAULT 1 CHECK (open IN (0, 1)),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (namespace, node_id),
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS operation_log (
      id TEXT PRIMARY KEY,
      operation_type TEXT NOT NULL,
      namespace TEXT NOT NULL,
      client_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0 CHECK (processed IN (0, 1)),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Performance indexes
    CREATE INDEX IF NOT EXISTS idx_nodes_namespace_parent ON nodes(namespace, parent_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_namespace_parent_order ON nodes(namespace, parent_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);
    CREATE INDEX IF NOT EXISTS idx_nodes_namespace ON nodes(namespace);
    CREATE INDEX IF NOT EXISTS idx_folder_state_namespace ON folder_state(namespace);
    CREATE INDEX IF NOT EXISTS idx_operation_log_namespace ON operation_log(namespace);
    CREATE INDEX IF NOT EXISTS idx_operation_log_client_id ON operation_log(client_id);

    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_info (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    INSERT OR IGNORE INTO schema_info (key, value) VALUES ('version', 'uuid-1.0');
    INSERT OR IGNORE INTO schema_info (key, value) VALUES ('created_at', datetime('now'));
  `);

  sqlite.close();
  console.log('✅ Database created');
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.argv[2];
  
  setupDatabase(dbPath)
    .then(() => {
      console.log('Database setup completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Database setup failed:', error);
      process.exit(1);
    });
}
