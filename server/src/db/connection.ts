import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import { setupDatabase } from './setup.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const databasePath = join(__dirname, '../../data/bookmarks.db');

// Create SQLite database connection
const sqlite = new Database(databasePath);

// Enable foreign keys and WAL mode for better performance
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Initialize database using the setup script
export async function initializeDatabase() {
  try {
    await setupDatabase(databasePath);
    
    // Verify connection works
    const result = sqlite.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get() as { count: number };
    console.log(`✅ Database connection verified. Found ${result.count} tables.`);
    
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// Graceful shutdown
export function closeDatabase() {
  sqlite.close();
}
