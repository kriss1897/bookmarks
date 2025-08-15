/**
 * Examples demonstrating how to use the new TreeBuilder architecture
 * This file shows various usage patterns and scenarios.
 */

import { 
  TreeBuilder, 
  createMemoryTreeBuilder, 
  createPersistentTreeBuilder,
  createTreeBuilderWithStorage,
  IndexedDBOperationStorage,
  type TreeBuilderConfig 
} from '../lib/treeBuilderFactory';
import { OperationStorage } from '../lib/storage';
import { databaseService } from '../workers/database';

// Example 1: Simple in-memory usage (operations are lost when app closes)
export function exampleInMemoryUsage() {
  console.log('=== Example 1: In-Memory Usage ===');
  
  const builder = createMemoryTreeBuilder({
    rootNode: { title: 'My Bookmarks', id: 'root', isOpen: true },
    autoLoad: false // No persistence, so no need to auto-load
  });

  // Create some content
  builder.createFolder({ title: 'Work', parentId: 'root' });
  builder.createFolder({ title: 'Personal', parentId: 'root' });
  
  const workFolderId = builder.tree.root?.children[0];
  if (workFolderId) {
    builder.createBookmark({
      title: 'GitHub',
      url: 'https://github.com',
      parentId: workFolderId
    });
  }

  console.log('Tree structure:', builder.tree.serialize());
  console.log('Operation log:', builder.log);
}

// Example 2: Persistent usage with IndexedDB (operations survive app restarts)
export async function examplePersistentUsage() {
  console.log('=== Example 2: Persistent Usage ===');
  
  const builder = createPersistentTreeBuilder({
    rootNode: { title: 'Persistent Bookmarks', id: 'root', isOpen: true }
    // autoLoad: true by default - will load from IndexedDB
  });

  // Wait for initialization to complete
  await builder.waitForInitialization();

  // Now we can safely use the builder
  const existingFolders = builder.tree.root?.children.length || 0;
  console.log(`Found ${existingFolders} existing folders`);

  // Add new content
  builder.createFolder({ title: `Folder ${Date.now()}`, parentId: 'root' });
  
  console.log('Updated tree:', builder.tree.serialize());
  console.log('Operations in log:', builder.log.length);
}

// Example 3: Custom storage implementation (localStorage)
class LocalStorageOperationStorage extends OperationStorage {
  private storageKey = 'tree-operations';

  async persistOperation(env: import('../lib/treeBuilder').OperationEnvelope): Promise<void> {
    const ops = await this.loadOperations();
    ops.push(env);
    localStorage.setItem(this.storageKey, JSON.stringify(ops));
    console.log(`[LocalStorage] Persisted operation: ${env.id}`);
  }

  async loadOperations(): Promise<import('../lib/treeBuilder').OperationEnvelope[]> {
    const stored = localStorage.getItem(this.storageKey);
    return stored ? JSON.parse(stored) : [];
  }

  async clearOperations(): Promise<void> {
    localStorage.removeItem(this.storageKey);
  }

  async isReady(): Promise<boolean> {
    return typeof localStorage !== 'undefined';
  }
}

export async function exampleCustomStorage() {
  console.log('=== Example 3: Custom Storage (localStorage) ===');
  
  const customStorage = new LocalStorageOperationStorage();
  
  const builder = createTreeBuilderWithStorage(customStorage, {
    rootNode: { title: 'LocalStorage Bookmarks', id: 'root', isOpen: true }
  });

  await builder.waitForInitialization();

  // Operations will be persisted to localStorage
  builder.createFolder({ title: 'Temp Folder', parentId: 'root' });
  builder.createBookmark({
    title: 'Example Site',
    url: 'https://example.com',
    parentId: 'root'
  });

  console.log('Tree with custom storage:', builder.tree.serialize());
}

// Example 4: Direct TreeBuilder usage with configuration
export async function exampleDirectUsage() {
  console.log('=== Example 4: Direct TreeBuilder Usage ===');
  
  const config: TreeBuilderConfig = {
    rootNode: { title: 'Direct Usage', id: 'root', isOpen: true },
    storage: new IndexedDBOperationStorage(databaseService),
    autoLoad: true
  };

  const builder = new TreeBuilder(config);
  await builder.waitForInitialization();

  // Get storage info
  const storage = builder.getStorage();
  const isReady = await storage.isReady();
  console.log('Storage is ready:', isReady);

  // Create operations
  builder.createFolder({ title: 'Direct Folder', parentId: 'root' });
  
  console.log('Direct usage result:', builder.tree.serialize());
}

// Example 5: Replaying operations from a log
export function exampleReplayOperations() {
  console.log('=== Example 5: Replaying Operations ===');
  
  // Sample operations (could come from server, file, etc.)
  const operations: import('../lib/treeBuilder').OperationEnvelope[] = [
    {
      id: 'op-1',
      ts: Date.now() - 3000,
      op: { type: 'create_folder', id: 'folder1', title: 'Replayed Folder', parentId: 'root' }
    },
    {
      id: 'op-2',
      ts: Date.now() - 2000,
      op: { type: 'create_bookmark', id: 'bookmark1', title: 'Replayed Bookmark', url: 'https://replay.com', parentId: 'folder1' }
    },
    {
      id: 'op-3',
      ts: Date.now() - 1000,
      op: { type: 'toggle_folder', folderId: 'folder1', open: false }
    }
  ];

  const builder = createMemoryTreeBuilder({
    rootNode: { title: 'Replay Root', id: 'root', isOpen: true },
    log: operations, // Pass operations directly to constructor
    autoLoad: false
  });

  console.log('Replayed tree:', builder.tree.serialize());
  console.log('Replayed operations:', builder.log.length);
}

// Example 6: Error handling and cleanup
export async function exampleErrorHandling() {
  console.log('=== Example 6: Error Handling ===');
  
  try {
    const builder = createPersistentTreeBuilder();
    await builder.waitForInitialization();

    // Perform operations...
    builder.createFolder({ title: 'Test Folder', parentId: 'root' });

    // Clear all persisted data for testing
    await builder.clearPersistedOperations();
    console.log('Cleared all persisted operations');

  } catch (error) {
    console.error('Error in example:', error);
  }
}

// Example 7: Migration from old architecture
export function exampleMigration() {
  console.log('=== Example 7: Migration Pattern ===');
  
  // OLD WAY (deprecated)
  // import { TreeOpsBuilder } from './lib/treeOps';
  // const oldBuilder = new TreeOpsBuilder({ rootNode: { title: 'Old' } });
  
  // NEW WAY
  const newBuilder = createMemoryTreeBuilder({ 
    rootNode: { title: 'New' },
    autoLoad: false 
  });

  // All the same methods work
  newBuilder.createFolder({ title: 'Migration Test', parentId: 'root' });
  newBuilder.createBookmark({ title: 'Test Link', url: 'https://test.com', parentId: 'root' });

  console.log('Migration successful:', newBuilder.tree.serialize());
}

// Example usage function that runs all examples
export async function runAllExamples() {
  console.log('Running TreeBuilder Examples...\n');
  
  try {
    exampleInMemoryUsage();
    console.log('\n');
    
    await examplePersistentUsage();
    console.log('\n');
    
    await exampleCustomStorage();
    console.log('\n');
    
    await exampleDirectUsage();
    console.log('\n');
    
    exampleReplayOperations();
    console.log('\n');
    
    await exampleErrorHandling();
    console.log('\n');
    
    exampleMigration();
    console.log('\n');
    
    console.log('All examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Uncomment to run examples:
// runAllExamples();
