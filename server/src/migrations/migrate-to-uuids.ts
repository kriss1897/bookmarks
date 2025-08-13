import { db } from '../db/connection.js';
import { nodes, folders, bookmarks, folderState } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Database Migration: Convert Integer IDs to UUIDs
 * 
 * This migration converts all integer-based IDs in the database to UUIDs
 * while preserving all relationships and data integrity.
 * 
 * WARNING: This is a destructive migration. Always backup your database first!
 */

interface NodeWithOldId {
  old_id: number;
  new_id: string;
  namespace: string;
  type: 'folder' | 'bookmark';
  parentId: number | null;
  prevSiblingId: number | null;
  nextSiblingId: number | null;
  createdAt: number;
  updatedAt: number;
}

interface FolderWithOldId {
  nodeId: number;
  name: string;
}

interface BookmarkWithOldId {
  nodeId: number;
  title: string;
  url: string;
  icon: string | null;
  favorite: boolean;
}

interface FolderStateWithOldId {
  namespace: string;
  nodeId: number;
  open: boolean;
  updatedAt: number;
}

export async function migrateToUUIDs(): Promise<void> {
  console.log('🚀 Starting migration from integer IDs to UUIDs...');
  
  try {
    // Step 1: Create backup tables with UUID structure
    console.log('📋 Step 1: Creating backup tables...');
    await createBackupTables();
    
    // Step 2: Backup existing data
    console.log('💾 Step 2: Backing up existing data...');
    const backupData = await backupExistingData();
    
    // Step 3: Clear existing tables
    console.log('🗑️ Step 3: Clearing existing tables...');
    await clearExistingTables();
    
    // Step 4: Recreate tables with UUID schema (already done via schema.ts)
    console.log('🏗️ Step 4: Tables already have UUID schema...');
    
    // Step 5: Generate UUID mappings
    console.log('🔗 Step 5: Generating UUID mappings...');
    const idMappings = generateIdMappings(backupData.nodes);
    
    // Step 6: Migrate data with new UUIDs
    console.log('📤 Step 6: Migrating data with UUIDs...');
    await migrateDataWithUUIDs(backupData, idMappings);
    
    // Step 7: Verify migration
    console.log('✅ Step 7: Verifying migration...');
    await verifyMigration(backupData, idMappings);
    
    // Step 8: Cleanup backup tables
    console.log('🧹 Step 8: Cleaning up backup tables...');
    await cleanupBackupTables();
    
    console.log('🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('🔄 Attempting rollback...');
    await rollbackMigration();
    throw error;
  }
}

async function createBackupTables(): Promise<void> {
  // Create backup tables with original schema
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS nodes_backup (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      namespace TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('folder', 'bookmark')),
      parent_id INTEGER REFERENCES nodes_backup(id) ON DELETE CASCADE,
      prev_sibling_id INTEGER REFERENCES nodes_backup(id) ON DELETE SET NULL,
      next_sibling_id INTEGER REFERENCES nodes_backup(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS folders_backup (
      node_id INTEGER PRIMARY KEY REFERENCES nodes_backup(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );
  `);
  
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS bookmarks_backup (
      node_id INTEGER PRIMARY KEY REFERENCES nodes_backup(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      icon TEXT,
      favorite BOOLEAN NOT NULL DEFAULT false
    );
  `);
  
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS folder_state_backup (
      namespace TEXT NOT NULL,
      node_id INTEGER NOT NULL REFERENCES nodes_backup(id) ON DELETE CASCADE,
      open BOOLEAN NOT NULL DEFAULT true,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (namespace, node_id)
    );
  `);
}

async function backupExistingData(): Promise<{
  nodes: NodeWithOldId[];
  folders: FolderWithOldId[];
  bookmarks: BookmarkWithOldId[];
  folderStates: FolderStateWithOldId[];
}> {
  // Backup existing data to backup tables and return in-memory copies
  await db.run(sql`INSERT INTO nodes_backup SELECT * FROM nodes;`);
  await db.run(sql`INSERT INTO folders_backup SELECT * FROM folder;`);
  await db.run(sql`INSERT INTO bookmarks_backup SELECT * FROM bookmarks;`);
  await db.run(sql`INSERT INTO folder_state_backup SELECT * FROM folder_state;`);
  
  // Get data for processing
  const nodes = await db.all(sql`
    SELECT 
      id as old_id,
      '' as new_id,
      namespace,
      type,
      parent_id as parentId,
      prev_sibling_id as prevSiblingId,
      next_sibling_id as nextSiblingId,
      created_at as createdAt,
      updated_at as updatedAt
    FROM nodes_backup
  `) as NodeWithOldId[];
  
  const folders = await db.all(sql`
    SELECT node_id as nodeId, name 
    FROM folders_backup
  `) as FolderWithOldId[];
  
  const bookmarks = await db.all(sql`
    SELECT node_id as nodeId, title, url, icon, favorite 
    FROM bookmarks_backup
  `) as BookmarkWithOldId[];
  
  const folderStates = await db.all(sql`
    SELECT namespace, node_id as nodeId, open, updated_at as updatedAt 
    FROM folder_state_backup
  `) as FolderStateWithOldId[];
  
  return { nodes, folders, bookmarks, folderStates };
}

async function clearExistingTables(): Promise<void> {
  // Clear tables in order to avoid foreign key constraints
  await db.run(sql`DELETE FROM folder_state;`);
  await db.run(sql`DELETE FROM bookmarks;`);
  await db.run(sql`DELETE FROM folder;`);
  await db.run(sql`DELETE FROM nodes;`);
}

function generateIdMappings(nodes: NodeWithOldId[]): Map<number, string> {
  const mappings = new Map<number, string>();
  
  for (const node of nodes) {
    mappings.set(node.old_id, randomUUID());
  }
  
  return mappings;
}

async function migrateDataWithUUIDs(
  backupData: {
    nodes: NodeWithOldId[];
    folders: FolderWithOldId[];
    bookmarks: BookmarkWithOldId[];
    folderStates: FolderStateWithOldId[];
  },
  idMappings: Map<number, string>
): Promise<void> {
  // Migrate nodes with UUID mappings
  for (const node of backupData.nodes) {
    const newId = idMappings.get(node.old_id)!;
    const newParentId = node.parentId ? idMappings.get(node.parentId) || null : null;
    const newPrevSiblingId = node.prevSiblingId ? idMappings.get(node.prevSiblingId) || null : null;
    const newNextSiblingId = node.nextSiblingId ? idMappings.get(node.nextSiblingId) || null : null;
    
    await db.run(sql`
      INSERT INTO nodes (id, namespace, type, parent_id, prev_sibling_id, next_sibling_id, created_at, updated_at)
      VALUES (${newId}, ${node.namespace}, ${node.type}, ${newParentId}, ${newPrevSiblingId}, ${newNextSiblingId}, ${node.createdAt}, ${node.updatedAt})
    `);
  }
  
  // Migrate folders
  for (const folder of backupData.folders) {
    const newNodeId = idMappings.get(folder.nodeId)!;
    await db.run(sql`
      INSERT INTO folder (node_id, name)
      VALUES (${newNodeId}, ${folder.name})
    `);
  }
  
  // Migrate bookmarks
  for (const bookmark of backupData.bookmarks) {
    const newNodeId = idMappings.get(bookmark.nodeId)!;
    await db.run(sql`
      INSERT INTO bookmarks (node_id, title, url, icon, favorite)
      VALUES (${newNodeId}, ${bookmark.title}, ${bookmark.url}, ${bookmark.icon}, ${bookmark.favorite})
    `);
  }
  
  // Migrate folder states
  for (const folderState of backupData.folderStates) {
    const newNodeId = idMappings.get(folderState.nodeId)!;
    await db.run(sql`
      INSERT INTO folder_state (namespace, node_id, open, updated_at)
      VALUES (${folderState.namespace}, ${newNodeId}, ${folderState.open}, ${folderState.updatedAt})
    `);
  }
}

async function verifyMigration(
  backupData: {
    nodes: NodeWithOldId[];
    folders: FolderWithOldId[];
    bookmarks: BookmarkWithOldId[];
    folderStates: FolderStateWithOldId[];
  },
  idMappings: Map<number, string>
): Promise<void> {
  // Verify counts match
  const newNodeCount = await db.get(sql`SELECT COUNT(*) as count FROM nodes`) as { count: number };
  const newFolderCount = await db.get(sql`SELECT COUNT(*) as count FROM folder`) as { count: number };
  const newBookmarkCount = await db.get(sql`SELECT COUNT(*) as count FROM bookmarks`) as { count: number };
  const newFolderStateCount = await db.get(sql`SELECT COUNT(*) as count FROM folder_state`) as { count: number };
  
  if (newNodeCount.count !== backupData.nodes.length) {
    throw new Error(`Node count mismatch: expected ${backupData.nodes.length}, got ${newNodeCount.count}`);
  }
  
  if (newFolderCount.count !== backupData.folders.length) {
    throw new Error(`Folder count mismatch: expected ${backupData.folders.length}, got ${newFolderCount.count}`);
  }
  
  if (newBookmarkCount.count !== backupData.bookmarks.length) {
    throw new Error(`Bookmark count mismatch: expected ${backupData.bookmarks.length}, got ${newBookmarkCount.count}`);
  }
  
  if (newFolderStateCount.count !== backupData.folderStates.length) {
    throw new Error(`Folder state count mismatch: expected ${backupData.folderStates.length}, got ${newFolderStateCount.count}`);
  }
  
  console.log(`✅ Verified: ${newNodeCount.count} nodes, ${newFolderCount.count} folders, ${newBookmarkCount.count} bookmarks, ${newFolderStateCount.count} folder states`);
}

async function cleanupBackupTables(): Promise<void> {
  await db.run(sql`DROP TABLE IF EXISTS folder_state_backup;`);
  await db.run(sql`DROP TABLE IF EXISTS bookmarks_backup;`);
  await db.run(sql`DROP TABLE IF EXISTS folders_backup;`);
  await db.run(sql`DROP TABLE IF EXISTS nodes_backup;`);
}

async function rollbackMigration(): Promise<void> {
  try {
    console.log('🔄 Rolling back migration...');
    
    // Clear current tables
    await clearExistingTables();
    
    // Restore from backup
    await db.run(sql`INSERT INTO nodes SELECT * FROM nodes_backup;`);
    await db.run(sql`INSERT INTO folder SELECT * FROM folders_backup;`);
    await db.run(sql`INSERT INTO bookmarks SELECT * FROM bookmarks_backup;`);
    await db.run(sql`INSERT INTO folder_state SELECT * FROM folder_state_backup;`);
    
    console.log('✅ Rollback completed successfully');
  } catch (rollbackError) {
    console.error('❌ Rollback failed:', rollbackError);
    console.log('💡 Manual database restoration may be required');
  }
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateToUUIDs()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
