import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create SQLite database connection
const sqlite = new Database(join(__dirname, '../../data/bookmarks.db'));

// Enable foreign keys and WAL mode for better performance
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Initialize database (run migrations if needed)
export async function initializeDatabase() {
  try {
    // For now, we'll create tables manually since we don't have migrations set up
    // In production, you'd use proper migrations
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        namespace TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('folder', 'bookmark')),
        parent_id INTEGER,
        prev_sibling_id INTEGER,
        next_sibling_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (prev_sibling_id) REFERENCES nodes(id) ON DELETE SET NULL,
        FOREIGN KEY (next_sibling_id) REFERENCES nodes(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS folder (
        node_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        node_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        icon TEXT,
        favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS folder_state (
        namespace TEXT NOT NULL,
        node_id INTEGER NOT NULL,
        open INTEGER NOT NULL DEFAULT 1 CHECK (open IN (0, 1)),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (namespace, node_id),
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_nodes_namespace_parent ON nodes(namespace, parent_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_namespace_parent_prev ON nodes(namespace, parent_id, prev_sibling_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_namespace_parent_next ON nodes(namespace, parent_id, next_sibling_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_namespace_url ON bookmarks(url);
    `);

    console.log('Database initialized successfully');
    
    // Test that tables were created
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Created tables:', tables.map((t: any) => t.name));
    
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// Graceful shutdown
export function closeDatabase() {
  sqlite.close();
}
