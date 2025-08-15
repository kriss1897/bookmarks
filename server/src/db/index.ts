import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite database
const dbPath = path.resolve(__dirname, '../../data/bookmarks.db');
const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent access
sqlite.pragma('journal_mode = WAL');

// Create drizzle instance
export const db = drizzle(sqlite, { schema });

// Auto-migrate on startup
export async function initializeDatabase() {
  try {
    await migrate(db, { 
      migrationsFolder: path.resolve(__dirname, './migrations') 
    });
    console.log('✅ Database migrations completed');
  } catch (error: any) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Close database connection
export function closeDatabase() {
  sqlite.close();
}

export { schema };
