import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '../data/bookmarks.db');
const sqlite = new Database(dbPath);

// Check existing tables
console.log('=== Existing Tables ===');
const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables);

// Check schema for each table
for (const table of tables as any[]) {
  console.log(`\n=== Schema for ${table.name} ===`);
  const schema = sqlite.prepare(`PRAGMA table_info(${table.name})`).all();
  console.log(schema);
}

sqlite.close();
