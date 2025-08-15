/**
 * Factory functions and convenience utilities for creating TreeBuilder instances
 * with different storage configurations.
 */

import { TreeBuilder, type TreeBuilderConfig } from './treeBuilder';
import { MemoryOperationStorage, IndexedDBOperationStorage } from './storage';
import { databaseService } from '../workers/database';

/**
 * Create a TreeBuilder with in-memory storage (operations are lost when app closes)
 */
export function createMemoryTreeBuilder(config: Omit<TreeBuilderConfig, 'storage'> = {}): TreeBuilder {
  return new TreeBuilder({
    ...config,
    storage: new MemoryOperationStorage()
  });
}

/**
 * Create a TreeBuilder with IndexedDB storage (operations persist across app sessions)
 */
export function createPersistentTreeBuilder(config: Omit<TreeBuilderConfig, 'storage'> = {}): TreeBuilder {
  return new TreeBuilder({
    ...config,
    storage: new IndexedDBOperationStorage(databaseService)
  });
}

/**
 * Create a TreeBuilder with custom storage implementation
 */
export function createTreeBuilderWithStorage(
  storage: TreeBuilderConfig['storage'], 
  config: Omit<TreeBuilderConfig, 'storage'> = {}
): TreeBuilder {
  return new TreeBuilder({
    ...config,
    storage
  });
}

// Re-export main classes for convenience
export { TreeBuilder } from './treeBuilder';
export { MemoryOperationStorage, IndexedDBOperationStorage } from './storage';
export type { OperationStorage } from './storage';
export type { TreeBuilderConfig, OperationEnvelope, TreeOperation } from './treeBuilder';
