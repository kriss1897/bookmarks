/**
 * Factory functions and convenience utilities for creating TreeBuilder instances
 * with different storage configurations.
 */

import { TreeBuilder, type TreeBuilderConfig } from './treeBuilder';
import { IndexedDBOperationStorage } from './storage';
import { databaseService } from '../../workers/database';

/**
 * Create a TreeBuilder with IndexedDB storage (operations persist across app sessions)
 */
export function createPersistentTreeBuilder(config: Omit<TreeBuilderConfig, 'storage'> = {}): TreeBuilder {
  return new TreeBuilder({
    storage: new IndexedDBOperationStorage(databaseService),
    ...config
  });
}

// Re-export main classes for convenience
export { TreeBuilder } from './treeBuilder';
export { MemoryOperationStorage, IndexedDBOperationStorage } from './storage';
export type { OperationStorage } from './storage';
export type { TreeBuilderConfig, OperationEnvelope, TreeOperation } from './treeBuilder';
